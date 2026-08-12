import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

import { prisma } from "../../db.js";
import { cancelJob, createJob, publicJob } from "../../modules/generation/service.js";
import { ApiError, ok, param, route } from "../response.js";

const createBody = z.object({
    requestId: z.string().trim().min(1).max(64),
    modelId: z.string().min(1),
    capability: z.enum(["text", "image", "video", "audio"]),
    source: z.enum(["canvas", "image_workbench", "video_workbench", "other"]),
    projectId: z.string().trim().min(1).max(64).optional(),
    projectName: z.string().trim().max(120).optional(),
    nodeId: z.string().trim().max(64).optional(),
    prompt: z.string().min(1).max(20_000),
    params: z.record(z.unknown()).optional(),
    fileIds: z.array(z.string().min(1)).max(20).optional(),
});

export const generationsRouter = Router();
const generationLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    keyGenerator: (req) => req.user!.id,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "生成请求过于频繁，请稍后再试" } }),
});

generationsRouter.post(
    "/",
    generationLimit,
    route(async (req, res) => {
        const body = createBody.parse(req.body);
        if (body.source === "canvas" && !body.projectId) throw new ApiError("VALIDATION_FAILED", "画布调用必须携带 projectId");
        ok(res, { job: await publicJob(await createJob(req.user!, body)) });
    }),
);

generationsRouter.get(
    "/:id",
    route(async (req, res) => {
        const job = await prisma.generationJob.findUnique({ where: { id: param(req, "id") } });
        if (!job || job.userId !== req.user!.id) throw new ApiError("NOT_FOUND", "任务不存在");
        ok(res, { job: await publicJob(job) });
    }),
);

generationsRouter.post(
    "/:id/cancel",
    route(async (req, res) => ok(res, { job: await publicJob(await cancelJob(req.user!.id, param(req, "id"))) })),
);
