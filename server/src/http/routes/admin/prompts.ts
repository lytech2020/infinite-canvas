import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../../db.js";
import { writeAuditLog } from "../../../modules/audit.js";
import { jobWhere, usageFilter } from "../../../modules/usage/query.js";
import { okList, route } from "../../response.js";

export const adminPromptsRouter = Router();

const promptQuery = usageFilter.extend({
    keyword: z.string().trim().min(1).max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    // 提示词只能分页查看，不提供批量导出，页大小同时作为单次可见范围的上限
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * 提示词查看与关键词搜索。
 * 所有管理员都可以查看，用于分析常用关键词和优化产品；每一次查看都写入审计日志，
 * 记录管理员、时间和本次查看范围。参考文件与生成结果不在此返回。
 */
adminPromptsRouter.get(
    "/",
    route(async (req, res) => {
        const query = promptQuery.parse(req.query);
        const where = { ...jobWhere(query), ...(query.keyword ? { promptText: { contains: query.keyword, mode: "insensitive" as const } } : {}) };
        const [items, total] = await Promise.all([
            prisma.generationJob.findMany({
                where,
                select: { id: true, createdAt: true, userId: true, projectId: true, projectNameSnapshot: true, capability: true, source: true, promptText: true, user: { select: { email: true } }, model: { select: { displayName: true } } },
                orderBy: { createdAt: "desc" },
                skip: (query.page - 1) * query.pageSize,
                take: query.pageSize,
            }),
            prisma.generationJob.count({ where }),
        ]);

        await writeAuditLog(req.user!.id, "prompt.view", "generation_job", undefined, {
            keyword: query.keyword ?? null,
            filter: { userId: query.userId ?? null, projectId: query.projectId ?? null, from: query.from ?? null, to: query.to ?? null },
            page: query.page,
            pageSize: query.pageSize,
            viewedJobIds: items.map((item) => item.id),
        });

        okList(
            res,
            items.map((item) => ({
                jobId: item.id,
                createdAt: item.createdAt,
                userId: item.userId,
                userEmail: item.user.email,
                projectId: item.projectId,
                projectName: item.projectNameSnapshot,
                modelName: item.model.displayName,
                capability: item.capability,
                source: item.source,
                prompt: item.promptText,
            })),
            total,
            query.page,
            query.pageSize,
        );
    }),
);
