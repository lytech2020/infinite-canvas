import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../../db.js";
import { toJson, writeAuditLog } from "../../../modules/audit.js";
import { modelBody, priceBody } from "../../../modules/catalog/schemas.js";
import { adminModel, clearOtherDefaults } from "../../../modules/catalog/service.js";
import { ApiError, ok, param, route } from "../../response.js";

export const adminModelsRouter = Router();

adminModelsRouter.get(
    "/",
    route(async (req, res) => {
        const { providerId, capability } = z.object({ providerId: z.string().optional(), capability: z.enum(["text", "image", "video", "audio"]).optional() }).parse(req.query);
        const models = await prisma.model.findMany({ where: { providerId, capability }, orderBy: [{ capability: "asc" }, { sortOrder: "asc" }] });
        ok(res, { items: models.map(adminModel) });
    }),
);

adminModelsRouter.post(
    "/",
    route(async (req, res) => {
        const body = modelBody.parse(req.body);
        if (!(await prisma.provider.findUnique({ where: { id: body.providerId } }))) throw new ApiError("NOT_FOUND", "渠道不存在");
        const model = await prisma.model.create({
            data: {
                providerId: body.providerId,
                displayName: body.displayName,
                remoteName: body.remoteName,
                capability: body.capability,
                paramSchema: toJson(body.paramSchema ?? {}),
                fileLimits: toJson(body.fileLimits ?? {}),
                maxOutputCount: body.maxOutputCount ?? null,
                maxConcurrency: body.maxConcurrency ?? null,
                enabled: body.enabled ?? true,
                isDefault: body.isDefault ?? false,
                sortOrder: body.sortOrder ?? 0,
            },
        });
        if (model.isDefault) await clearOtherDefaults(model.capability, model.id);
        await writeAuditLog(req.user!.id, "model.create", "model", model.id, { displayName: model.displayName });
        ok(res, { model: adminModel(model) });
    }),
);

adminModelsRouter.patch(
    "/:id",
    route(async (req, res) => {
        const body = modelBody.partial().parse(req.body);
        if (!(await prisma.model.findUnique({ where: { id: param(req, "id") } }))) throw new ApiError("NOT_FOUND", "模型不存在");
        if (body.providerId && !(await prisma.provider.findUnique({ where: { id: body.providerId } }))) throw new ApiError("NOT_FOUND", "渠道不存在");
        const model = await prisma.model.update({
            where: { id: param(req, "id") },
            data: {
                providerId: body.providerId,
                displayName: body.displayName,
                remoteName: body.remoteName,
                capability: body.capability,
                paramSchema: body.paramSchema ? toJson(body.paramSchema) : undefined,
                fileLimits: body.fileLimits ? toJson(body.fileLimits) : undefined,
                maxOutputCount: body.maxOutputCount,
                maxConcurrency: body.maxConcurrency,
                enabled: body.enabled,
                isDefault: body.isDefault,
                sortOrder: body.sortOrder,
            },
        });
        if (model.isDefault) await clearOtherDefaults(model.capability, model.id);
        await writeAuditLog(req.user!.id, "model.update", "model", model.id);
        ok(res, { model: adminModel(model) });
    }),
);

/** 已产生调用记录的模型不允许删除，只能停用，否则历史用量会失去模型关联。 */
adminModelsRouter.delete(
    "/:id",
    route(async (req, res) => {
        if (!(await prisma.model.findUnique({ where: { id: param(req, "id") } }))) throw new ApiError("NOT_FOUND", "模型不存在");
        if (await prisma.generationJob.count({ where: { modelId: param(req, "id") } })) throw new ApiError("VALIDATION_FAILED", "该模型已有调用记录，请改为停用");
        await prisma.model.delete({ where: { id: param(req, "id") } });
        await writeAuditLog(req.user!.id, "model.delete", "model", param(req, "id"));
        ok(res, { ok: true });
    }),
);

adminModelsRouter.get(
    "/:id/prices",
    route(async (req, res) => {
        const prices = await prisma.modelPrice.findMany({ where: { modelId: param(req, "id") }, orderBy: { effectiveFrom: "desc" } });
        ok(res, { items: prices });
    }),
);

/** 新增价格规则；历史规则不可修改，改价一律新增一条并记录审计。 */
adminModelsRouter.post(
    "/:id/prices",
    route(async (req, res) => {
        const body = priceBody.parse(req.body);
        if (body.effectiveTo && body.effectiveTo <= body.effectiveFrom) throw new ApiError("VALIDATION_FAILED", "价格结束时间必须晚于生效时间");
        const model = await prisma.model.findUnique({ where: { id: param(req, "id") } });
        if (!model) throw new ApiError("NOT_FOUND", "模型不存在");
        const expectedPricingType = model.capability === "text" ? "token" : model.capability;
        if (body.pricingType !== "fixed" && body.pricingType !== expectedPricingType) throw new ApiError("VALIDATION_FAILED", "计价方式与模型能力不匹配");
        const price = await prisma.modelPrice.create({
            data: { modelId: param(req, "id"), pricingType: body.pricingType, unitPrices: toJson(body.unitPrices), effectiveFrom: body.effectiveFrom, effectiveTo: body.effectiveTo ?? null, createdById: req.user!.id },
        });
        await writeAuditLog(req.user!.id, "model_price.create", "model", param(req, "id"), { priceId: price.id, pricingType: price.pricingType });
        ok(res, { price });
    }),
);

/** 只允许删除尚未生效的价格规则，已生效规则保留以支撑历史金额追溯。 */
adminModelsRouter.delete(
    "/:modelId/prices/:priceId",
    route(async (req, res) => {
        const price = await prisma.modelPrice.findUnique({ where: { id: param(req, "priceId") } });
        if (!price || price.modelId !== param(req, "modelId")) throw new ApiError("NOT_FOUND", "价格规则不存在");
        if (price.effectiveFrom <= new Date()) throw new ApiError("VALIDATION_FAILED", "已生效的价格规则不能删除");
        await prisma.modelPrice.delete({ where: { id: price.id } });
        await writeAuditLog(req.user!.id, "model_price.delete", "model", param(req, "modelId"), { priceId: price.id });
        ok(res, { ok: true });
    }),
);
