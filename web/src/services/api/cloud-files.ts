import { BackendError, backendRequest, backendUrl } from "./backend";

export type CloudFile = { id: string; url: string; mimeType: string; size: number };

// Prisma 当前使用 cuid() 生成 Upload.id；导入导出只接受这种服务端文件标识，避免误处理插件自定义 storageKey。
export function isCloudFileId(value: unknown): value is string {
    return typeof value === "string" && /^c[a-z0-9]{20,30}$/.test(value);
}

export async function uploadCloudFile(blob: Blob, signal?: AbortSignal): Promise<CloudFile> {
    const mimeType = blob.type || "application/octet-stream";
    const presigned = await backendRequest<{ uploadId: string; url: string; method: "PUT"; headers: Record<string, string> }>("/uploads/presign", {
        method: "POST",
        signal,
        body: { mimeType, size: blob.size, persistent: true },
    });
    let response: Response;
    try {
        response = await fetch(presigned.url, { method: presigned.method, headers: presigned.headers, body: blob, signal });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new BackendError("UPLOAD_FAILED");
    }
    if (!response.ok) throw new BackendError("UPLOAD_FAILED");
    await backendRequest(`/uploads/${presigned.uploadId}/complete`, { method: "POST", signal });
    return resolveCloudFile(presigned.uploadId);
}

export async function resolveCloudFile(id: string) {
    const encoded = encodeURIComponent(id);
    const file = (await backendRequest<{ file: CloudFile }>(`/uploads/${encoded}/metadata`)).file;
    return { ...file, url: backendUrl(`/uploads/${encoded}/content`) };
}

export async function deleteCloudFile(id: string) {
    await backendRequest(`/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
}
