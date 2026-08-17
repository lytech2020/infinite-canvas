import type { User } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../../db.js";
import { toJson, writeAuditLog } from "../../../modules/audit.js";
import { createUser, publicUser } from "../../../modules/auth/service.js";
import { readUserQuotaUsage } from "../../../modules/quota/service.js";
import { modelNames, summarize, summarizeBy, summarizeUserProjects } from "../../../modules/usage/query.js";
import { ApiError, ok, okList, param, route } from "../../response.js";

const listQuery = z.object({
    keyword: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const statusBody = z.object({ status: z.enum(["active", "disabled"]) });
const createBody = z.object({ email: z.string().email(), password: z.string().min(8).max(16) });
const limitsBody = z.object({
    dailyCallLimit: z.number().int().min(1).max(1_000_000).nullable(),
    concurrencyLimit: z.number().int().min(1).max(1000).nullable(),
    videoConcurrencyLimit: z.number().int().min(1).max(1000).nullable(),
});

function adminUser(user: User) {
    return {
        ...publicUser(user),
        dailyCallLimit: user.dailyCallLimit,
        concurrencyLimit: user.concurrencyLimit,
        videoConcurrencyLimit: user.videoConcurrencyLimit,
    };
}

export const adminUsersRouter = Router();

adminUsersRouter.post(
    "/",
    route(async (req, res) => {
        const { email, password } = createBody.parse(req.body);
        const user = await createUser(email, password);
        await writeAuditLog(req.user!.id, "user.create", "user", user.id, { email: user.email, role: user.role, status: user.status });
        ok(res, { user: adminUser(user) });
    }),
);

adminUsersRouter.get(
    "/",
    route(async (req, res) => {
        const { keyword, page, pageSize } = listQuery.parse(req.query);
        const where = keyword ? { email: { contains: keyword, mode: "insensitive" as const } } : {};
        const [items, total] = await Promise.all([
            prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
            prisma.user.count({ where }),
        ]);
        const ids = items.map((item) => item.id);
        const allTime = await prisma.aiUsageRecord.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _count: { _all: true } });
        const totals = new Map(allTime.map((row) => [row.userId, row]));
        okList(
            res,
            items.map((item) => ({
                ...adminUser(item),
                calls: totals.get(item.id)?._count._all ?? 0,
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
        const [total, byCapability, byModel, byStatus, quotaUsage] = await Promise.all([summarize(where), summarizeBy("capability", where), summarizeBy("modelId", where), summarizeBy("status", where), readUserQuotaUsage(prisma, user)]);
        const names = await modelNames(byModel.map((row) => row.key));
        ok(res, {
            user: adminUser(user),
            total,
            quotaUsage,
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

/** 修改账户限额并记录管理员审计。 */
adminUsersRouter.patch(
    "/:id/limits",
    route(async (req, res) => {
        const body = limitsBody.parse(req.body);
        const user = await prisma.$transaction(async (tx) => {
            if (!(await tx.user.findUnique({ where: { id: param(req, "id") } }))) throw new ApiError("NOT_FOUND", "用户不存在");
            const updated = await tx.user.update({ where: { id: param(req, "id") }, data: body });
            await tx.adminAuditLog.create({ data: { adminId: req.user!.id, action: "user.limits.update", targetType: "user", targetId: updated.id, detail: toJson(body) } });
            return updated;
        });
        ok(res, { user: adminUser(user) });
    }),
);

/** 停用账号的同时撤销其全部会话，避免已登录标签页继续使用。 */
adminUsersRouter.patch(
    "/:id/status",
    route(async (req, res) => {
        const { status } = statusBody.parse(req.body);
        if (param(req, "id") === req.user!.id && status === "disabled") throw new ApiError("FORBIDDEN", "不能停用当前登录的管理员账号");
        const user = await prisma.$transaction(async (tx) => {
            if (!(await tx.user.findUnique({ where: { id: param(req, "id") } }))) throw new ApiError("NOT_FOUND", "用户不存在");
            const updated = await tx.user.update({ where: { id: param(req, "id") }, data: { status } });
            if (status === "disabled") await tx.session.updateMany({ where: { userId: updated.id, revokedAt: null }, data: { revokedAt: new Date() } });
            await tx.adminAuditLog.create({ data: { adminId: req.user!.id, action: "user.status.update", targetType: "user", targetId: updated.id, detail: toJson({ status }) } });
            return updated;
        });
        ok(res, { user: adminUser(user) });
    }),
);
