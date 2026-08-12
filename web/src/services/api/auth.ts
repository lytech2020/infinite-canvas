import { backendRequest, type PagedResult } from "./backend";
import type { UsageGroup, UsageSummary } from "./admin";

export type CloudUser = {
    id: string;
    email: string;
    role: "user" | "admin";
    status: "active" | "disabled";
    createdAt: string;
    lastActiveAt: string | null;
    calls?: number;
    amountUsd?: string;
    amountUsdIn30Days?: string;
    dailyCallLimit?: number | null;
    monthlyBudgetUsd?: string | null;
    concurrencyLimit?: number | null;
    videoConcurrencyLimit?: number | null;
};

export type UserLimits = Pick<CloudUser, "dailyCallLimit" | "monthlyBudgetUsd" | "concurrencyLimit" | "videoConcurrencyLimit">;

export type UserQuotaUsage = {
    dailyCalls: number;
    monthlyAmountUsd: string;
    effectiveConcurrencyLimit: number;
    effectiveVideoConcurrencyLimit: number;
    timezone: string;
    dayResetAt: string;
    monthResetAt: string;
};

export function login(email: string, password: string) {
    return backendRequest<{ user: CloudUser }>("/auth/login", { method: "POST", body: { email, password } });
}

export function register(email: string, password: string) {
    return backendRequest<{ user: CloudUser }>("/auth/register", { method: "POST", body: { email, password } });
}

export function logout() {
    return backendRequest<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

export function changePassword(currentPassword: string, newPassword: string) {
    return backendRequest<{ ok: boolean }>("/auth/password", { method: "POST", body: { currentPassword, newPassword } });
}

export function fetchCurrentUser() {
    return backendRequest<{ user: CloudUser }>("/auth/me");
}

export function fetchRegistrationOpen() {
    return backendRequest<{ open: boolean }>("/auth/registration");
}

export function fetchAdminUsers(params: { keyword?: string; page: number; pageSize: number }) {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize), ...(params.keyword ? { keyword: params.keyword } : {}) });
    return backendRequest<PagedResult<CloudUser>>(`/admin/users?${query}`);
}

export function createAdminUser(email: string, password: string) {
    return backendRequest<{ user: CloudUser }>("/admin/users", { method: "POST", body: { email, password } });
}

export function updateAdminUserStatus(id: string, status: CloudUser["status"]) {
    return backendRequest<{ user: CloudUser }>(`/admin/users/${id}/status`, { method: "PATCH", body: { status } });
}

export function updateAdminUserLimits(id: string, limits: UserLimits) {
    return backendRequest<{ user: CloudUser }>(`/admin/users/${id}/limits`, { method: "PATCH", body: limits });
}

export function fetchAdminUser(id: string) {
    return backendRequest<{ user: CloudUser; quotaUsage: UserQuotaUsage; total: UsageSummary; byCapability: UsageGroup[]; byStatus: UsageGroup[]; byModel: UsageGroup[] }>(`/admin/users/${id}`);
}

export function fetchAdminUserProjects(id: string) {
    return backendRequest<{ items: Array<UsageSummary & { projectId: string | null; name: string; deletedAt: string | null; lastUsedAt: string | null }> }>(`/admin/users/${id}/projects`);
}
