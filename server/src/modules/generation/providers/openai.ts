import type { Model, Provider } from "@prisma/client";
import sharp from "sharp";

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
    mask?: { data: Buffer; mimeType: string; filename: string },
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
    if (mask) form.append("mask", new Blob([new Uint8Array(mask.data)], { type: mask.mimeType }), mask.filename);

    const { "Content-Type": _ignored, ...headers } = providerHeaders(provider);
    const response = await fetch(providerUrl(provider, "/images/edits"), { method: "POST", headers, body: form, signal });
    const payload = (await response.json().catch(() => ({}))) as ImagePayload;
    if (!response.ok || payload.error) throw new Error(await readError(response, payload));
    return { images: await readImages(payload, signal), providerRequestId: payload.id, usage: payload.usage };
}

export type TextGenerationResult = { text: string; providerRequestId?: string; usage?: Record<string, unknown> };
export type AudioGenerationResult = { data: Buffer; mimeType: string; providerRequestId?: string };
export type VideoGenerationResult = { data: Buffer; mimeType: string; providerRequestId?: string; seconds?: number };
export type VideoReference = { data: Buffer; mimeType: string; filename: string; role: "reference_image" | "reference_video" | "reference_audio" };

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
export async function generateText(
    provider: Provider,
    model: Model,
    prompt: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    references: Array<{ data: Buffer; mimeType: string }> = [],
): Promise<TextGenerationResult> {
    const input = textInput(params, prompt);
    const referenceParts = references.map((reference) => ({ type: "input_image", image_url: `data:${reference.mimeType};base64,${reference.data.toString("base64")}` }));
    if (referenceParts.length) input.push({ role: "user", content: referenceParts });
    const body: Record<string, unknown> = {
        model: model.remoteName,
        input,
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

/** 只接受文本角色消息，避免把前端任意对象原样转发给供应商。 */
function textInput(params: Record<string, unknown>, prompt: string): Array<Record<string, unknown>> {
    if (!Array.isArray(params.messages)) return [{ role: "user", content: [{ type: "input_text", text: prompt }] }];
    const messages = params.messages.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const { role, content } = item as { role?: unknown; content?: unknown };
        if ((role !== "system" && role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) return [];
        return [{ role, content: [{ type: "input_text", text: content }] }];
    });
    return messages.length ? messages : [{ role: "user", content: [{ type: "input_text", text: prompt }] }];
}

/** 语音生成；二进制结果交给任务层写入对象存储。 */
export async function generateAudio(provider: Provider, model: Model, prompt: string, params: Record<string, unknown>, signal: AbortSignal): Promise<AudioGenerationResult> {
    const format = typeof params.format === "string" ? params.format : "mp3";
    const body = {
        model: model.remoteName,
        input: prompt,
        voice: typeof params.voice === "string" ? params.voice : "alloy",
        response_format: format,
        ...(typeof params.speed === "number" ? { speed: params.speed } : {}),
        ...(typeof params.instructions === "string" && params.instructions.trim() ? { instructions: params.instructions } : {}),
    };
    const response = await fetch(providerUrl(provider, "/audio/speech"), { method: "POST", headers: providerHeaders(provider), body: JSON.stringify(body), signal });
    if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(payload.error?.message || `供应商返回 HTTP ${response.status}`);
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0] || audioMimeType(format);
    const data = Buffer.from(await response.arrayBuffer());
    if (mimeType.includes("json")) {
        const payload = JSON.parse(data.toString("utf8")) as { error?: { message?: string }; message?: string; msg?: string };
        throw new Error(payload.error?.message || payload.message || payload.msg || "供应商没有返回音频内容");
    }
    return { data, mimeType: mimeType.startsWith("audio/") ? mimeType : audioMimeType(format), providerRequestId: response.headers.get("x-request-id") || undefined };
}

function audioMimeType(format: string) {
    if (format === "wav") return "audio/wav";
    if (format === "opus") return "audio/opus";
    if (format === "aac") return "audio/aac";
    if (format === "flac") return "audio/flac";
    return "audio/mpeg";
}

/** 视频生成由后台完成供应商任务创建和轮询，前端只观察本系统 GenerationJob。 */
export async function generateVideo(
    provider: Provider,
    model: Model,
    prompt: string,
    params: Record<string, unknown>,
    references: VideoReference[],
    signal: AbortSignal,
    onCreated?: (providerRequestId: string) => Promise<void>,
): Promise<VideoGenerationResult> {
    return provider.apiFormat === "ark" ? generateArkVideo(provider, model, prompt, params, references, signal, onCreated) : generateOpenAIVideo(provider, model, prompt, params, references, signal, onCreated);
}

async function generateOpenAIVideo(provider: Provider, model: Model, prompt: string, params: Record<string, unknown>, references: VideoReference[], signal: AbortSignal, onCreated?: (providerRequestId: string) => Promise<void>) {
    if (references.some((reference) => reference.role !== "reference_image")) throw new Error("当前视频接口不支持参考视频或音频");
    if (references.length > 1) throw new Error("OpenAI 视频接口只支持一张参考图");
    const form = new FormData();
    form.append("model", model.remoteName);
    form.append("prompt", prompt);
    const seconds = typeof params.seconds === "number" ? (provider.apiFormat === "azure_openai" ? (params.seconds <= 4 ? 4 : params.seconds <= 8 ? 8 : 12) : params.seconds) : undefined;
    if (seconds) form.append("seconds", String(seconds));
    if (typeof params.size === "string") form.append("size", params.size);
    if (provider.apiFormat !== "azure_openai" && typeof params.resolution === "string") form.append("resolution_name", params.resolution);
    let images = references.filter((reference) => reference.role === "reference_image").slice(0, 1);
    if (images.length) {
        const size = typeof params.size === "string" ? /^(\d+)x(\d+)$/.exec(params.size) : null;
        if (!size) throw new Error("OpenAI 视频参考图需要有效的目标尺寸");
        const width = Number(size[1]);
        const height = Number(size[2]);
        images = await Promise.all(
            images.map(async (image) => ({
                ...image,
                data: await sharp(image.data).resize(width, height, { fit: "cover", position: "centre" }).png().toBuffer(),
                mimeType: "image/png",
                filename: "input-reference.png",
            })),
        );
    }
    for (const image of images) form.append("input_reference", new Blob([new Uint8Array(image.data)], { type: image.mimeType }), image.filename);
    const { "Content-Type": _ignored, ...headers } = providerHeaders(provider);
    const createdResponse = await fetch(providerUrl(provider, "/videos"), { method: "POST", headers, body: form, signal });
    const created = await readVideoPayload(createdResponse);
    if (!created.id) throw new Error("供应商没有返回视频任务 ID");
    await onCreated?.(created.id);

    for (;;) {
        await providerDelay(2500, signal);
        const stateResponse = await fetch(providerUrl(provider, `/videos/${created.id}`), { headers: providerHeaders(provider), signal });
        const state = await readVideoPayload(stateResponse);
        const url = videoUrl(state);
        if (url) return { ...(await downloadVideo(url, signal)), providerRequestId: created.id, seconds };
        if (state.status === "completed" || state.status === "succeeded") {
            const content = await fetch(providerUrl(provider, `/videos/${created.id}/content`), { headers: providerHeaders(provider), signal });
            if (!content.ok) throw new Error(`下载生成视频失败，HTTP ${content.status}`);
            const mimeType = content.headers.get("content-type")?.split(";")[0] || "video/mp4";
            return { data: Buffer.from(await content.arrayBuffer()), mimeType: mimeType.startsWith("video/") ? mimeType : "video/mp4", providerRequestId: created.id, seconds };
        }
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") throw new Error(state.error?.message || "供应商视频任务失败");
    }
}

async function generateArkVideo(provider: Provider, model: Model, prompt: string, params: Record<string, unknown>, references: VideoReference[], signal: AbortSignal, onCreated?: (providerRequestId: string) => Promise<void>) {
    const content: Array<Record<string, unknown>> = prompt.trim() ? [{ type: "text", text: prompt }] : [];
    for (const reference of references) {
        const url = `data:${reference.mimeType};base64,${reference.data.toString("base64")}`;
        if (reference.role === "reference_image") content.push({ type: "image_url", image_url: { url }, role: reference.role });
        if (reference.role === "reference_video") content.push({ type: "video_url", video_url: { url }, role: reference.role });
        if (reference.role === "reference_audio") content.push({ type: "audio_url", audio_url: { url }, role: reference.role });
    }
    const createdResponse = await fetch(providerUrl(provider, "/contents/generations/tasks"), {
        method: "POST",
        headers: providerHeaders(provider),
        body: JSON.stringify({ model: model.remoteName, content, ratio: params.ratio, resolution: params.resolution, duration: params.seconds, generate_audio: params.generateAudio, watermark: params.watermark }),
        signal,
    });
    const created = await readVideoPayload(createdResponse);
    if (!created.id) throw new Error("供应商没有返回视频任务 ID");
    await onCreated?.(created.id);
    for (;;) {
        await providerDelay(5000, signal);
        const response = await fetch(providerUrl(provider, `/contents/generations/tasks/${created.id}`), { headers: providerHeaders(provider), signal });
        const state = await readVideoPayload(response);
        const url = videoUrl(state);
        if (url) return { ...(await downloadVideo(url, signal)), providerRequestId: created.id, seconds: typeof params.seconds === "number" ? params.seconds : undefined };
        if (state.status === "completed" || state.status === "succeeded") throw new Error("供应商视频任务成功但没有返回结果地址");
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") throw new Error(state.error?.message || "供应商视频任务失败");
    }
}

type VideoPayload = { id?: string; status?: string; url?: string; result_url?: string; video_url?: string; content?: { url?: string; video_url?: string } | null; error?: { message?: string } };

async function readVideoPayload(response: Response): Promise<VideoPayload> {
    const payload = (await response.json().catch(() => ({}))) as VideoPayload & { data?: VideoPayload; message?: string; msg?: string; code?: number | string };
    if (!response.ok || (payload.code !== undefined && payload.code !== 0 && payload.code !== "0")) throw new Error(payload.error?.message || payload.message || payload.msg || `供应商返回 HTTP ${response.status}`);
    return payload.data || payload;
}

function videoUrl(payload: VideoPayload) {
    return payload.video_url || payload.result_url || payload.url || payload.content?.video_url || payload.content?.url;
}

async function downloadVideo(url: string, signal: AbortSignal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`下载生成视频失败，HTTP ${response.status}`);
    const mimeType = response.headers.get("content-type")?.split(";")[0] || "video/mp4";
    return { data: Buffer.from(await response.arrayBuffer()), mimeType: mimeType.startsWith("video/") ? mimeType : "video/mp4" };
}

function providerDelay(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}
