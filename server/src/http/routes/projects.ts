import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../db.js";
import { ApiError, ok, param, route } from "../response.js";

const registerBody = z.object({ id: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(120) });
const renameBody = z.object({ name: z.string().trim().min(1).max(120) });

export const projectsRouter = Router();

/** 登记画布项目；同一 ID 重复提交视为确认存在，只更新名称，不会重复创建。 */
projectsRouter.post(
    "/",
    route(async (req, res) => {
        const body = registerBody.parse(req.body);
        const existing = await prisma.project.findUnique({ where: { id: body.id } });
        if (existing && existing.userId !== req.user!.id) throw new ApiError("FORBIDDEN", "该项目属于其他用户");
        const project = await prisma.project.upsert({
            where: { id: body.id },
            update: { name: body.name, deletedAt: null },
            create: { id: body.id, userId: req.user!.id, name: body.name },
        });
        ok(res, { project });
    }),
);

projectsRouter.get(
    "/:id",
    route(async (req, res) => {
        const project = await prisma.project.findUnique({ where: { id: param(req, "id") } });
        if (!project || project.userId !== req.user!.id) throw new ApiError("NOT_FOUND", "项目不存在");
        ok(res, { project });
    }),
);

projectsRouter.patch(
    "/:id",
    route(async (req, res) => {
        const { name } = renameBody.parse(req.body);
        const existing = await prisma.project.findUnique({ where: { id: param(req, "id") } });
        if (!existing || existing.userId !== req.user!.id) throw new ApiError("NOT_FOUND", "项目不存在");
        ok(res, { project: await prisma.project.update({ where: { id: param(req, "id") }, data: { name } }) });
    }),
);

/** 软删除；保留项目名称快照和历史用量关联，管理后台仍可查询。 */
projectsRouter.delete(
    "/:id",
    route(async (req, res) => {
        const existing = await prisma.project.findUnique({ where: { id: param(req, "id") } });
        if (!existing || existing.userId !== req.user!.id) throw new ApiError("NOT_FOUND", "项目不存在");
        await prisma.project.update({ where: { id: param(req, "id") }, data: { deletedAt: new Date() } });
        ok(res, { ok: true });
    }),
);
