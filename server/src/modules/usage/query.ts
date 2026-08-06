import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../../db.js";

/** 调用明细与汇总共用的筛选条件。 */
export const usageFilter = z.object({
    userId: z.string().optional(),
    projectId: z.string().optional(),
    modelId: z.string().optional(),
    capability: z.enum(["text", "image", "video", "audio"]).optional(),
    status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]).optional(),
    source: z.enum(["canvas", "image_workbench", "video_workbench", "other"]).optional(),
    usageSource: z.enum(["provider", "estimated", "none"]).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
});

export type UsageFilter = z.infer<typeof usageFilter>;

/** 明细以任务为准，这样正在排队和运行的调用也能看到，用量字段取其结算记录。 */
export function jobWhere(filter: UsageFilter): Prisma.GenerationJobWhereInput {
    return {
        userId: filter.userId,
        projectId: filter.projectId,
        modelId: filter.modelId,
        capability: filter.capability,
        status: filter.status,
        source: filter.source,
        usage: filter.usageSource ? { usageSource: filter.usageSource } : undefined,
        createdAt: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
    };
}

/** 金额与 Token 汇总以结算记录为准，避免把未结算任务算进金额。 */
export function recordWhere(filter: UsageFilter): Prisma.AiUsageRecordWhereInput {
    return {
        userId: filter.userId,
        projectId: filter.projectId,
        modelId: filter.modelId,
        capability: filter.capability,
        status: filter.status,
        usageSource: filter.usageSource,
        job: filter.source ? { source: filter.source } : undefined,
        createdAt: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
    };
}

const sumFields = { inputTokens: true, cachedTokens: true, outputTokens: true, reasoningTokens: true, totalTokens: true, amountUsd: true } as const;

export type UsageSummary = {
    calls: number;
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    amountUsd: string;
};

function toSummary(count: number, sum: Partial<Record<keyof typeof sumFields, unknown>>): UsageSummary {
    const int = (value: unknown) => (typeof value === "number" ? value : 0);
    return {
        calls: count,
        inputTokens: int(sum.inputTokens),
        cachedTokens: int(sum.cachedTokens),
        outputTokens: int(sum.outputTokens),
        reasoningTokens: int(sum.reasoningTokens),
        totalTokens: int(sum.totalTokens),
        // 金额始终以字符串下发，避免 JSON 浮点数丢精度
        amountUsd: (sum.amountUsd instanceof Prisma.Decimal ? sum.amountUsd : new Prisma.Decimal(0)).toFixed(8),
    };
}

/** 汇总一组结算记录的调用次数、各类 Token 和金额。 */
export async function summarize(where: Prisma.AiUsageRecordWhereInput): Promise<UsageSummary> {
    const result = await prisma.aiUsageRecord.aggregate({ where, _count: { _all: true }, _sum: sumFields });
    return toSummary(result._count._all, result._sum);
}

/** 按能力、状态或模型分组汇总。 */
export async function summarizeBy(by: "capability" | "status" | "modelId", where: Prisma.AiUsageRecordWhereInput) {
    const rows = await prisma.aiUsageRecord.groupBy({ by: [by], where, _count: { _all: true }, _sum: sumFields });
    return rows.map((row) => ({ key: String(row[by]), ...toSummary(row._count._all, row._sum) }));
}

/** 按项目汇总某个用户的用量，用于「用户 -> 画布项目 -> 调用明细」的中间层。 */
export async function summarizeUserProjects(userId: string) {
    const rows = await prisma.aiUsageRecord.groupBy({ by: ["projectId"], where: { userId }, _count: { _all: true }, _sum: sumFields, _max: { createdAt: true } });
    const projects = await prisma.project.findMany({ where: { id: { in: rows.map((row) => row.projectId).filter((id): id is string => Boolean(id)) } } });
    const names = new Map(projects.map((project) => [project.id, project]));
    return rows
        .map((row) => {
            const project = row.projectId ? names.get(row.projectId) : undefined;
            return {
                // projectId 为空表示图片、视频工作台等非画布调用，归入「独立工作台」分组
                projectId: row.projectId,
                name: project?.name ?? (row.projectId ? "（项目已移除）" : "独立工作台"),
                deletedAt: project?.deletedAt ?? null,
                lastUsedAt: row._max.createdAt,
                ...toSummary(row._count._all, row._sum),
            };
        })
        .sort((a, b) => (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0));
}

/** 补齐各分组的展示名称，让管理界面不必再次请求模型列表。 */
export async function modelNames(ids: string[]) {
    const models = await prisma.model.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, capability: true } });
    return new Map(models.map((model) => [model.id, model]));
}
