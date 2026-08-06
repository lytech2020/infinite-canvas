import type { Model, Provider } from "@prisma/client";

import { decryptSecret } from "../../../lib/crypto.js";

const AZURE_DEFAULT_API_VERSION = "preview";

/**
 * 拼接供应商请求地址。
 * OpenAI 兼容渠道使用 `{base}/v1{path}`；Azure OpenAI 使用 `{endpoint}/openai/v1{path}?api-version=`，
 * 与前端 `buildModelApiUrl` 保持一致，避免迁移后行为变化。
 */
export function providerUrl(provider: Provider, path: string) {
    const base = provider.baseUrl.trim().replace(/\/+$/, "");
    if (provider.apiFormat !== "azure_openai") {
        const lower = base.toLowerCase();
        return `${lower.endsWith("/v1") || lower.endsWith("/api/v3") ? base : `${base}/v1`}${path}`;
    }
    const endpoint = base.replace(/\/openai(?:\/v1)?$/i, "");
    const apiVersion = provider.apiVersion?.trim() || AZURE_DEFAULT_API_VERSION;
    return `${endpoint}/openai/v1${path}?api-version=${encodeURIComponent(apiVersion)}`;
}

/** Azure OpenAI 使用 api-key 头，其余 OpenAI 兼容渠道使用 Bearer。 */
export function providerHeaders(provider: Provider) {
    const apiKey = decryptSecret(provider.apiKeyCipher);
    return {
        "Content-Type": "application/json",
        ...(provider.apiFormat === "azure_openai" ? { "api-key": apiKey } : { Authorization: `Bearer ${apiKey}` }),
    };
}

/** 供应商返回的错误统一在这里取出可读信息，具体内容只写入任务的 errorDetail。 */
async function readError(response: Response, payload: { error?: { message?: string } }) {
    return payload.error?.message || `供应商返回 HTTP ${response.status}`;
}

export type ImageGenerationResult = { images: Array<{ data: Buffer; mimeType: string }>; providerRequestId?: string; usage?: Record<string, unknown> };

type ImagePayload = {
    id?: string;
    created?: number;
    data?: Array<{ b64_json?: string; url?: string }>;
    usage?: Record<string, unknown>;
    error?: { message?: string };
};

/** 把接口返回的 base64 或临时 URL 统一取成二进制，后续由后台写入对象存储。 */
async function readImages(payload: ImagePayload, signal: AbortSignal) {
    const items = payload.data || [];
    if (!items.length) throw new Error("供应商没有返回图片");
    return Promise.all(
        items.map(async (item) => {
            if (item.b64_json) return { data: Buffer.from(item.b64_json, "base64"), mimeType: "image/png" };
            if (!item.url) throw new Error("供应商返回的图片既没有内容也没有地址");
            const file = await fetch(item.url, { signal });
            if (!file.ok) throw new Error(`下载生成图片失败，HTTP ${file.status}`);
            return { data: Buffer.from(await file.arrayBuffer()), mimeType: file.headers.get("content-type") || "image/png" };
        }),
    );
}

/** 文生图。 */
export async function generateImage(provider: Provider, model: Model, prompt: string, params: Record<string, unknown>, signal: AbortSignal): Promise<ImageGenerationResult> {
    const body: Record<string, unknown> = { model: model.remoteName, prompt };
    if (typeof params.size === "string") body.size = params.size;
    if (typeof params.quality === "string") body.quality = params.quality;
    if (typeof params.background === "string") body.background = params.background;
    if (typeof params.count === "number") body.n = params.count;

    const response = await fetch(providerUrl(provider, "/images/generations"), { method: "POST", headers: providerHeaders(provider), body: JSON.stringify(body), signal });
    const payload = (await response.json().catch(() => ({}))) as ImagePayload;
    if (!response.ok || payload.error) throw new Error(await readError(response, payload));
    return { images: await readImages(payload, signal), providerRequestId: payload.id, usage: payload.usage };
}

/** 图生图 / 图片编辑；参考图以 multipart 提交，因此不能复用 JSON 请求头。 */
export async function editImage(
    provider: Provider,
    model: Model,
    prompt: string,
    params: Record<string, unknown>,
    references: Array<{ data: Buffer; mimeType: string; filename: string }>,
    signal: AbortSignal,
): Promise<ImageGenerationResult> {
    const form = new FormData();
    form.append("model", model.remoteName);
    form.append("prompt", prompt);
    if (typeof params.size === "string") form.append("size", params.size);
    if (typeof params.quality === "string") form.append("quality", params.quality);
    if (typeof params.count === "number") form.append("n", String(params.count));
    // 单图用 image，多图用 image[]，与供应商接口约定一致。
    const field = references.length > 1 ? "image[]" : "image";
    for (const reference of references) form.append(field, new Blob([new Uint8Array(reference.data)], { type: reference.mimeType }), reference.filename);

    const { "Content-Type": _ignored, ...headers } = providerHeaders(provider);
    const response = await fetch(providerUrl(provider, "/images/edits"), { method: "POST", headers, body: form, signal });
    const payload = (await response.json().catch(() => ({}))) as ImagePayload;
    if (!response.ok || payload.error) throw new Error(await readError(response, payload));
    return { images: await readImages(payload, signal), providerRequestId: payload.id, usage: payload.usage };
}

export type TextGenerationResult = { text: string; providerRequestId?: string; usage?: Record<string, unknown> };

type ResponsesPayload = {
    id?: string;
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    usage?: Record<string, unknown>;
    error?: { message?: string; code?: string };
};

/** 从 Responses 接口结果中取出纯文本，兼容 output_text 与分段 output 两种形态。 */
function readText(payload: ResponsesPayload) {
    if (payload.output_text) return payload.output_text;
    return (payload.output || [])
        .flatMap((item) => item.content || [])
        .filter((part) => part.type === "output_text" && part.text)
        .map((part) => part.text)
        .join("");
}

/** 调用 OpenAI 兼容的 Responses 接口生成文本。 */
export async function generateText(provider: Provider, model: Model, prompt: string, params: Record<string, unknown>, signal: AbortSignal): Promise<TextGenerationResult> {
    const body: Record<string, unknown> = {
        model: model.remoteName,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
    };
    if (typeof params.temperature === "number") body.temperature = params.temperature;
    if (typeof params.maxOutputTokens === "number") body.max_output_tokens = params.maxOutputTokens;
    if (typeof params.reasoningEffort === "string" && params.reasoningEffort !== "auto") body.reasoning = { effort: params.reasoningEffort };

    const response = await fetch(providerUrl(provider, "/responses"), { method: "POST", headers: providerHeaders(provider), body: JSON.stringify(body), signal });
    const payload = (await response.json().catch(() => ({}))) as ResponsesPayload;
    if (!response.ok || payload.error) throw new Error(payload.error?.message || `供应商返回 HTTP ${response.status}`);

    const text = readText(payload);
    if (!text) throw new Error("供应商没有返回文本内容");
    return { text, providerRequestId: payload.id, usage: payload.usage };
}
