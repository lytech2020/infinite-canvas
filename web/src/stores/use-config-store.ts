import { useMemo } from "react";
import { create } from "zustand";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { cloudModel, cloudModelsByCapability, decodeCloudModelId, encodeCloudModel } from "@/stores/use-cloud-model-store";
import { readUserData, reportCloudSaveError, writeUserData } from "@/services/api/user-data";

// 渠道名只在“没有名字”时按当前语言生成，已有名字一律保留,切换语言不改写用户数据
const defaultChannelName = () => i18n.t("defaultChannel", { ns: "config" });
const generatedChannelName = (number: number) => i18n.t("channels.generatedName", { ns: "config", number });

export type ApiCallFormat = "openai" | "azure-openai" | "gemini" | "ark";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    script?: string;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    azureApiVersion: string;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    azureApiVersion: string;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "preferences";

const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const AZURE_OPENAI_BASE_URL = "https://admin-6149-resource.services.ai.azure.com";
const AZURE_OPENAI_API_VERSION = "preview";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    azureApiVersion: AZURE_OPENAI_API_VERSION,
    channels: [
        {
            id: "default",
            name: "默认渠道",
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            azureApiVersion: AZURE_OPENAI_API_VERSION,
            models: [
                { name: "gpt-image-2", capability: "image" },
                { name: "grok-imagine-video", capability: "video" },
                { name: "gpt-5.5", capability: "text" },
                { name: "gpt-4o-mini-tts", capability: "audio" },
            ],
        },
    ],
    model: "default::gpt-image-2",
    imageModel: "default::gpt-image-2",
    videoModel: "default::grok-imagine-video",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: ["default::gpt-image-2", "default::grok-imagine-video", "default::gpt-5.5", "default::gpt-4o-mini-tts"],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "1",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    hydrated: boolean;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    clearProviderConfig: () => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
    loadConfig: () => Promise<void>;
    reset: () => void;
};

const VIDEO_KEYWORDS = ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    const remote = cloudModel(value);
    if (remote) return remote.capability;
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    const fallbackModel = capability === "image" ? defaultConfig.imageModel : capability === "video" ? defaultConfig.videoModel : capability === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    if (currentModel && modelMatchesCapability(config, currentModel, capability)) return currentModel;
    if (defaultModel && modelMatchesCapability(config, defaultModel, capability)) return defaultModel;
    return fallbackModel;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    const remote = cloudModelsByCapability(capability).map((model) => encodeCloudModel(model.id));
    return remote;
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

function isAiConfigReady(_config: AiConfig, model: string) {
    return Boolean(decodeCloudModelId(model) && cloudModel(model));
}

let configSaveTimer: ReturnType<typeof setTimeout> | null = null;
let configSaveTask: Promise<void> | null = null;
let configLoadVersion = 0;
let configSaveVersion = 0;
let pendingConfig: AiConfig | null = null;
function saveConfig(config: AiConfig) {
    if (configSaveTimer) clearTimeout(configSaveTimer);
    pendingConfig = config;
    const version = configSaveVersion;
    configSaveTimer = setTimeout(() => {
        configSaveTimer = null;
        pendingConfig = null;
        const safe = { ...config, baseUrl: "", apiKey: "", apiFormat: "openai" as const, azureApiVersion: "", channels: [], models: [], systemPrompt: "" };
        if (version === configSaveVersion) {
            const task = writeUserData("ai_config", safe).catch(reportCloudSaveError).finally(() => { if (configSaveTask === task) configSaveTask = null; });
            configSaveTask = task;
        }
    }, 200);
}

export async function flushPendingConfig() {
    if (!pendingConfig) {
        await configSaveTask;
        return;
    }
    if (configSaveTimer) clearTimeout(configSaveTimer);
    configSaveTimer = null;
    const config = pendingConfig;
    pendingConfig = null;
    await configSaveTask;
    await writeUserData("ai_config", { ...config, baseUrl: "", apiKey: "", apiFormat: "openai" as const, azureApiVersion: "", channels: [], models: [], systemPrompt: "" });
}

function normalizeSavedConfig(saved?: Partial<AiConfig> | null) {
    const config = { ...defaultConfig, ...(saved || {}) };
    if (!Array.isArray(saved?.channels)) config.channels = [];
    const channels = normalizeChannels(config);
    return {
        ...config,
        channelMode: "local" as const,
        apiFormat: normalizeApiFormat(config.apiFormat),
        azureApiVersion: config.azureApiVersion || AZURE_OPENAI_API_VERSION,
        channels,
        models: modelOptionsFromChannels(channels),
        imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels),
        videoModel: normalizeModelOptionValue(config.videoModel, channels),
        textModel: normalizeModelOptionValue(config.textModel || config.model, channels),
        audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels),
        audioVoice: config.audioVoice || defaultConfig.audioVoice,
        audioFormat: config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: config.audioInstructions || "",
        reasoningEffort: config.reasoningEffort || "auto",
        videoSeconds: config.videoSeconds || "6",
        vquality: config.vquality || "720",
        videoGenerateAudio: config.videoGenerateAudio || "true",
        videoWatermark: config.videoWatermark || "false",
        canvasImageCount: config.canvasImageCount || defaultConfig.canvasImageCount,
    };
}

export const useConfigStore = create<ConfigStore>()((set, get) => ({
            hydrated: false,
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "preferences",
            shouldPromptContinue: false,
            updateConfig: (key, value) => {
                const config = { ...get().config, [key]: value };
                set({ config }); saveConfig(config);
            },
            clearProviderConfig: () => {
                const config = { ...get().config, baseUrl: "", apiKey: "", apiFormat: "openai" as const, azureApiVersion: "", channels: [], models: [], systemPrompt: "" };
                set({ config });
            },
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "preferences") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
            loadConfig: async () => {
                const version = ++configLoadVersion;
                const config = normalizeSavedConfig(await readUserData<Partial<AiConfig>>("ai_config"));
                if (version === configLoadVersion) set({ config, hydrated: true });
            },
            reset: () => {
                configLoadVersion += 1;
                configSaveVersion += 1;
                if (configSaveTimer) clearTimeout(configSaveTimer);
                configSaveTimer = null;
                configSaveTask = null;
                pendingConfig = null;
                set({ hydrated: false, config: defaultConfig, webdav: defaultWebdavSyncConfig, isConfigOpen: false, shouldPromptContinue: false });
            },
}));

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        result.push({ name, capability, script });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || i18n.t("channels.unnamed", { ns: "config" }),
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        azureApiVersion: channel?.azureApiVersion?.trim() || AZURE_OPENAI_API_VERSION,
        models: normalizeChannelModels(channel?.models),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const remote = cloudModel(value);
    if (remote) return remote.displayName;
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: defaultChannelName(), baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
        azureApiVersion: channel.azureApiVersion,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? defaultChannelName() : generatedChannelName(index + 1)),
            models: normalizeChannelModels(channel.models),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: defaultChannelName(),
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                azureApiVersion: config.azureApiVersion || AZURE_OPENAI_API_VERSION,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "azure-openai") return AZURE_OPENAI_BASE_URL;
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    if (apiFormat === "ark") return ARK_BASE_URL;
    return OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "azure-openai" || apiFormat === "gemini" || apiFormat === "ark" ? apiFormat : "openai";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

export function buildModelApiUrl(config: Pick<AiConfig, "baseUrl" | "apiFormat" | "azureApiVersion">, path: string) {
    if (config.apiFormat !== "azure-openai") return buildApiUrl(config.baseUrl, path);
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const endpoint = config.baseUrl
        .trim()
        .replace(/\/+$/, "")
        .replace(/\/openai(?:\/v1)?$/i, "");
    const url = `${endpoint}/openai/v1${normalizedPath}`;
    const apiVersion = config.azureApiVersion.trim() || AZURE_OPENAI_API_VERSION;
    return `${url}${url.includes("?") ? "&" : "?"}api-version=${encodeURIComponent(apiVersion)}`;
}

export function buildModelApiHeaders(config: Pick<AiConfig, "apiKey" | "apiFormat">, contentType?: string) {
    return {
        ...(config.apiFormat === "azure-openai" ? { "api-key": config.apiKey } : { Authorization: `Bearer ${config.apiKey}` }),
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
