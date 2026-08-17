import { z } from "zod";

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
