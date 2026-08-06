import { Router } from "express";

import { prisma } from "../../../db.js";
import { encryptSecret } from "../../../lib/crypto.js";
import { writeAuditLog } from "../../../modules/audit.js";
import { providerBody } from "../../../modules/catalog/schemas.js";
import { adminProvider } from "../../../modules/catalog/service.js";
import { ApiError, ok, param, route } from "../../response.js";

export const adminProvidersRouter = Router();

adminProvidersRouter.get(
    "/",
    route(async (_req, res) => {
        const providers = await prisma.provider.findMany({ orderBy: { createdAt: "desc" } });
        ok(res, { items: providers.map(adminProvider) });
    }),
);

adminProvidersRouter.post(
    "/",
    route(async (req, res) => {
        const body = providerBody.parse(req.body);
        if (!body.apiKey) throw new ApiError("VALIDATION_FAILED", "新增渠道必须提供 API Key");
        const provider = await prisma.provider.create({
            data: { name: body.name, apiFormat: body.apiFormat, baseUrl: body.baseUrl, apiKeyCipher: encryptSecret(body.apiKey), apiVersion: body.apiVersion ?? null, enabled: body.enabled ?? true },
        });
        await writeAuditLog(req.user!.id, "provider.create", "provider", provider.id, { name: provider.name });
        ok(res, { provider: adminProvider(provider) });
    }),
);

/** 更新渠道；未提交 apiKey 时保留原密钥，避免管理界面回显明文。 */
adminProvidersRouter.patch(
    "/:id",
    route(async (req, res) => {
        const body = providerBody.partial().parse(req.body);
        if (!(await prisma.provider.findUnique({ where: { id: param(req, "id") } }))) throw new ApiError("NOT_FOUND", "渠道不存在");
        const provider = await prisma.provider.update({
            where: { id: param(req, "id") },
            data: {
                name: body.name,
                apiFormat: body.apiFormat,
                baseUrl: body.baseUrl,
                apiVersion: body.apiVersion,
                enabled: body.enabled,
                ...(body.apiKey ? { apiKeyCipher: encryptSecret(body.apiKey) } : {}),
            },
        });
        await writeAuditLog(req.user!.id, "provider.update", "provider", provider.id, { apiKeyChanged: Boolean(body.apiKey) });
        ok(res, { provider: adminProvider(provider) });
    }),
);

/** 仍有模型引用的渠道不允许删除，避免历史用量失去关联。 */
adminProvidersRouter.delete(
    "/:id",
    route(async (req, res) => {
        if (await prisma.model.count({ where: { providerId: param(req, "id") } })) throw new ApiError("VALIDATION_FAILED", "该渠道下仍有模型，请先删除模型");
        await prisma.provider.delete({ where: { id: param(req, "id") } });
        await writeAuditLog(req.user!.id, "provider.delete", "provider", param(req, "id"));
        ok(res, { ok: true });
    }),
);
