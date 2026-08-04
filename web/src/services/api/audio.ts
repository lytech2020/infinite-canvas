import axios from "axios";

import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { buildModelApiHeaders, buildModelApiUrl, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import { errorText } from "@/i18n/error-text";

type RequestOptions = { signal?: AbortSignal };

function aiApiUrl(config: AiConfig, path: string) {
    return buildModelApiUrl(config, path);
}

function aiHeaders(config: AiConfig) {
    return buildModelApiHeaders(config, "application/json");
}

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    const model = requestConfig.model.trim();
    const format = normalizeAudioFormatValue(config.audioFormat);
    const script = resolveModelScript(config, config.model || config.audioModel);
    if (script) {
        if (!model) throw new Error(errorText("audioModelRequired"));
        if (!requestConfig.baseUrl.trim()) throw new Error(errorText("baseUrlRequired"));
        if (!requestConfig.apiKey.trim()) throw new Error(errorText("apiKeyRequired"));
        try {
            const result = await runModelPlugin({
                capability: "audio",
                script,
                config: requestConfig,
                prompt,
                params: { voice: normalizeAudioVoiceValue(config.audioVoice), format, speed: normalizeAudioSpeedValue(config.audioSpeed), instructions: config.audioInstructions.trim() },
                signal: options?.signal,
            });
            return await audioPluginBlob(result, format);
        } catch (error) {
            throw readAxiosError(error, errorText("audioFailed"));
        }
    }
    assertAudioConfig(requestConfig, model);
    const instructions = config.audioInstructions.trim();

    try {
        const response = await axios.post<Blob>(
            aiApiUrl(requestConfig, "/audio/speech"),
            {
                model,
                input: prompt,
                voice: normalizeAudioVoiceValue(config.audioVoice),
                response_format: format,
                speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
                ...(instructions ? { instructions } : {}),
            },
            { headers: aiHeaders(requestConfig), responseType: "blob", signal: options?.signal },
        );
        await assertAudioBlob(response.data);
        return response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: audioMimeType(format) });
    } catch (error) {
        throw readAxiosError(error, errorText("audioFailed"));
    }
}

async function audioPluginBlob(result: unknown, format: string): Promise<Blob> {
    if (result instanceof Blob) return result.type.startsWith("audio/") ? result : new Blob([result], { type: audioMimeType(format) });
    let source = "";
    if (typeof result === "string") source = result;
    else if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        source = typeof record.b64_json === "string" ? record.b64_json : typeof record.data === "string" ? record.data : typeof record.url === "string" ? record.url : "";
    }
    if (!source) throw new Error(errorText("audioMissing"));
    const url = source.startsWith("data:") || /^https?:/i.test(source) ? source : `data:${audioMimeType(format)};base64,${source}`;
    const blob = await (await fetch(url)).blob();
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
}

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}

function assertAudioConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(errorText("audioModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(errorText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(errorText("apiKeyRequired"));
    if (config.apiFormat === "gemini") throw new Error(errorText("audioGeminiUnsupported"));
}

async function assertAudioBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || errorText("audioFailed"));
    if (payload.error?.message) throw new Error(payload.error.message);
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return errorText("htmlResponse", { preview: value.slice(0, 80) });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    const requestError = new Error(
        axios.isCancel(error)
            ? errorText("requestCancelled")
            : axios.isAxiosError(error)
              ? readApiErrorMessage(error.response?.data) || statusMessage(error.response?.status, fallback) || error.message || fallback
              : error instanceof Error
                ? readApiErrorMessage(error.message) || error.message
                : fallback,
    );
    if (axios.isCancel(error) || (error instanceof Error && error.name === "AbortError")) requestError.name = "AbortError";
    return requestError;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return errorText("authFailed");
    if (status === 429) return errorText("rateLimited");
    if (status === 404) return errorText("endpoint404");
    if (status === 502) return errorText("gateway502");
    if (status === 503) return errorText("busy503");
    return status ? errorText("requestFailedHttp", { status }) : fallback;
}
