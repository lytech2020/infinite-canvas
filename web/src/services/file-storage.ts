import { deleteCloudFile, isCloudFileId, resolveCloudFile, uploadCloudFile } from "@/services/api/cloud-files";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const urls = new Map<string, string>();
const remember = (key: string, url: string) => urls.set(key, url);

export async function uploadMediaFile(input: string | Blob, _prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const file = await uploadCloudFile(blob);
    remember(file.id, file.url);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(file.url) : blob.type.startsWith("audio/") ? await readAudioMeta(file.url) : {};
    return { url: file.url, storageKey: file.id, bytes: file.size, mimeType: file.mimeType, ...meta };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = urls.get(storageKey);
    if (cached) return cached;
    try {
        const file = await resolveCloudFile(storageKey);
        remember(storageKey, file.url);
        return file.url;
    } catch {
        return fallback;
    }
}

export async function getMediaBlob(storageKey: string) {
    try {
        const url = await resolveMediaUrl(storageKey);
        if (!url) return null;
        const response = await fetch(url);
        return response.ok ? response.blob() : null;
    } catch {
        return null;
    }
}

export async function importMediaBlob(blob: Blob) {
    return uploadMediaFile(blob);
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(Array.from(new Set(keys)).map(async (key) => {
        urls.delete(key);
        await deleteCloudFile(key).catch(() => undefined);
    }));
}

export function clearMediaStorageSession() {
    urls.clear();
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && isCloudFileId(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
