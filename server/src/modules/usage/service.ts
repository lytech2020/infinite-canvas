import { Prisma, type GenerationJob } from "@prisma/client";

import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { toJson } from "../audit.js";
import { resolvePrice, settle, type MediaUnits } from "./pricing.js";
import { emptyTokens, estimateTokens, normalizeProviderTokens, type NormalizedUsage } from "./tokens.js";

export type SettleInput = {
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
 * 文本以外的能力没有 Token 可估算，供应商不返回就如实记为 0 并标记 `none`，金额改由媒体计费单位决定；
 * 这样 `provider` 与 `estimated` 两类 Token 数据可以分别筛选和汇总，不会被无 Token 的调用稀释。
 */
function resolveUsage(job: GenerationJob & { model: { remoteName: string } }, input: SettleInput): NormalizedUsage {
    const provider = normalizeProviderTokens(input.providerUsage);
    if (provider) return { tokens: provider, source: "provider" };
    if (job.capability === "text") return estimateTokens(job.model.remoteName, input.inputText ?? job.promptText, input.outputText ?? "");
    return { tokens: emptyTokens, source: "none" };
}

/**
 * 把任务成功状态、生成结果和用量记录放在同一事务中提交。
 * 只有仍为 running 的任务可以成功，取消任务不会被供应商的迟到结果覆盖。
 */
export async function settleSucceededJob(jobId: string, input: SettleInput, succeeded: SucceededJob) {
    const job = await prisma.generationJob.findUnique({ where: { id: jobId }, include: { model: true } });
    if (!job) return false;
    const usage = resolveUsage(job, input);
    const rule = await resolvePrice(job.modelId, job.createdAt);
    const media = input.media ?? {};
    const result = rule ? settle(rule, usage.tokens, media) : { amountUsd: new Prisma.Decimal(0), lines: [] };
    if (!rule) logger.warn("模型缺少生效中的价格规则，本次调用金额记为 0", { jobId, modelId: job.modelId });

    return prisma.$transaction(async (tx) => {
        const existing = await tx.aiUsageRecord.findUnique({ where: { jobId } });
        if (existing) return existing.status === "succeeded";
        const updated = await tx.generationJob.updateMany({
            where: { id: jobId, status: "running" },
            data: { status: "succeeded", finishedAt: new Date(), providerRequestId: succeeded.providerRequestId ?? null, result: toJson(succeeded.result) },
        });
        if (!updated.count) return false;
        await tx.aiUsageRecord.create({
            data: {
                jobId: job.id,
                userId: job.userId,
                projectId: job.projectId,
                modelId: job.modelId,
                capability: job.capability,
                status: "succeeded",
                // 快照价格规则本身，之后管理员改价不会改变这条历史金额
                priceSnapshot: rule ? toJson({ priceId: rule.id, pricingType: rule.pricingType, currency: rule.currency, unitPrices: rule.unitPrices, effectiveFrom: rule.effectiveFrom }) : Prisma.DbNull,
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
                amountUsd: result.amountUsd,
                calculationDetail: toJson({ lines: result.lines, priceRuleMissing: !rule }),
            },
        });
        return true;
    });
}

/**
 * 记录未产生费用的终止任务。
 * 失败和取消同样要留下可汇总的记录，金额为 0 并标记 `usage_source = none`，
 * 这样管理员按状态汇总时不会漏掉任何一次调用。
 */
export async function settleUnbilledJob(jobId: string, reason: string) {
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
                amountUsd: new Prisma.Decimal(0),
                calculationDetail: toJson({ lines: [], reason }),
            },
        });
    } catch (error) {
        logger.error("写入未计费记录失败", { jobId, message: error instanceof Error ? error.message : String(error) });
        return null;
    }
}
