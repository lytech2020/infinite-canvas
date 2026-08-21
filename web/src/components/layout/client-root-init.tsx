import type { ReactNode } from "react";
import { useEffect } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { useConfigStore } from "@/stores/use-config-store";
import { subscribeAuthChanges, useUserStore } from "@/stores/use-user-store";
import { decodeCloudModelId, encodeCloudModel, useCloudModelStore } from "@/stores/use-cloud-model-store";
import { flushPendingCloudProjects, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { usePluginStore } from "@/stores/canvas/use-plugin-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { resetLoadedPlugins } from "@/lib/canvas/plugin-loader";
import { resetPromptCache } from "@/services/api/prompts";
import { clearImageStorageSession } from "@/services/image-storage";
import { clearMediaStorageSession } from "@/services/file-storage";
import { resetCloudUserDataSession } from "@/services/api/user-data";
import { resetAgentChatStorage } from "@/services/agent-chat-storage";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation("errors");
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const clearProviderConfig = useConfigStore((state) => state.clearProviderConfig);
    const config = useConfigStore((state) => state.config);
    const configHydrated = useConfigStore((state) => state.hydrated);
    const restoreSession = useUserStore((state) => state.restoreSession);
    const user = useUserStore((state) => state.user);
    const restored = useUserStore((state) => state.restored);
    const loadCloudModels = useCloudModelStore((state) => state.loadModels);
    const clearCloudModels = useCloudModelStore((state) => state.clearModels);

    // 启动时恢复云端登录状态，未登录时静默保持匿名。
    useEffect(() => {
        if (!localStorage.getItem("infinite-canvas:cloud-storage-cleanup-v1")) {
            for (const key of ["infinite-canvas:canvas_store", "infinite-canvas:asset_store", "infinite-canvas:plugin_store", "infinite-canvas:prompt_source_store_v2", "infinite-canvas:ai_config_store", "canvas-image-quick-tools-v6", "canvas-agent-url", "canvas-agent-token", "canvas-agent-model", "canvas-agent-reasoning-effort", "canvas-agent-permission-mode"]) localStorage.removeItem(key);
            indexedDB.deleteDatabase("infinite-canvas");
            indexedDB.deleteDatabase("infinite-canvas-plugins");
            localStorage.setItem("infinite-canvas:cloud-storage-cleanup-v1", "1");
        }
        void restoreSession();
        const unsubscribe = subscribeAuthChanges();
        const onInvalid = () => {
            window.dispatchEvent(new CustomEvent("auth-session-expired"));
            void restoreSession();
        };
        window.addEventListener("auth-session-invalid", onInvalid);
        return () => {
            unsubscribe();
            window.removeEventListener("auth-session-invalid", onInvalid);
        };
    }, [restoreSession]);

    useEffect(() => {
        const onSaveError = (event: Event) => message.error({ key: "cloud-save-error", content: (event as CustomEvent<{ message?: string }>).detail?.message || t("cloudSaveFailed") });
        const onSaveConflict = () => message.warning({ key: "cloud-save-conflict", content: t("cloudSaveConflict") });
        const onSessionExpired = () => message.warning({ key: "auth-session-expired", content: t("authSessionExpired") });
        window.addEventListener("cloud-save-error", onSaveError);
        window.addEventListener("cloud-save-conflict", onSaveConflict);
        window.addEventListener("auth-session-expired", onSessionExpired);
        return () => {
            window.removeEventListener("cloud-save-error", onSaveError);
            window.removeEventListener("cloud-save-conflict", onSaveConflict);
            window.removeEventListener("auth-session-expired", onSessionExpired);
        };
    }, [message, t]);

    useEffect(() => {
        const flush = () => flushPendingCloudProjects(true);
        const flushWhenHidden = () => { if (document.visibilityState === "hidden") flush(); };
        window.addEventListener("pagehide", flush);
        document.addEventListener("visibilitychange", flushWhenHidden);
        return () => {
            window.removeEventListener("pagehide", flush);
            document.removeEventListener("visibilitychange", flushWhenHidden);
        };
    }, []);

    useEffect(() => {
        if (!restored) return;
        resetCloudUserDataSession();
        resetAgentChatStorage();
        useCanvasStore.getState().reset();
        useAssetStore.getState().reset();
        resetLoadedPlugins();
        usePluginStore.getState().reset();
        resetPromptCache();
        usePromptSourceStore.getState().reset();
        useAgentStore.getState().reset();
        clearImageStorageSession();
        clearMediaStorageSession();
        useConfigStore.getState().reset();
        if (!user) return;
        void Promise.all([
            useCanvasStore.getState().loadProjects(),
            useAssetStore.getState().loadAssets(),
            usePluginStore.getState().loadPlugins(),
            usePromptSourceStore.getState().loadSources(),
            useConfigStore.getState().loadConfig(),
        ]).catch((error) => {
            if (!(error instanceof DOMException && error.name === "AbortError")) message.error(t("cloudLoadFailed"));
        });
    }, [message, restored, t, user?.id]);

    useEffect(() => {
        if (!restored) return;
        if (!user) {
            clearCloudModels();
            return;
        }
        if (!configHydrated) return;
        clearProviderConfig();
        void loadCloudModels().then((models) => {
            const imageModels = models.filter((model) => model.capability === "image");
            const textModels = models.filter((model) => model.capability === "text");
            const audioModels = models.filter((model) => model.capability === "audio");
            const videoModels = models.filter((model) => model.capability === "video");
            const imageModel = imageModels.find((model) => model.id === decodeCloudModelId(config.imageModel)) || imageModels.find((model) => model.isDefault) || imageModels[0];
            const textModel = textModels.find((model) => model.id === decodeCloudModelId(config.textModel)) || textModels.find((model) => model.isDefault) || textModels[0];
            const audioModel = audioModels.find((model) => model.id === decodeCloudModelId(config.audioModel)) || audioModels.find((model) => model.isDefault) || audioModels[0];
            const videoModel = videoModels.find((model) => model.id === decodeCloudModelId(config.videoModel)) || videoModels.find((model) => model.isDefault) || videoModels[0];
            if (imageModel) {
                const value = encodeCloudModel(imageModel.id);
                if (config.imageModel !== value) updateConfig("imageModel", value);
                if (config.model !== value) updateConfig("model", value);
            }
            if (textModel && config.textModel !== encodeCloudModel(textModel.id)) updateConfig("textModel", encodeCloudModel(textModel.id));
            if (audioModel && config.audioModel !== encodeCloudModel(audioModel.id)) updateConfig("audioModel", encodeCloudModel(audioModel.id));
            if (videoModel && config.videoModel !== encodeCloudModel(videoModel.id)) updateConfig("videoModel", encodeCloudModel(videoModel.id));
        }).catch(() => undefined);
    }, [clearCloudModels, clearProviderConfig, config.audioModel, config.imageModel, config.model, config.textModel, config.videoModel, configHydrated, loadCloudModels, restored, updateConfig, user]);

    return <>{children}</>;
}
