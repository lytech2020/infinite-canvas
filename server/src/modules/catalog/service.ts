import type { Model, ModelPrice, Provider } from "@prisma/client";

import { prisma } from "../../db.js";
import { decryptSecret, maskSecret } from "../../lib/crypto.js";

/** 管理端渠道输出：只返回密钥掩码，绝不返回明文。 */
export function adminProvider(provider: Provider) {
    return {
        id: provider.id,
        name: provider.name,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl,
        apiKeyMask: maskSecret(decryptSecret(provider.apiKeyCipher)),
        apiVersion: provider.apiVersion,
        enabled: provider.enabled,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
    };
}

/** 管理端模型输出，包含实际调用名称等仅管理员可见字段。 */
export function adminModel(model: Model) {
    return {
        id: model.id,
        providerId: model.providerId,
        displayName: model.displayName,
        remoteName: model.remoteName,
        capability: model.capability,
        paramSchema: model.paramSchema,
        fileLimits: model.fileLimits,
        maxOutputCount: model.maxOutputCount,
        maxConcurrency: model.maxConcurrency,
        enabled: model.enabled,
        isDefault: model.isDefault,
        sortOrder: model.sortOrder,
    };
}

/** 普通用户可见的模型信息：不含渠道、实际调用名称、并发上限和价格。 */
export function publicModel(model: Model) {
    return {
        id: model.id,
        displayName: model.displayName,
        capability: model.capability,
        isDefault: model.isDefault,
        params: model.paramSchema,
        fileLimits: model.fileLimits,
        maxOutputCount: model.maxOutputCount,
    };
}

/** 前端模型列表：只返回启用模型，且其所属渠道也必须启用。 */
export async function listPublicModels() {
    const models = await prisma.model.findMany({
        where: { enabled: true, provider: { enabled: true } },
        orderBy: [{ capability: "asc" }, { sortOrder: "asc" }, { displayName: "asc" }],
    });
    return models.map(publicModel);
}

/** 同一能力下只允许一个默认模型。 */
export async function clearOtherDefaults(capability: Model["capability"], keepModelId?: string) {
    await prisma.model.updateMany({ where: { capability, isDefault: true, ...(keepModelId ? { id: { not: keepModelId } } : {}) }, data: { isDefault: false } });
}

/** 取指定时间生效的价格规则，用于任务结算时复制价格快照。 */
export function findEffectivePrice(prices: ModelPrice[], at: Date) {
    return prices
        .filter((price) => price.effectiveFrom <= at && (!price.effectiveTo || price.effectiveTo > at))
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
}
