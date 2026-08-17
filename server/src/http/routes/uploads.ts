import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { Readable } from "node:stream";

import { completeUpload, createUpload, deleteUserUpload, FILE_LIMITS, getUserUploadRecord } from "../../modules/storage/uploads.js";
import { getObjectStream } from "../../modules/storage/s3.js";
import { ok, param, route } from "../response.js";

const presignBody = z.object({ mimeType: z.string().trim().min(1).max(120), size: z.number().int().positive(), persistent: z.boolean().optional() });

export const uploadsRouter = Router();
const uploadLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    keyGenerator: (req) => req.user!.id,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "上传请求过于频繁，请稍后再试" } }),
});

/** 前端上传前展示类型、大小和数量限制。 */
uploadsRouter.get(
    "/limits",
    route((_req, res) => ok(res, { limits: FILE_LIMITS })),
);

uploadsRouter.post(
    "/presign",
    uploadLimit,
    route(async (req, res) => {
        const { mimeType, size, persistent } = presignBody.parse(req.body);
        const { upload, url, expiresInSeconds } = await createUpload(req.user!.id, mimeType, size, persistent);
        ok(res, { uploadId: upload.id, url, method: "PUT", headers: { "Content-Type": mimeType }, expiresInSeconds });
    }),
);

uploadsRouter.get(
    "/:id/metadata",
    route(async (req, res) => {
        const upload = await getUserUploadRecord(req.user!.id, param(req, "id"));
        ok(res, { file: { id: upload.id, url: "", mimeType: upload.mimeType, size: upload.size } });
    }),
);

uploadsRouter.get(
    "/:id/content",
    route(async (req, res) => {
        const upload = await getUserUploadRecord(req.user!.id, param(req, "id"));
        let object;
        try {
            object = await getObjectStream(upload.storageKey, req.get("Range"));
        } catch (error) {
            if (error && typeof error === "object" && "name" in error && error.name === "InvalidRange") {
                res.status(416).set("Content-Range", `bytes */${upload.size}`).end();
                return;
            }
            throw error;
        }
        res.status(object.ContentRange ? 206 : 200);
        res.set({
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=300",
            "Content-Type": object.ContentType || upload.mimeType,
            ...(object.ContentLength === undefined ? {} : { "Content-Length": String(object.ContentLength) }),
            ...(object.ContentRange ? { "Content-Range": object.ContentRange } : {}),
        });
        const body = object.Body;
        if (!body) return void res.end();
        if (!(body instanceof Readable)) return void res.destroy();
        body.once("error", () => res.destroy());
        res.once("close", () => body.destroy());
        body.pipe(res);
    }),
);

uploadsRouter.delete(
    "/:id",
    route(async (req, res) => {
        await deleteUserUpload(req.user!.id, param(req, "id"));
        ok(res, { ok: true });
    }),
);

uploadsRouter.post(
    "/:id/complete",
    route(async (req, res) => {
        const upload = await completeUpload(req.user!.id, param(req, "id"));
        ok(res, { upload: { id: upload.id, mimeType: upload.mimeType, size: upload.size, status: upload.status } });
    }),
);
