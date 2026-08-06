import { Router } from "express";
import { z } from "zod";

import { completeUpload, createUpload, FILE_LIMITS } from "../../modules/storage/uploads.js";
import { ok, param, route } from "../response.js";

const presignBody = z.object({ mimeType: z.string().trim().min(1).max(120), size: z.number().int().positive() });

export const uploadsRouter = Router();

/** 前端上传前展示类型、大小和数量限制。 */
uploadsRouter.get(
    "/limits",
    route((_req, res) => ok(res, { limits: FILE_LIMITS })),
);

uploadsRouter.post(
    "/presign",
    route(async (req, res) => {
        const { mimeType, size } = presignBody.parse(req.body);
        const { upload, url, expiresInSeconds } = await createUpload(req.user!.id, mimeType, size);
        ok(res, { uploadId: upload.id, url, method: "PUT", headers: { "Content-Type": mimeType }, expiresInSeconds });
    }),
);

uploadsRouter.post(
    "/:id/complete",
    route(async (req, res) => {
        const upload = await completeUpload(req.user!.id, param(req, "id"));
        ok(res, { upload: { id: upload.id, mimeType: upload.mimeType, size: upload.size, status: upload.status } });
    }),
);
