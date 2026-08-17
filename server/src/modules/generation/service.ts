import type { GenerationJob, Model, Upload, User } from "@prisma/client";
import { parseBuffer } from "music-metadata";

import { prisma } from "../../db.js";
import { env } from "../../env.js";
import { ApiError } from "../../http/response.js";
import { logger } from "../../logger.js";
import { toJson } from "../audit.js";
import { assertUserQuota } from "../quota/service.js";
import { deleteObject, getObjectBuffer, presignDownload } from "../storage/s3.js";
import { fileKind, resolveJobFiles, saveGeneratedFile } from "../storage/uploads.js";
import { recordSucceededUsage, recordTerminatedUsage, type UsageInput } from "../usage/service.js";
import { editImage, generateAudio, generateImage, generateText, generateVideo, type VideoReference } from "./providers/openai.js";

/** 运行中任务的取消句柄；进程重启后由启动清理逻辑兜底。 */
const runningJobs = new Map<string, AbortController>();

export type CreateJobInput = {
    requestId: string;
    modelId: string;
    capability: "text" | "image" | "video" | "audio";
    source: "canvas" | "image_workbench" | "video_workbench" | "other";
    projectId?: string;
    projectName?: string;
    nodeId?: string;
    prompt: string;
    params?: Record<string, unknown>;
    fileIds?: string[];
};

type ParamRule = { type?: unknown; values?: unknown; min?: unknown; max?: unknown };
const DEFAULT_MAX_OUTPUT_COUNT = 10;
const MAX_OUTPUT_TOKENS = 32_768;
const MAX_VIDEO_SECONDS = 60;
const MAX_MESSAGES = 100;
const MAX_MESSAGE_LENGTH = 20_000;
const MAX_MESSAGES_TOTAL_LENGTH = 100_000;
const MAX_PARAMS_BYTES = 200_000;

/** 只校验管理员为该模型显式配置的参数，任务归属、文件角色等内部字段不受影响。 */
function assertModelParams(model: Model, params: Record<string, unknown>) {
    if (Buffer.byteLength(JSON.stringify(params), "utf8") > MAX_PARAMS_BYTES) throw new ApiError("VALIDATION_FAILED", "模型参数内容过大", { maxBytes: MAX_PARAMS_BYTES });
    const schema = model.paramSchema && typeof model.paramSchema === "object" && !Array.isArray(model.paramSchema) ? (model.paramSchema as Record<string, ParamRule>) : {};
    for (const [key, rule] of Object.entries(schema)) {
        const value = params[key];
        if (value === undefined || !rule || typeof rule !== "object") continue;
        const validType = rule.type === "number" ? typeof value === "number" && Number.isFinite(value) : rule.type === "boolean" ? typeof value === "boolean" : rule.type === "string" || rule.type === "enum" ? typeof value === "string" : true;
        if (!validType) throw new ApiError("VALIDATION_FAILED", "模型参数类型不正确", { parameter: key });
        if (rule.type === "enum" && Array.isArray(rule.values) && !rule.values.includes(value)) throw new ApiError("VALIDATION_FAILED", "模型参数不在允许范围内", { parameter: key });
        if (typeof value === "number" && typeof rule.min === "number" && value < rule.min) throw new ApiError("VALIDATION_FAILED", "模型参数低于允许范围", { parameter: key, min: rule.min });
        if (typeof value === "number" && typeof rule.max === "number" && value > rule.max) throw new ApiError("VALIDATION_FAILED", "模型参数超过允许范围", { parameter: key, max: rule.max });
    }
    if (params.count !== undefined && (typeof params.count !== "number" || !Number.isInteger(params.count) || params.count < 1)) {
        throw new ApiError("VALIDATION_FAILED", "单次生成数量必须是正整数", { parameter: "count" });
    }
    const maxOutputCount = model.maxOutputCount ?? DEFAULT_MAX_OUTPUT_COUNT;
    if (typeof params.count === "number" && params.count > maxOutputCount) {
        throw new ApiError("VALIDATION_FAILED", "单次生成数量超过模型限制", { parameter: "count", maxOutputCount });
    }
    if (params.maxOutputTokens !== undefined && (typeof params.maxOutputTokens !== "number" || !Number.isInteger(params.maxOutputTokens) || params.maxOutputTokens < 1 || params.maxOutputTokens > MAX_OUTPUT_TOKENS)) {
        throw new ApiError("VALIDATION_FAILED", "文本输出 Token 超过后台限制", { parameter: "maxOutputTokens", max: MAX_OUTPUT_TOKENS });
    }
    if (params.seconds !== undefined && (typeof params.seconds !== "number" || !Number.isFinite(params.seconds) || params.seconds <= 0 || params.seconds > MAX_VIDEO_SECONDS)) {
        throw new ApiError("VALIDATION_FAILED", "视频时长超过后台限制", { parameter: "seconds", max: MAX_VIDEO_SECONDS });
    }
    if (params.messages !== undefined) {
        if (!Array.isArray(params.messages) || params.messages.length > MAX_MESSAGES) throw new ApiError("VALIDATION_FAILED", "多轮消息数量超过后台限制", { parameter: "messages", max: MAX_MESSAGES });
        let totalLength = 0;
        for (const item of params.messages) {
            if (!item || typeof item !== "object") throw new ApiError("VALIDATION_FAILED", "多轮消息格式不正确", { parameter: "messages" });
            const { role, content } = item as { role?: unknown; content?: unknown };
            if (role !== "system" && role !== "user" && role !== "assistant") throw new ApiError("VALIDATION_FAILED", "多轮消息角色不正确", { parameter: "messages" });
            if (typeof content !== "string" || !content.trim() || content.length > MAX_MESSAGE_LENGTH) throw new ApiError("VALIDATION_FAILED", "单条消息长度超过后台限制", { parameter: "messages", maxLength: MAX_MESSAGE_LENGTH });
            totalLength += content.length;
        }
        if (totalLength > MAX_MESSAGES_TOTAL_LENGTH) throw new ApiError("VALIDATION_FAILED", "多轮消息总长度超过后台限制", { parameter: "messages", maxLength: MAX_MESSAGES_TOTAL_LENGTH });
    }
}

/** 模型文件限制可以比全局上传限制更严格，在创建任务时按实际上传记录再次校验。 */
function assertModelFileLimits(model: Model, files: Upload[]) {
    const limits = model.fileLimits && typeof model.fileLimits === "object" && !Array.isArray(model.fileLimits) ? (model.fileLimits as Record<string, { maxCount?: unknown; maxSizeMb?: unknown }>) : {};
    for (const kind of ["image", "video", "audio"] as const) {
        const selected = files.filter((file) => fileKind(file.mimeType) === kind);
        const limit = limits[kind];
        if (!limit) continue;
        if (typeof limit.maxCount === "number" && selected.length > limit.maxCount) throw new ApiError("FILE_COUNT_EXCEEDED", "文件数量超过模型限制", { kind, maxCount: limit.maxCount });
        const maxSizeMb = typeof limit.maxSizeMb === "number" ? limit.maxSizeMb : undefined;
        if (maxSizeMb !== undefined && selected.some((file) => file.size > maxSizeMb * 1024 * 1024)) throw new ApiError("FILE_TOO_LARGE", "文件超过模型大小限制", { kind, maxSizeMb });
    }
}

/** 结果里只保存对象存储的 key，下发时再签发限时地址，避免地址过期后无法访问。 */
type JobResult = { text?: string; files?: Array<{ storageKey: string; mimeType: string; size: number }> };

/** 对外输出的任务结构，不包含供应商细节和内部错误原文；文件每次读取时重新签发限时地址。 */
export async function publicJob(job: GenerationJob) {
    const stored = (job.result || null) as JobResult | null;
    const files = stored?.files ? await Promise.all(stored.files.map(async (file) => ({ url: await presignDownload(file.storageKey), mimeType: file.mimeType, size: file.size }))) : undefined;
    return {
        id: job.id,
        requestId: job.requestId,
        status: job.status,
        capability: job.capability,
        projectId: job.projectId,
        nodeId: job.nodeId,
        result: stored ? { text: stored.text, files } : null,
        errorCode: job.errorCode,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
    };
}

/** 创建生成任务；同一用户的相同 requestId 直接返回已存在任务，不重复创建。 */
export async function createJob(user: User, input: CreateJobInput) {
    const existingJob = await prisma.generationJob.findUnique({ where: { userId_requestId: { userId: user.id, requestId: input.requestId } } });
    if (existingJob) return existingJob;
    const model = await prisma.model.findUnique({ where: { id: input.modelId }, include: { provider: true } });
    if (!model || !model.enabled || !model.provider.enabled) throw new ApiError("MODEL_UNAVAILABLE", "模型不可用");
    if (model.provider.apiFormat === "gemini") throw new ApiError("MODEL_UNAVAILABLE", "Gemini 原生协议尚未接入后台网关");
    if (model.capability !== input.capability) throw new ApiError("VALIDATION_FAILED", "模型能力与请求不一致");
    assertModelParams(model, input.params ?? {});
    if (input.projectId) {
        const project = await prisma.project.findUnique({ where: { id: input.projectId } });
        if (!project || project.userId !== user.id) throw new ApiError("NOT_FOUND", "项目不存在");
    }

    const files = await resolveJobFiles(user.id, input.fileIds || []);
    assertModelFileLimits(model, files);
    const onlyImages = files.every((file) => fileKind(file.mimeType) === "image");
    if (files.length && input.capability !== "video" && !((input.capability === "image" || input.capability === "text") && onlyImages)) {
        throw new ApiError("VALIDATION_FAILED", "当前能力暂不支持参考文件");
    }
    if (input.capability === "video" && model.provider.apiFormat !== "ark") {
        if (!onlyImages) throw new ApiError("FILE_TYPE_NOT_ALLOWED", "OpenAI 视频只支持参考图片");
        if (files.length > 1) throw new ApiError("FILE_COUNT_EXCEEDED", "OpenAI 视频只支持一张参考图", { maxCount: 1 });
    }

    const { job, created } = await prisma.$transaction(async (tx) => {
        // 用户锁保证相同 requestId 与用户并发检查原子化；模型锁保证全局模型并发不会被并行请求突破。
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`generation:user:${user.id}`}, 0))::text`;
        const existing = await tx.generationJob.findUnique({ where: { userId_requestId: { userId: user.id, requestId: input.requestId } } });
        if (existing) return { job: existing, created: false };
        await assertUserQuota(tx, user, input.capability);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`generation:model:${model.id}`}, 0))::text`;
        if (model.maxConcurrency && (await tx.generationJob.count({ where: { modelId: model.id, status: { in: ["queued", "running"] } } })) >= model.maxConcurrency) {
            throw new ApiError("SERVICE_BUSY", "该模型当前繁忙");
        }
        const createdJob = await tx.generationJob.create({
            data: {
                requestId: input.requestId,
                userId: user.id,
                projectId: input.projectId ?? null,
                projectNameSnapshot: input.projectName ?? null,
                nodeId: input.nodeId ?? null,
                source: input.source,
                modelId: model.id,
                capability: input.capability,
                promptText: input.prompt,
                params: toJson({ ...(input.params ?? {}), fileIds: files.map((file) => file.id) }),
            },
        });
        return { job: createdJob, created: true };
    }, { maxWait: 5_000, timeout: 10_000 });
    if (created) void runJob(job.id).catch((error) => logger.error("生成任务执行异常", { jobId: job.id, error: error instanceof Error ? error.message : String(error) }));
    return job;
}

/**
 * 执行任务。生成请求不可重放，因此不做自动重试：
 * 失败一律回传稳定错误代码，由用户决定是否重新发起。
 */
async function runJob(jobId: string) {
    const controller = new AbortController();
    runningJobs.set(jobId, controller);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const claimed = await prisma.generationJob.updateMany({ where: { id: jobId, status: "queued" }, data: { status: "running", startedAt: new Date() } });
        if (!claimed.count) return;
        const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId }, include: { model: { include: { provider: true } } } });
        timeout = setTimeout(() => controller.abort(new Error("PROVIDER_TIMEOUT")), job.capability === "video" ? env.providerVideoTimeoutMs : env.providerTimeoutMs);
        const params = (job.params || {}) as Record<string, unknown>;
        if (job.capability === "text") {
            const result = await runText(job.userId, job.model.provider, job.model, job.promptText, params, controller.signal);
            await completeSucceededJob(jobId, { providerUsage: result.usage, inputText: textUsageInput(params, job.promptText), outputText: result.text }, result.providerRequestId, { text: result.text });
        } else if (job.capability === "image") {
            const result = await runImage(job.userId, jobId, job.model.provider, job.model, job.promptText, params, controller.signal);
            await completeSucceededJob(jobId, {
                providerUsage: result.usage,
                media: { images: result.files.length, imageSize: typeof params.size === "string" ? params.size : undefined, imageQuality: typeof params.quality === "string" ? params.quality : undefined },
            }, result.providerRequestId, { files: result.files });
        } else if (job.capability === "audio") {
            const result = await generateAudio(job.model.provider, job.model, job.promptText, params, controller.signal);
            const saved = await saveGeneratedFile(job.userId, jobId, result.data, result.mimeType);
            const audioSeconds = await readAudioDuration(result.data, result.mimeType);
            await completeSucceededJob(jobId, { media: { audioCharacters: Array.from(job.promptText).length, ...(audioSeconds ? { audioSeconds } : {}) } }, result.providerRequestId, { files: [{ storageKey: saved.storageKey, mimeType: saved.mimeType, size: saved.size }] });
        } else if (job.capability === "video") {
            const result = await runVideo(job.userId, jobId, job.model.provider, job.model, job.promptText, params, controller.signal);
            const saved = await saveGeneratedFile(job.userId, jobId, result.data, result.mimeType);
            await completeSucceededJob(jobId, { media: { videos: 1, videoSeconds: result.seconds ?? (typeof params.seconds === "number" ? params.seconds : undefined), videoResolution: typeof params.resolution === "string" ? params.resolution : undefined } }, result.providerRequestId, { files: [{ storageKey: saved.storageKey, mimeType: saved.mimeType, size: saved.size }] });
        } else {
            throw new ApiError("MODEL_UNAVAILABLE", "该能力尚未接入后台网关");
        }
    } catch (error) {
        await finishFailed(jobId, error);
    } finally {
        if (timeout) clearTimeout(timeout);
        runningJobs.delete(jobId);
    }
}

async function runVideo(userId: string, jobId: string, provider: Parameters<typeof generateVideo>[0], model: Parameters<typeof generateVideo>[1], prompt: string, params: Record<string, unknown>, signal: AbortSignal) {
    const fileRoles = Array.isArray(params.fileRoles) ? params.fileRoles : [];
    const roles = new Map(
        fileRoles.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const { id, role } = item as { id?: unknown; role?: unknown };
            if (typeof id !== "string" || (role !== "reference_image" && role !== "reference_video" && role !== "reference_audio")) return [];
            return [[id, role] as const];
        }),
    );
    const fileIds = Array.isArray(params.fileIds) ? (params.fileIds as string[]) : [];
    const uploads = await prisma.upload.findMany({ where: { id: { in: fileIds }, userId, status: "ready" } });
    const references: VideoReference[] = await Promise.all(
        uploads.map(async (upload) => ({
            data: await getObjectBuffer(upload.storageKey),
            mimeType: upload.mimeType,
            filename: upload.storageKey.split("/").pop() || "reference",
            role: roles.get(upload.id) || (fileKind(upload.mimeType) === "image" ? "reference_image" : fileKind(upload.mimeType) === "video" ? "reference_video" : "reference_audio"),
        })),
    );
    return generateVideo(provider, model, prompt, params, references, signal, async (providerRequestId) => {
        await prisma.generationJob.update({ where: { id: jobId }, data: { providerRequestId } });
    });
}

/** 音频格式解析失败不影响生成结果，只是不记录音频时长。 */
async function readAudioDuration(data: Buffer, mimeType: string) {
    try {
        const metadata = await parseBuffer(data, { mimeType });
        return metadata.format.duration && Number.isFinite(metadata.format.duration) ? metadata.format.duration : undefined;
    } catch {
        return undefined;
    }
}

/** 文本任务允许携带图片参考，由后台读取后以内联图片交给多模态文本模型。 */
async function runText(userId: string, provider: Parameters<typeof generateText>[0], model: Parameters<typeof generateText>[1], prompt: string, params: Record<string, unknown>, signal: AbortSignal) {
    const fileIds = Array.isArray(params.fileIds) ? (params.fileIds as string[]) : [];
    const uploads = await prisma.upload.findMany({ where: { id: { in: fileIds }, userId, status: "ready" } });
    const references = await Promise.all(uploads.map(async (upload) => ({ data: await getObjectBuffer(upload.storageKey), mimeType: upload.mimeType })));
    return generateText(provider, model, prompt, params, signal, references);
}

/** Token 估算使用完整文本消息，保留角色边界，避免多轮对话只计算最后一条提示词。 */
function textUsageInput(params: Record<string, unknown>, prompt: string) {
    if (!Array.isArray(params.messages)) return prompt;
    const lines = params.messages.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const { role, content } = item as { role?: unknown; content?: unknown };
        return typeof role === "string" && typeof content === "string" && content.trim() ? [`${role}: ${content}`] : [];
    });
    return lines.length ? lines.join("\n") : prompt;
}

/** 有参考文件时走图片编辑，否则走文生图；结果一律写入对象存储，不落库。 */
async function runImage(userId: string, jobId: string, provider: Parameters<typeof generateImage>[0], model: Parameters<typeof generateImage>[1], prompt: string, params: Record<string, unknown>, signal: AbortSignal) {
    const fileIds = Array.isArray(params.fileIds) ? (params.fileIds as string[]) : [];
    const maskFileId = typeof params.maskFileId === "string" ? params.maskFileId : "";
    const uploads = await prisma.upload.findMany({ where: { id: { in: fileIds }, userId, status: "ready" } });
    const references = await Promise.all(
        uploads.filter((upload) => upload.id !== maskFileId).map(async (upload) => ({ data: await getObjectBuffer(upload.storageKey), mimeType: upload.mimeType, filename: upload.storageKey.split("/").pop() || "reference" })),
    );
    const maskUpload = uploads.find((upload) => upload.id === maskFileId);
    const mask = maskUpload ? { data: await getObjectBuffer(maskUpload.storageKey), mimeType: maskUpload.mimeType, filename: maskUpload.storageKey.split("/").pop() || "mask.png" } : undefined;

    const result = references.length ? await editImage(provider, model, prompt, params, references, signal, mask) : await generateImage(provider, model, prompt, params, signal);
    const files = await Promise.all(
        result.images.map(async (image) => {
            const saved = await saveGeneratedFile(userId, jobId, image.data, image.mimeType);
            return { storageKey: saved.storageKey, mimeType: saved.mimeType, size: saved.size };
        }),
    );
    return { files, providerRequestId: result.providerRequestId, usage: result.usage };
}

/** 任务被取消或用量记录失败时，删除已经写入但不会再被引用的生成结果。 */
async function discardResult(result: JobResult) {
    await Promise.all((result.files || []).map((file) => deleteObject(file.storageKey).catch(() => undefined)));
}

/** 成功状态、结果和用量必须同时提交。 */
async function completeSucceededJob(jobId: string, input: UsageInput, providerRequestId: string | undefined, result: JobResult) {
    try {
        const outcome = await recordSucceededUsage(jobId, input, { providerRequestId, result });
        if (outcome !== "succeeded") await discardResult(result);
    } catch (error) {
        await discardResult(result);
        throw error;
    }
}

/** 把供应商异常转换为稳定错误代码；被取消的任务不覆盖其 cancelled 状态。 */
async function finishFailed(jobId: string, error: unknown) {
    const aborted = error instanceof Error && error.name === "AbortError";
    const timedOut = aborted || (error instanceof Error && error.message === "PROVIDER_TIMEOUT");
    const code = error instanceof ApiError ? error.code : timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR";
    const detail = error instanceof Error ? error.message : String(error);
    const updated = await prisma.generationJob.updateMany({ where: { id: jobId, status: "running" }, data: { status: "failed", finishedAt: new Date(), errorCode: code, errorDetail: detail } });
    if (!updated.count) return;
    logger.warn("生成任务失败", { jobId, code });
    await recordTerminatedUsage(jobId);
}

/** 取消任务并释放并发名额；已结束的任务不能取消。 */
export async function cancelJob(userId: string, jobId: string) {
    const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!job || job.userId !== userId) throw new ApiError("NOT_FOUND", "任务不存在");
    const changed = await prisma.generationJob.updateMany({ where: { id: jobId, userId, status: { in: ["queued", "running"] } }, data: { status: "cancelled", finishedAt: new Date() } });
    if (!changed.count) throw new ApiError("JOB_NOT_CANCELABLE", "任务已结束");
    runningJobs.get(jobId)?.abort();
    await recordTerminatedUsage(jobId);
    return prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
}

/** 进程重启后把残留的运行中任务标记为失败，避免永远占用并发名额。 */
export async function releaseStaleJobs() {
    const stale = await prisma.generationJob.findMany({ where: { status: { in: ["queued", "running"] } }, select: { id: true } });
    if (!stale.length) return;
    await prisma.generationJob.updateMany({
        where: { id: { in: stale.map((job) => job.id) } },
        data: { status: "failed", errorCode: "INTERNAL_ERROR", errorDetail: "服务重启导致任务中断", finishedAt: new Date() },
    });
    for (const job of stale) await recordTerminatedUsage(job.id);
    logger.warn("已清理服务重启前的未完成任务", { count: stale.length });
}
