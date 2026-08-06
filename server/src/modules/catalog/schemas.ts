import { z } from "zod";

/** 金额一律用字符串保存，避免 JSON 浮点数丢精度。 */
const priceValue = z.string().regex(/^\d+(\.\d{1,10})?$/, "单价必须是最多 10 位小数的非负数");

/** 用户可调参数定义；前端据此渲染参数控件和范围。 */
export const paramSchema = z.record(
    z.object({
        type: z.enum(["enum", "number", "boolean", "string"]),
        values: z.array(z.string()).optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    }),
);

/** 模型自身的文件限制，缺省时使用后台默认值。 */
export const fileLimitsSchema = z
    .object({
        image: z.object({ maxCount: z.number().int().positive(), maxSizeMb: z.number().positive() }),
        video: z.object({ maxCount: z.number().int().positive(), maxSizeMb: z.number().positive() }),
        audio: z.object({ maxCount: z.number().int().positive(), maxSizeMb: z.number().positive() }),
    })
    .partial();

/** 各计费方式对应的单价字段，均为可选，按 pricingType 使用其中一部分。 */
export const unitPricesSchema = z
    .object({
        inputPerMillionTokens: priceValue,
        cachedPerMillionTokens: priceValue,
        outputPerMillionTokens: priceValue,
        reasoningPerMillionTokens: priceValue,
        perImage: priceValue,
        // 按尺寸或「尺寸:质量」区分的图片单价，形如 { "1024x1024": "0.04", "1024x1024:high": "0.167" }
        perImageByVariant: z.record(priceValue),
        perVideo: priceValue,
        perVideoSecond: priceValue,
        // 按分辨率区分的视频每秒单价，形如 { "1080p": "0.5" }
        perVideoSecondByResolution: z.record(priceValue),
        perAudioMinute: priceValue,
        perMillionCharacters: priceValue,
        perCall: priceValue,
    })
    .partial();

export const providerBody = z.object({
    name: z.string().trim().min(1).max(60),
    apiFormat: z.enum(["openai", "azure_openai", "gemini", "ark"]),
    baseUrl: z.string().url(),
    apiKey: z.string().min(1).optional(),
    apiVersion: z.string().trim().max(60).nullish(),
    enabled: z.boolean().optional(),
});

export const modelBody = z.object({
    providerId: z.string().min(1),
    displayName: z.string().trim().min(1).max(60),
    remoteName: z.string().trim().min(1).max(120),
    capability: z.enum(["text", "image", "video", "audio"]),
    paramSchema: paramSchema.optional(),
    fileLimits: fileLimitsSchema.optional(),
    maxOutputCount: z.number().int().positive().nullish(),
    maxConcurrency: z.number().int().positive().nullish(),
    enabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
});

export const priceBody = z.object({
    pricingType: z.enum(["token", "image", "video", "audio", "fixed"]),
    unitPrices: unitPricesSchema,
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().nullish(),
});
