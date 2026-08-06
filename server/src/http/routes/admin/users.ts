import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../../db.js";
import { publicUser } from "../../../modules/auth/service.js";
import { revokeUserSessions } from "../../../modules/auth/session.js";
import { modelNames, summarize, summarizeBy, summarizeUserProjects } from "../../../modules/usage/query.js";
import { ApiError, ok, okList, param, route } from "../../response.js";

const listQuery = z.object({
    keyword: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const statusBody = z.object({ status: z.enum(["active", "disabled"]) });

export const adminUsersRouter = Router();

adminUsersRouter.get(
    "/",
    route(async (req, res) => {
        const { keyword, page, pageSize } = listQuery.parse(req.query);
        const where = keyword ? { email: { contains: keyword, mode: "insensitive" as const } } : {};
        const [items, total] = await Promise.all([
            prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
            prisma.user.count({ where }),
        ]);
        // 金额只对当前页用户聚合，避免全表汇总拖慢列表
        const ids = items.map((item) => item.id);
        const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const [allTime, recent] = await Promise.all([
            prisma.aiUsageRecord.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _count: { _all: true }, _sum: { amountUsd: true } }),
            prisma.aiUsageRecord.groupBy({ by: ["userId"], where: { userId: { in: ids }, createdAt: { gte: since } }, _sum: { amountUsd: true } }),
        ]);
        const totals = new Map(allTime.map((row) => [row.userId, row]));
        const recents = new Map(recent.map((row) => [row.userId, row]));
        okList(
            res,
            items.map((item) => ({
                ...publicUser(item),
                calls: totals.get(item.id)?._count._all ?? 0,
                amountUsd: (totals.get(item.id)?._sum.amountUsd ?? new Prisma.Decimal(0)).toFixed(8),
                amountUsdIn30Days: (recents.get(item.id)?._sum.amountUsd ?? new Prisma.Decimal(0)).toFixed(8),
            })),
            total,
            page,
            pageSize,
        );
    }),
);

/** 单个用户的用量画像：总量、按能力和按模型分类，供管理界面的用户详情页使用。 */
adminUsersRouter.get(
    "/:id",
    route(async (req, res) => {
        const user = await prisma.user.findUnique({ where: { id: param(req, "id") } });
        if (!user) throw new ApiError("NOT_FOUND", "用户不存在");
        const where = { userId: user.id };
        const [total, byCapability, byModel, byStatus] = await Promise.all([summarize(where), summarizeBy("capability", where), summarizeBy("modelId", where), summarizeBy("status", where)]);
        const names = await modelNames(byModel.map((row) => row.key));
        ok(res, {
            user: publicUser(user),
            total,
            byCapability,
            byStatus,
            byModel: byModel.map((row) => ({ ...row, modelName: names.get(row.key)?.displayName ?? "（模型已删除）" })),
        });
    }),
);

/** 用户的画布项目用量列表，是「用户 -> 画布项目 -> 调用明细」中间一层；明细走 /admin/usage?projectId=。 */
adminUsersRouter.get(
    "/:id/projects",
    route(async (req, res) => {
        if (!(await prisma.user.findUnique({ where: { id: param(req, "id") } }))) throw new ApiError("NOT_FOUND", "用户不存在");
        ok(res, { items: await summarizeUserProjects(param(req, "id")) });
    }),
);

/** 停用账号的同时撤销其全部会话，避免已登录标签页继续使用。 */
adminUsersRouter.patch(
    "/:id/status",
    route(async (req, res) => {
        const { status } = statusBody.parse(req.body);
        if (param(req, "id") === req.user!.id && status === "disabled") throw new ApiError("FORBIDDEN", "不能停用当前登录的管理员账号");
        if (!(await prisma.user.findUnique({ where: { id: param(req, "id") } }))) throw new ApiError("NOT_FOUND", "用户不存在");
        const user = await prisma.user.update({ where: { id: param(req, "id") }, data: { status } });
        if (status === "disabled") await revokeUserSessions(user.id);
        ok(res, { user: publicUser(user) });
    }),
);
