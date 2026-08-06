import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../../db.js";
import { jobWhere, recordWhere, summarize, usageFilter } from "../../../modules/usage/query.js";
import { ok, route } from "../../response.js";

export const adminUsageRouter = Router();

const listQuery = usageFilter.extend({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

const include = { model: { select: { displayName: true, remoteName: true } }, user: { select: { email: true } }, usage: true } as const;

type JobWithUsage = Awaited<ReturnType<typeof prisma.generationJob.findMany<{ include: typeof include }>>>[number];

/**
 * 明细行不包含提示词正文、参考文件和生成结果。
 * 提示词只在 `/admin/prompts` 提供，并且每次查看都会写入审计日志。
 */
function detailRow(job: JobWithUsage) {
    const usage = job.usage;
    return {
        jobId: job.id,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        durationMs: job.startedAt && job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : null,
        userId: job.userId,
        userEmail: job.user.email,
        projectId: job.projectId,
        projectName: job.projectNameSnapshot,
        nodeId: job.nodeId,
        source: job.source,
        modelId: job.modelId,
        modelName: job.model.displayName,
        capability: job.capability,
        status: job.status,
        errorCode: job.errorCode,
        providerRequestId: job.providerRequestId,
        inputTokens: usage?.inputTokens ?? 0,
        cachedTokens: usage?.cachedTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        reasoningTokens: usage?.reasoningTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
        mediaUnits: usage?.mediaUnits ?? null,
        usageSource: usage?.usageSource ?? null,
        usageEstimationMethod: usage?.usageEstimationMethod ?? null,
        tokenizerName: usage?.tokenizerName ?? null,
        tokenizerVersion: usage?.tokenizerVersion ?? null,
        amountUsd: usage ? usage.amountUsd.toFixed(8) : null,
        priceSnapshot: usage?.priceSnapshot ?? null,
        calculationDetail: usage?.calculationDetail ?? null,
    };
}

/** 调用明细，附带当前筛选条件下的合计，方便管理员核对供应商账单。 */
adminUsageRouter.get(
    "/",
    route(async (req, res) => {
        const query = listQuery.parse(req.query);
        const where = jobWhere(query);
        const [items, total, summary] = await Promise.all([
            prisma.generationJob.findMany({ where, include, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
            prisma.generationJob.count({ where }),
            summarize(recordWhere(query)),
        ]);
        res.json({ data: { items: items.map(detailRow), total, page: query.page, pageSize: query.pageSize, summary } });
    }),
);

const csvColumns = [
    ["jobId", "调用ID"],
    ["createdAt", "创建时间"],
    ["userEmail", "用户"],
    ["projectId", "项目ID"],
    ["projectName", "项目名称"],
    ["source", "来源"],
    ["modelName", "模型"],
    ["capability", "能力"],
    ["status", "状态"],
    ["errorCode", "错误代码"],
    ["inputTokens", "输入Token"],
    ["cachedTokens", "缓存Token"],
    ["outputTokens", "输出Token"],
    ["reasoningTokens", "推理Token"],
    ["totalTokens", "总Token"],
    ["usageSource", "用量来源"],
    ["amountUsd", "金额USD"],
] as const;

/** 转义 CSV 字段，避免逗号、引号和换行破坏结构。 */
function csvCell(value: unknown) {
    if (value === null || value === undefined) return "";
    const text = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * 导出用量与金额 CSV。
 * 导出内容不含提示词正文：第一阶段明确禁止批量导出提示词。
 */
adminUsageRouter.get(
    "/export.csv",
    route(async (req, res) => {
        const query = usageFilter.parse(req.query);
        const jobs = await prisma.generationJob.findMany({ where: jobWhere(query), include, orderBy: { createdAt: "desc" }, take: 20000 });
        const rows = jobs.map(detailRow).map((row) => csvColumns.map(([key]) => csvCell(row[key])).join(","));
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="usage-${new Date().toISOString().slice(0, 10)}.csv"`);
        // BOM 让 Excel 正确识别 UTF-8
        res.send(`﻿${[csvColumns.map(([, label]) => label).join(","), ...rows].join("\n")}\n`);
    }),
);

/** 按能力、状态、模型和来源的分组汇总，供管理界面画概览图表。 */
adminUsageRouter.get(
    "/summary",
    route(async (req, res) => {
        const query = usageFilter.parse(req.query);
        ok(res, { summary: await summarize(recordWhere(query)) });
    }),
);
