import { Prisma, type GenerationJob } from "@prisma/client";

import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { toJson } from "../audit.js";
import { emptyTokens, estimateTokens, normalizeProviderTokens, type NormalizedUsage } from "./tokens.js";

export type MediaUnits = {
    images?: number;
    imageSize?: string;
    imageQuality?: string;
    videos?: number;
    videoSeconds?: number;
    videoResolution?: string;
    audioSeconds?: number;
    audioCharacters?: number;
};

export type UsageInput = {
    /** 供应商响应中的原始 usage，缺失时按模型 tokenizer 估算。 */
    providerUsage?: Record<string, unknown>;
    /** 用于估算的输出文本，仅文本能力需要。 */
    outputText?: string;
    /** 完整输入文本；供应商未返回 usage 时用于估算多轮消息，而不是只估最后一条提示词。 */
    inputText?: string;
    media?: MediaUnits;
};

export type SucceededJob = { providerRequestId?: string; result: unknown };

/**
 * 文本以外的能力没有 Token 可估算，供应商不返回就如实记为 0 并标记 `none`，同时单独记录媒体用量；
 * 这样 `provider` 与 `estimated` 两类 Token 数据可以分别筛选和汇总，不会被无 Token 的调用稀释。
 */
function resolveUsage(job: GenerationJob & { model: { remoteName: string } }, input: UsageInput): NormalizedUsage {
    const provider = normalizeProviderTokens(input.providerUsage);
    if (provider) return { tokens: provider, source: "provider" };
    if (job.capability === "text") return estimateTokens(job.model.remoteName, input.inputText ?? job.promptText, input.outputText ?? "");
    return { tokens: emptyTokens, source: "none" };
}

/**
 * 把任务成功状态、生成结果和用量记录放在同一事务中提交。
 * 只有仍为 running 的任务可以成功，取消任务不会被供应商的迟到结果覆盖。
 */
export async function recordSucceededUsage(jobId: string, input: UsageInput, succeeded: SucceededJob) {
    const job = await prisma.generationJob.findUnique({ where: { id: jobId }, include: { model: true } });
    if (!job) return false;
    const usage = resolveUsage(job, input);
    const media = input.media ?? {};

    const usageData = {
        inputTokens: usage.tokens.inputTokens,
        cachedTokens: usage.tokens.cachedTokens,
        outputTokens: usage.tokens.outputTokens,
        reasoningTokens: usage.tokens.reasoningTokens,
        totalTokens: usage.tokens.totalTokens,
        mediaUnits: Object.keys(media).length ? toJson(media) : Prisma.DbNull,
        usageSource: usage.source,
        usageEstimationMethod: usage.estimationMethod ?? null,
        tokenizerName: usage.tokenizerName ?? null,
        tokenizerVersion: usage.tokenizerVersion ?? null,
    };

    return prisma.$transaction(async (tx) => {
        const existing = await tx.aiUsageRecord.findUnique({ where: { jobId } });
        if (existing?.status === "succeeded") return "succeeded" as const;
        const updated = await tx.generationJob.updateMany({
            where: { id: jobId, status: "running" },
            data: { status: "succeeded", finishedAt: new Date(), providerRequestId: succeeded.providerRequestId ?? null, result: toJson(succeeded.result) },
        });
        if (updated.count) {
            await tx.aiUsageRecord.upsert({
                where: { jobId },
                create: {
                    jobId: job.id,
                    userId: job.userId,
                    projectId: job.projectId,
                    modelId: job.modelId,
                    capability: job.capability,
                    status: "succeeded",
                    ...usageData,
                },
                update: { status: "succeeded", ...usageData },
            });
            return "succeeded" as const;
        }

        const current = await tx.generationJob.findUnique({ where: { id: jobId }, select: { status: true } });
        if (current?.status !== "cancelled") return false;
        // 取消只阻止结果落库；供应商已返回时仍用真实用量覆盖占位记录。
        await tx.aiUsageRecord.upsert({
            where: { jobId },
            create: {
                jobId: job.id,
                userId: job.userId,
                projectId: job.projectId,
                modelId: job.modelId,
                capability: job.capability,
                status: "cancelled",
                ...usageData,
            },
            update: { status: "cancelled", ...usageData },
        });
        return "cancelled" as const;
    });
}

/**
 * 失败和取消同样留下用量占位记录，让管理员按状态汇总时不会漏掉调用。
 */
export async function recordTerminatedUsage(jobId: string) {
    try {
        const existing = await prisma.aiUsageRecord.findUnique({ where: { jobId } });
        if (existing) return existing;
        const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
        if (!job) return null;
        return await prisma.aiUsageRecord.create({
            data: {
                jobId: job.id,
                userId: job.userId,
                projectId: job.projectId,
                modelId: job.modelId,
                capability: job.capability,
                status: job.status,
                usageSource: "none",
            },
        });
    } catch (error) {
        logger.error("写入终止任务用量记录失败", { jobId, error: error instanceof Error ? error.message : String(error) });
        return null;
    }
}
