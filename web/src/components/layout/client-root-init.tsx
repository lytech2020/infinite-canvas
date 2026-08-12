import type { ReactNode } from "react";
import { useEffect } from "react";

import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { decodeCloudModelId, encodeCloudModel, useCloudModelStore } from "@/stores/use-cloud-model-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const clearProviderConfig = useConfigStore((state) => state.clearProviderConfig);
    const config = useConfigStore((state) => state.config);
    const restoreSession = useUserStore((state) => state.restoreSession);
    const user = useUserStore((state) => state.user);
    const restored = useUserStore((state) => state.restored);
    const loadCloudModels = useCloudModelStore((state) => state.loadModels);
    const clearCloudModels = useCloudModelStore((state) => state.clearModels);

    // 启动时恢复云端登录状态，未登录时静默保持匿名。
    useEffect(() => {
        void restoreSession();
    }, [restoreSession]);

    useEffect(() => {
        if (!restored) return;
        clearProviderConfig();
        if (!user) {
            clearCloudModels();
            return;
        }
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
    }, [clearCloudModels, clearProviderConfig, config.audioModel, config.imageModel, config.model, config.textModel, config.videoModel, loadCloudModels, restored, updateConfig, user]);

    return <>{children}</>;
}
