import { readImageMeta } from "@/lib/image-utils";
import { errorText } from "@/i18n/error-text";
import { deleteCloudFile, isCloudFileId, resolveCloudFile, uploadCloudFile } from "@/services/api/cloud-files";

export type UploadedImage = { url: string; storageKey: string; width: number; height: number; bytes: number; mimeType: string };

const urls = new Map<string, string>();
const remember = (key: string, url: string) => urls.set(key, url);

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const file = await uploadCloudFile(blob);
    remember(file.id, file.url);
    const meta = await readImageMeta(file.url);
    return { url: file.url, storageKey: file.id, width: meta.width, height: meta.height, bytes: file.size, mimeType: file.mimeType || meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
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

export async function getImageBlob(storageKey: string) {
    try {
        const url = await resolveImageUrl(storageKey);
        if (!url) return null;
        const response = await fetch(url);
        return response.ok ? response.blob() : null;
    } catch {
        return null;
    }
}

export async function importImageBlob(blob: Blob) {
    return uploadImage(blob);
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(Array.from(new Set(keys)).map(async (key) => {
        urls.delete(key);
        await deleteCloudFile(key).catch(() => undefined);
    }));
}

export function clearImageStorageSession() {
    urls.clear();
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && isCloudFileId(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(errorText("imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}
