import { create } from "zustand";

import { backendRequest } from "@/services/api/backend";

export type CloudModelCapability = "text" | "image" | "video" | "audio";

export type CloudModel = {
    id: string;
    displayName: string;
    capability: CloudModelCapability;
    isDefault: boolean;
    params: unknown;
    fileLimits: unknown;
    maxOutputCount: number | null;
};

const CLOUD_CHANNEL_ID = "cloud";
const CLOUD_MODEL_PREFIX = `${CLOUD_CHANNEL_ID}::`;

type CloudModelStore = {
    models: CloudModel[];
    loaded: boolean;
    loadModels: () => Promise<CloudModel[]>;
    clearModels: () => void;
};

export const useCloudModelStore = create<CloudModelStore>()((set) => ({
    models: [],
    loaded: false,
    loadModels: async () => {
        const { items } = await backendRequest<{ items: CloudModel[] }>("/models");
        set({ models: items, loaded: true });
        return items;
    },
    clearModels: () => set({ models: [], loaded: false }),
}));

export function encodeCloudModel(modelId: string) {
    return `${CLOUD_MODEL_PREFIX}${modelId}`;
}

export function decodeCloudModelId(value: string) {
    return value.startsWith(CLOUD_MODEL_PREFIX) ? value.slice(CLOUD_MODEL_PREFIX.length) : null;
}

export function cloudModel(value: string) {
    const id = decodeCloudModelId(value);
    return id ? useCloudModelStore.getState().models.find((model) => model.id === id) : undefined;
}

export function cloudModelsByCapability(capability?: CloudModelCapability) {
    const models = useCloudModelStore.getState().models;
    return capability ? models.filter((model) => model.capability === capability) : models;
}
