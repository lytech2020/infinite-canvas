import { errorText } from "@/i18n/error-text";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export function backendUrl(path: string) {
    return `${API_BASE}/api/v1${path}`;
}

/** 后台返回的稳定错误代码；前端只依据 code 选择文案，不解析 message。 */
export class BackendError extends Error {
    constructor(
        readonly code: string,
        readonly details?: Record<string, unknown>,
    ) {
        super(errorText(`backend.${code}`, details) || code);
    }
}

type BackendResponse<T> = { data?: T; error?: { code: string; message?: string; details?: Record<string, unknown> } };

/** 请求云端后台；会话使用同源 Cookie，无需前端保存令牌。 */
export async function backendRequest<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal; keepalive?: boolean }) {
    let response: Response;
    try {
        const method = init?.method || "GET";
        const mutating = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
        response = await fetch(backendUrl(path), {
            method,
            credentials: "include",
            headers: { ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }), ...(mutating ? { "X-Requested-With": "infinite-canvas" } : {}) },
            body: init?.body === undefined ? undefined : JSON.stringify(init.body),
            signal: init?.signal,
            keepalive: init?.keepalive,
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new BackendError("NETWORK_ERROR");
    }
    const payload = (await response.json().catch(() => ({}))) as BackendResponse<T>;
    if (!response.ok || payload.error) {
        const code = payload.error?.code || "INTERNAL_ERROR";
        if (code === "AUTH_REQUIRED" && path !== "/auth/me" && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("auth-session-invalid"));
        throw new BackendError(code, payload.error?.details);
    }
    return payload.data as T;
}

/** 下载后台生成的文件；失败时仍按统一错误代码显示本地化文案。 */
export async function backendDownload(path: string) {
    let response: Response;
    try {
        response = await fetch(backendUrl(path), { credentials: "include" });
    } catch {
        throw new BackendError("NETWORK_ERROR");
    }
    if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as BackendResponse<never>;
        throw new BackendError(payload.error?.code || "INTERNAL_ERROR", payload.error?.details);
    }
    return response.blob();
}

export type PagedResult<T> = { items: T[]; total: number; page: number; pageSize: number };
