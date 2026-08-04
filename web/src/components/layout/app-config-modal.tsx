import { App, Button, Form, Input, Modal, Progress, Select, Tabs } from "antd";
import { Cloud, Download, Languages, Pencil, Plus, RefreshCw, Trash2, Upload, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { ChannelEditorDrawer } from "@/components/layout/channel-editor-drawer";
import { ConfigPromptSources } from "@/components/layout/config-prompt-sources";
import { exportAppConfig, importAppConfig } from "@/services/config-file";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { selectableLocales } from "@/i18n/locale";
import { createModelChannel, modelOptionsFromChannels, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore, type AiConfig, type ApiCallFormat, type ConfigTabKey, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { useLocaleStore } from "@/stores/use-locale-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    labelKey: string;
};

type WebdavDomainProgress = {
    label: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", labelKey: "preferences.imageModel" },
    { capability: "video", modelKey: "videoModel", labelKey: "preferences.videoModel" },
    { capability: "text", modelKey: "textModel", labelKey: "preferences.textModel" },
    { capability: "audio", modelKey: "audioModel", labelKey: "preferences.audioModel" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
const webdavDomainLabels: Record<AppSyncDomainKey, string> = {
    canvas: "画布",
    assets: "我的资产",
    "image-workbench": "生图工作台",
    "video-workbench": "视频创作台",
};

function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { label: webdavDomainLabels[key], stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigPanel({ showDoneButton = false, initialTab = "channels" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { message } = App.useApp();
    const { t, i18n } = useTranslation(["common", "config"]);
    const configInputRef = useRef<HTMLInputElement>(null);
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
    const [editingChannelId, setEditingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const locale = useLocaleStore((state) => state.locale);
    const setLocale = useLocaleStore((state) => state.setLocale);
    const webdavReady = Boolean(webdav.url.trim());
    const editingChannel = config.channels.find((channel) => channel.id === editingChannelId) || null;
    useEffect(() => setActiveTab(initialTab), [initialTab]);

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(t(shouldPromptContinue ? "savedContinue" : "saved", { ns: "config" }));
        clearPromptContinue();
    };

    const loadConfigFile = async (file: File) => {
        try {
            await importAppConfig(file);
            message.success(t("importExport.imported", { ns: "config" }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("importExport.readFailed", { ns: "config" }));
        } finally {
            if (configInputRef.current) configInputRef.current.value = "";
        }
    };

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withChannels(config, channels));

    const addChannel = () => {
        const channel = createModelChannel({ name: t("channels.generatedName", { ns: "config", number: config.channels.length + 1 }) });
        updateChannels([...config.channels, channel]);
        setEditingChannelId(channel.id);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning(t("channels.minimumOne", { ns: "config" }));
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const saveChannel = (channel: ModelChannel) => {
        updateChannels(config.channels.map((item) => (item.id === channel.id ? channel : item)));
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error(t("webdav.missingUrl", { ns: "config" }));
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success(t("webdav.available", { ns: "config" }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("webdav.testFailed", { ns: "config" }));
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                label: event.label || webdavDomainLabels[event.domain as AppSyncDomainKey],
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error(t("webdav.missingUrl", { ns: "config" }));
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus(t("webdav.preparing", { ns: "config" }));
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(t("webdav.completed", { ns: "config", projects: result.projects, assets: result.assets, logs: result.imageLogs + result.videoLogs, files: result.uploadedFiles, bytes: formatBytes(result.uploadedBytes) }));
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : t("webdav.syncFailed", { ns: "config" }));
            message.error(error instanceof Error ? error.message : t("webdav.syncFailed", { ns: "config" }));
        } finally {
            setSyncingWebdav(false);
        }
    };

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                <div className="text-xs text-stone-500">{t("importExport.warning", { ns: "config" })}</div>
                <div className="flex gap-2">
                    <Button icon={<Upload className="size-4" />} onClick={() => configInputRef.current?.click()}>
                        {t("importExport.import", { ns: "config" })}
                    </Button>
                    <Button icon={<Download className="size-4" />} onClick={exportAppConfig}>
                        {t("importExport.export", { ns: "config" })}
                    </Button>
                    <input ref={configInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void loadConfigFile(event.target.files[0])} />
                </div>
            </div>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as ConfigTabKey)}
                items={[
                    {
                        key: "channels",
                        label: t("tabs.channels", { ns: "config" }),
                        children: (
                            <div>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-xs text-stone-500">{t("channels.description", { ns: "config" })}</div>
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                        {t("channels.add", { ns: "config" })}
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {config.channels.map((channel) => (
                                        <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold">{channel.name || t("channels.unnamed", { ns: "config" })}</div>
                                                <div className="mt-1 truncate text-xs text-stone-500">
                                                    {apiFormatLabel(channel.apiFormat)} · {t("channels.count", { ns: "config", count: channel.models.length })} · {channel.baseUrl || t("channels.missingUrl", { ns: "config" })}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 gap-2">
                                                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingChannelId(channel.id)}>
                                                    {t("actions.edit")}
                                                </Button>
                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ),
                    },
                    {
                        key: "preferences",
                        label: t("tabs.preferences", { ns: "config" }),
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                                    <Languages className="size-4" />
                                    {t("language.section", { ns: "config" })}
                                </div>
                                <Form.Item label={t("language.label", { ns: "config" })} extra={t("language.description", { ns: "config" })} className="mb-5 max-w-sm">
                                    <Select
                                        value={locale}
                                        options={selectableLocales.map((value) => ({ value, label: t(value === "ja-JP" ? "language.options.jaJP" : "language.options.zhCN", { ns: "config" }) }))}
                                        onChange={setLocale}
                                    />
                                </Form.Item>
                                <div className="mb-2 text-sm font-semibold">{t("preferences.defaultModels", { ns: "config" })}</div>
                                <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={t(group.labelKey, { ns: "config" })} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="mb-2 text-sm font-semibold">{t("preferences.generation", { ns: "config" })}</div>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label={t("preferences.canvasImageCount", { ns: "config" })} extra={t("preferences.canvasImageCountHelp", { ns: "config" })} className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label={t("preferences.audioVoice", { ns: "config" })} className="mb-4">
                                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("preferences.audioFormat", { ns: "config" })} className="mb-4">
                                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("preferences.audioSpeed", { ns: "config" })} className="mb-4">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                        />
                                    </Form.Item>
                                </div>
                                <Form.Item label={t("preferences.audioInstructions", { ns: "config" })} className="mb-4">
                                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder={t("preferences.audioInstructionsPlaceholder", { ns: "config" })} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                                <Form.Item label={t("preferences.systemPrompt", { ns: "config" })} className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder={t("preferences.systemPromptPlaceholder", { ns: "config" })} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            </Form>
                        ),
                    },
                    {
                        key: "prompt-sources",
                        label: t("tabs.promptSources", { ns: "config" }),
                        children: <ConfigPromptSources />,
                    },
                    {
                        key: "webdav",
                        label: "WebDAV",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <Cloud className="size-4" />
                                                {t("webdav.sync", { ns: "config" })}
                                            </div>
                                            <div className="mt-1 text-xs text-stone-500">{t("webdav.description", { ns: "config" })}</div>
                                        </div>
                                        <div className="text-xs text-stone-500">{webdav.lastSyncedAt ? t("webdav.lastSync", { ns: "config", time: formatWebdavTime(webdav.lastSyncedAt, i18n.language) }) : t("webdav.neverSynced", { ns: "config" })}</div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label={t("webdav.url", { ns: "config" })} className="mb-4">
                                            <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("webdav.directory", { ns: "config" })} extra={t("webdav.directoryHelp", { ns: "config", manifest: WEBDAV_MANIFEST_FILE_NAME })} className="mb-4">
                                            <Input value={webdav.directory} placeholder="infinite-canvas" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("webdav.username", { ns: "config" })} className="mb-0">
                                            <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("webdav.password", { ns: "config" })} className="mb-0">
                                            <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                            {t("webdav.test", { ns: "config" })}
                                        </Button>
                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {t(syncingWebdav ? "webdav.syncing" : "webdav.syncNow", { ns: "config" })}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-stone-500">{localizeWebdavStage(webdavSyncStatus, t)}</span> : null}
                                    </div>
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                ]}
            />
            {showDoneButton ? (
                <div className="mt-4 flex justify-end">
                    <Button type="primary" onClick={finishConfig}>
                        {t("actions.done")}
                    </Button>
                </div>
            ) : null}
            <ChannelEditorDrawer open={Boolean(editingChannel)} channel={editingChannel} onSave={saveChannel} onClose={() => setEditingChannelId("")} />
        </>
    );
}

export function AppConfigModal() {
    const { t } = useTranslation("config");
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">{t("title")}</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">{t("subtitle")}</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
        azureApiVersion: channels[0]?.azureApiVersion || config.azureApiVersion,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "azure-openai") return "Azure OpenAI";
    if (apiFormat === "gemini") return "Gemini";
    if (apiFormat === "ark") return "火山方舟";
    return "OpenAI";
}

function formatWebdavTime(value: string, locale: string) {
    return new Date(value).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress> }) {
    const { t } = useTranslation("config");
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{t(`webdav.domains.${key === "image-workbench" ? "imageWorkbench" : key === "video-workbench" ? "videoWorkbench" : key}`)}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {localizeWebdavStage(item.stage, t)}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function localizeWebdavStage(stage: string, t: (key: string) => string) {
    const key = stage === "等待同步" ? "waiting" : stage === "等待本地数据加载" ? "waitingLocal" : stage === "同步完成" ? "completed" : stage === "读取远端清单" ? "remote" : stage === "读取本地数据" ? "local" : stage === "下载缺失媒体" ? "download" : stage === "写入本地合并结果" ? "merge" : stage === "上传新增媒体" ? "uploadMedia" : stage === "媒体已齐全" ? "mediaReady" : stage === "媒体无需上传" ? "mediaSkipped" : stage === "完成" ? "done" : stage === "同步失败" ? "syncFailed" : stage === "检查缺失媒体" ? "checkMissing" : stage === "下载媒体" ? "downloadMedia" : stage === "检查本地媒体" ? "checkLocal" : stage.startsWith("上传清单") ? "uploadManifest" : stage.startsWith("上传媒体") ? "uploadMediaProgress" : "";
    if (!key) return stage;
    const suffix = stage.match(/^(?:上传清单|上传媒体)\s+(.+)$/)?.[1];
    return `${t(`webdav.stages.${key}`)}${suffix ? ` ${suffix}` : ""}`;
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
