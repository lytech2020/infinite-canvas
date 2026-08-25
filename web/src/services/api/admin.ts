import { backendDownload, backendRequest, type PagedResult } from "./backend";

export type Capability = "text" | "image" | "video" | "audio";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type UsageSummary = {
    calls: number;
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
};

export type UsageGroup = UsageSummary & { key: string; modelName?: string; capability?: Capability | null };

export type AdminOverview = {
    users: { total: number; activeIn30Days: number };
    runningJobs: number;
    today: UsageSummary;
    month: UsageSummary;
    custom: UsageSummary;
    byCapability: UsageGroup[];
    byStatus: UsageGroup[];
    byModel: UsageGroup[];
};

export type UsageFilters = Partial<{
    userId: string;
    projectId: string;
    modelId: string;
    capability: Capability;
    status: JobStatus;
    source: "canvas" | "image_workbench" | "video_workbench" | "other";
    usageSource: "provider" | "estimated" | "none";
    from: string;
    to: string;
}>;

export type UsageDetail = {
    jobId: string;
    createdAt: string;
    durationMs: number | null;
    userId: string;
    userEmail: string;
    projectId: string | null;
    projectName: string | null;
    source: string;
    modelId: string;
    modelName: string;
    capability: Capability;
    status: JobStatus;
    errorCode: string | null;
    totalTokens: number;
    usageSource: "provider" | "estimated" | "none" | null;
};

export type PromptDetail = {
    jobId: string;
    createdAt: string;
    userId: string;
    userEmail: string;
    projectId: string | null;
    projectName: string | null;
    modelName: string;
    capability: Capability;
    source: string;
    prompt: string;
};

export type AdminProvider = {
    id: string;
    name: string;
    apiFormat: "openai" | "openrouter" | "azure_openai" | "gemini" | "ark";
    baseUrl: string;
    apiKeyMask: string;
    apiVersion: string | null;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
};

export type AdminModel = {
    id: string;
    providerId: string;
    displayName: string;
    remoteName: string;
    capability: Capability;
    paramSchema: Record<string, unknown>;
    fileLimits: Record<string, unknown>;
    maxOutputCount: number | null;
    maxConcurrency: number | null;
    enabled: boolean;
    isDefault: boolean;
    sortOrder: number;
};

function queryString<T extends object>(values: T) {
    const query = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => value !== undefined && value !== null && query.set(key, String(value)));
    return query.toString();
}

export function fetchAdminOverview(filters: Pick<UsageFilters, "from" | "to">) {
    return backendRequest<AdminOverview>(`/admin/overview?${queryString(filters)}`);
}

export function fetchAdminUsage(filters: UsageFilters & { page: number; pageSize: number }) {
    return backendRequest<PagedResult<UsageDetail> & { summary: UsageSummary }>(`/admin/usage?${queryString(filters)}`);
}

export function downloadAdminUsage(filters: UsageFilters) {
    return backendDownload(`/admin/usage/export.csv?${queryString(filters)}`);
}

export function fetchAdminPrompts(filters: UsageFilters & { keyword?: string; page: number; pageSize: number }) {
    return backendRequest<PagedResult<PromptDetail>>(`/admin/prompts?${queryString(filters)}`);
}

export function fetchAdminProviders() {
    return backendRequest<{ items: AdminProvider[] }>("/admin/providers");
}

export function saveAdminProvider(values: Omit<AdminProvider, "id" | "apiKeyMask" | "createdAt" | "updatedAt"> & { id?: string; apiKey?: string }) {
    const { id, ...body } = values;
    return backendRequest<{ provider: AdminProvider }>(id ? `/admin/providers/${id}` : "/admin/providers", { method: id ? "PATCH" : "POST", body });
}

export function deleteAdminProvider(id: string) {
    return backendRequest<{ ok: boolean }>(`/admin/providers/${id}`, { method: "DELETE" });
}

export function fetchAdminModels(filters: Pick<UsageFilters, "capability"> = {}) {
    return backendRequest<{ items: AdminModel[] }>(`/admin/models?${queryString(filters)}`);
}

export function saveAdminModel(values: Omit<AdminModel, "id"> & { id?: string }) {
    const { id, ...body } = values;
    return backendRequest<{ model: AdminModel }>(id ? `/admin/models/${id}` : "/admin/models", { method: id ? "PATCH" : "POST", body });
}

export function deleteAdminModel(id: string) {
    return backendRequest<{ ok: boolean }>(`/admin/models/${id}`, { method: "DELETE" });
}

export function fetchAdminSettings() {
    return backendRequest<{ registrationOpen: boolean }>("/admin/settings");
}

export function saveAdminSettings(registrationOpen: boolean) {
    return backendRequest<{ registrationOpen: boolean }>("/admin/settings", { method: "PATCH", body: { registrationOpen } });
}
