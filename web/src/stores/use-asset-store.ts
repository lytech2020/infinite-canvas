import { create } from "zustand";
import { nanoid } from "nanoid";

import { readUserData, reportCloudSaveError, writeUserData } from "@/services/api/user-data";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = { id: string; kind: T; title: string; coverUrl: string; tags: string[]; source?: string; note?: string; createdAt: string; updatedAt: string; metadata?: Record<string, unknown> };
type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    loadAssets: () => Promise<void>;
    reset: () => void;
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
};

const STORE_KEY = "asset_store";
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveTask: Promise<void> | null = null;
let loadVersion = 0;
let saveVersion = 0;
let pendingAssets: Asset[] | null = null;

function serialized(assets: Asset[]) {
    return assets.map((asset) => {
        if (asset.kind === "image" && asset.data.storageKey) return { ...asset, coverUrl: "", data: { ...asset.data, dataUrl: "" } };
        if (asset.kind === "video" && asset.data.storageKey) return { ...asset, coverUrl: "", data: { ...asset.data, url: "" } };
        return asset;
    });
}

function scheduleSave(assets: Asset[]) {
    if (saveTimer) clearTimeout(saveTimer);
    pendingAssets = assets;
    const version = saveVersion;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        pendingAssets = null;
        if (version === saveVersion) {
            const task = writeUserData(STORE_KEY, serialized(assets)).catch(reportCloudSaveError).finally(() => { if (saveTask === task) saveTask = null; });
            saveTask = task;
        }
    }, 300);
}

export async function flushPendingAssets() {
    if (!pendingAssets) {
        await saveTask;
        return;
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    const assets = pendingAssets;
    pendingAssets = null;
    await saveTask;
    await writeUserData(STORE_KEY, serialized(assets));
}

async function hydrateAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
    if (asset.kind !== "image") return asset;
    if (asset.data.storageKey) {
        const url = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
        return { ...asset, coverUrl: url, data: { ...asset.data, dataUrl: url } };
    }
    if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
    const image = await uploadImage(asset.data.dataUrl);
    return { ...asset, coverUrl: image.url, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
}

export const useAssetStore = create<AssetStore>()((set, get) => ({
    hydrated: false,
    assets: [],
    loadAssets: async () => {
        const version = ++loadVersion;
        set({ hydrated: false, assets: [] });
        const assets = await readUserData<Asset[]>(STORE_KEY);
        if (version !== loadVersion) return;
        set({ assets: await Promise.all((assets || []).map(hydrateAsset)), hydrated: true });
    },
    reset: () => {
        loadVersion += 1;
        saveVersion += 1;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        saveTask = null;
        pendingAssets = null;
        set({ assets: [], hydrated: false });
    },
    addAsset: (asset) => {
        const now = new Date().toISOString();
        const id = nanoid();
        const assets = [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...get().assets];
        set({ assets });
        scheduleSave(assets);
        return id;
    },
    updateAsset: (id, patch) => {
        const assets = get().assets.map((asset) => asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset);
        set({ assets });
        scheduleSave(assets);
    },
    removeAsset: (id) => {
        const assets = get().assets.filter((asset) => asset.id !== id);
        set({ assets });
        scheduleSave(assets);
    },
    replaceAssets: (assets) => {
        set({ assets });
        scheduleSave(assets);
    },
}));
