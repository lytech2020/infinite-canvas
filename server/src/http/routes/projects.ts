import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../../db.js";
import { ApiError, ok, param, route } from "../response.js";
import { removeUploadReferences, syncUploadReferences } from "../../modules/storage/upload-references.js";

const projectData = z.record(z.string(), z.unknown());
const registerBody = z.object({ id: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(120), data: projectData });
const updateBody = z.object({ name: z.string().trim().min(1).max(120).optional(), data: projectData.optional(), version: z.number().int().nonnegative() }).refine((value) => value.name !== undefined || value.data !== undefined);

export const projectsRouter = Router();

projectsRouter.get(
    "/",
    route(async (req, res) => {
        const projects = await prisma.project.findMany({ where: { userId: req.user!.id, deletedAt: null }, orderBy: { updatedAt: "desc" } });
        ok(res, { projects });
    }),
);

/** 新建画布项目；已存在的 ID 必须走带版本校验的更新接口。 */
projectsRouter.post(
    "/",
    route(async (req, res) => {
        const body = registerBody.parse(req.body);
        const existing = await prisma.project.findUnique({ where: { id: body.id } });
        if (existing && existing.userId !== req.user!.id) throw new ApiError("FORBIDDEN", "该项目属于其他用户");
        if (existing) throw new ApiError("CONFLICT", "项目已存在", { currentVersion: existing.version });
        let project;
        try {
            project = await prisma.$transaction(async (tx) => {
                const created = await tx.project.create({ data: { id: body.id, userId: req.user!.id, name: body.name, data: body.data as never } });
                await syncUploadReferences(tx, req.user!.id, "project", body.id, body.data);
                return created;
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ApiError("CONFLICT", "项目已存在");
            throw error;
        }
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
        const body = updateBody.parse(req.body);
        const id = param(req, "id");
        const existing = await prisma.project.findUnique({ where: { id } });
        if (!existing || existing.userId !== req.user!.id || existing.deletedAt) throw new ApiError("NOT_FOUND", "项目不存在");
        const project = await prisma.$transaction(async (tx) => {
            const updated = await tx.project.updateMany({
                where: { id, userId: req.user!.id, deletedAt: null, version: body.version },
                data: { ...(body.name === undefined ? {} : { name: body.name }), ...(body.data === undefined ? {} : { data: body.data as never }), version: { increment: 1 } },
            });
            if (!updated.count) throw new ApiError("CONFLICT", "画布已在其他页面更新", { currentVersion: existing.version });
            if (body.data !== undefined) await syncUploadReferences(tx, req.user!.id, "project", id, body.data);
            return tx.project.findUniqueOrThrow({ where: { id } });
        });
        ok(res, { project });
    }),
);

/** 软删除；保留项目名称快照和历史用量关联，管理后台仍可查询。 */
projectsRouter.delete(
    "/:id",
    route(async (req, res) => {
        const existing = await prisma.project.findUnique({ where: { id: param(req, "id") } });
        if (!existing || existing.userId !== req.user!.id) throw new ApiError("NOT_FOUND", "项目不存在");
        await prisma.$transaction(async (tx) => {
            await tx.project.update({ where: { id: param(req, "id") }, data: { deletedAt: new Date() } });
            await removeUploadReferences(tx, req.user!.id, "project", param(req, "id"));
        });
        ok(res, { ok: true });
    }),
);
