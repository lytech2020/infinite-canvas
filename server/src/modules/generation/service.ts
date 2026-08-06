import type { GenerationJob, JobStatus, User } from "@prisma/client";

import { prisma } from "../../db.js";
import { env } from "../../env.js";
import { ApiError } from "../../http/response.js";
import { logger } from "../../logger.js";
import { toJson } from "../audit.js";
import { getObjectBuffer, presignDownload } from "../storage/s3.js";
import { resolveJobFiles, saveGeneratedFile } from "../storage/uploads.js";
import { settleJob, settleUnbilledJob } from "../usage/service.js";
import { editImage, generateImage, generateText } from "./providers/openai.js";

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

/** 用户并发保护：排队中的任务同样计入名额，视频另有更严格的单独上限。 */
async function assertUserConcurrency(userId: string, capability: CreateJobInput["capability"]) {
    const active = { userId, status: { in: ["queued", "running"] as JobStatus[] } };
    const running = await prisma.generationJob.count({ where: active });
    if (running >= env.userMaxConcurrentJobs) throw new ApiError("CONCURRENCY_LIMIT", "当前运行任务过多", { limit: env.userMaxConcurrentJobs });
    if (capability !== "video") return;
    const videos = await prisma.generationJob.count({ where: { ...active, capability: "video" } });
    if (videos >= env.userMaxConcurrentVideoJobs) throw new ApiError("CONCURRENCY_LIMIT", "视频任务过多", { limit: env.userMaxConcurrentVideoJobs });
}

/** 创建生成任务；同一用户的相同 requestId 直接返回已存在任务，不重复创建也不重复计费。 */
export async function createJob(user: User, input: CreateJobInput) {
    const existing = await prisma.generationJob.findUnique({ where: { userId_requestId: { userId: user.id, requestId: input.requestId } } });
    if (existing) return existing;

    const model = await prisma.model.findUnique({ where: { id: input.modelId }, include: { provider: true } });
    if (!model || !model.enabled || !model.provider.enabled) throw new ApiError("MODEL_UNAVAILABLE", "模型不可用");
    if (model.capability !== input.capability) throw new ApiError("VALIDATION_FAILED", "模型能力与请求不一致");
    if (model.maxConcurrency && (await prisma.generationJob.count({ where: { modelId: model.id, status: { in: ["queued", "running"] } } })) >= model.maxConcurrency) {
        throw new ApiError("SERVICE_BUSY", "该模型当前繁忙");
    }
    await assertUserConcurrency(user.id, input.capability);

    if (input.projectId) {
        const project = await prisma.project.findUnique({ where: { id: input.projectId } });
        if (!project || project.userId !== user.id) throw new ApiError("NOT_FOUND", "项目不存在");
    }

    const files = await resolveJobFiles(user.id, input.fileIds || []);
    if (files.length && input.capability !== "image") throw new ApiError("VALIDATION_FAILED", "当前能力暂不支持参考文件");

    const job = await prisma.generationJob.create({
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
    void runJob(job.id);
    return job;
}

/**
 * 执行任务。生成请求不可重放，因此不做自动重试：
 * 失败一律回传稳定错误代码，由用户决定是否重新发起。
 */
async function runJob(jobId: string) {
    const controller = new AbortController();
    runningJobs.set(jobId, controller);
    const timeout = setTimeout(() => controller.abort(new Error("PROVIDER_TIMEOUT")), env.providerTimeoutMs);
    try {
        const job = await prisma.generationJob.update({ where: { id: jobId }, data: { status: "running", startedAt: new Date() }, include: { model: { include: { provider: true } } } });
        const params = (job.params || {}) as Record<string, unknown>;
        if (job.capability === "text") {
            const result = await generateText(job.model.provider, job.model, job.promptText, params, controller.signal);
            await finishSucceeded(jobId, result.providerRequestId, { text: result.text });
            await settleJob(jobId, { providerUsage: result.usage, outputText: result.text });
        } else if (job.capability === "image") {
            const result = await runImage(job.userId, jobId, job.model.provider, job.model, job.promptText, params, controller.signal);
            await finishSucceeded(jobId, result.providerRequestId, { files: result.files });
            await settleJob(jobId, {
                providerUsage: result.usage,
                media: { images: result.files.length, imageSize: typeof params.size === "string" ? params.size : undefined, imageQuality: typeof params.quality === "string" ? params.quality : undefined },
            });
        } else {
            throw new ApiError("MODEL_UNAVAILABLE", "该能力尚未接入后台网关");
        }
    } catch (error) {
        await finishFailed(jobId, error);
    } finally {
        clearTimeout(timeout);
        runningJobs.delete(jobId);
    }
}

/** 有参考文件时走图片编辑，否则走文生图；结果一律写入对象存储，不落库。 */
async function runImage(userId: string, jobId: string, provider: Parameters<typeof generateImage>[0], model: Parameters<typeof generateImage>[1], prompt: string, params: Record<string, unknown>, signal: AbortSignal) {
    const fileIds = Array.isArray(params.fileIds) ? (params.fileIds as string[]) : [];
    const uploads = await prisma.upload.findMany({ where: { id: { in: fileIds } } });
    const references = await Promise.all(
        uploads.map(async (upload) => ({ data: await getObjectBuffer(upload.storageKey), mimeType: upload.mimeType, filename: upload.storageKey.split("/").pop() || "reference" })),
    );

    const result = references.length ? await editImage(provider, model, prompt, params, references, signal) : await generateImage(provider, model, prompt, params, signal);
    const files = await Promise.all(
        result.images.map(async (image) => {
            const saved = await saveGeneratedFile(userId, jobId, image.data, image.mimeType);
            return { storageKey: saved.storageKey, mimeType: saved.mimeType, size: saved.size };
        }),
    );
    return { files, providerRequestId: result.providerRequestId, usage: result.usage };
}

/** 写入成功状态与结果。 */
async function finishSucceeded(jobId: string, providerRequestId: string | undefined, result: JobResult) {
    await prisma.generationJob.update({ where: { id: jobId }, data: { status: "succeeded", finishedAt: new Date(), providerRequestId: providerRequestId ?? null, result: toJson(result) } });
}

/** 把供应商异常转换为稳定错误代码；被取消的任务不覆盖其 cancelled 状态。 */
async function finishFailed(jobId: string, error: unknown) {
    const current = await prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!current || current.status === "cancelled") return;
    const aborted = error instanceof Error && error.name === "AbortError";
    const timedOut = aborted || (error instanceof Error && error.message === "PROVIDER_TIMEOUT");
    const code = error instanceof ApiError ? error.code : timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR";
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn("生成任务失败", { jobId, code });
    await prisma.generationJob.update({ where: { id: jobId }, data: { status: "failed", finishedAt: new Date(), errorCode: code, errorDetail: detail } });
    // 失败任务同样留下金额为 0 的记录，管理员按状态汇总时不会漏掉这次调用。
    await settleUnbilledJob(jobId, `任务失败：${code}`);
}

/** 取消任务并释放并发名额；已结束的任务不能取消。 */
export async function cancelJob(userId: string, jobId: string) {
    const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!job || job.userId !== userId) throw new ApiError("NOT_FOUND", "任务不存在");
    if (job.status !== "queued" && job.status !== "running") throw new ApiError("JOB_NOT_CANCELABLE", "任务已结束");
    const updated = await prisma.generationJob.update({ where: { id: jobId }, data: { status: "cancelled", finishedAt: new Date() } });
    runningJobs.get(jobId)?.abort();
    await settleUnbilledJob(jobId, "用户取消任务");
    return updated;
}

/** 进程重启后把残留的运行中任务标记为失败，避免永远占用并发名额。 */
export async function releaseStaleJobs() {
    const stale = await prisma.generationJob.findMany({ where: { status: { in: ["queued", "running"] } }, select: { id: true } });
    if (!stale.length) return;
    await prisma.generationJob.updateMany({
        where: { id: { in: stale.map((job) => job.id) } },
        data: { status: "failed", errorCode: "INTERNAL_ERROR", errorDetail: "服务重启导致任务中断", finishedAt: new Date() },
    });
    for (const job of stale) await settleUnbilledJob(job.id, "服务重启导致任务中断");
    logger.warn("已清理服务重启前的未完成任务", { count: stale.length });
}
