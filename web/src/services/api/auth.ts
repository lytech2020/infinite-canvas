import { backendRequest, type PagedResult } from "./backend";

export type CloudUser = {
    id: string;
    email: string;
    role: "user" | "admin";
    status: "active" | "disabled";
    createdAt: string;
    lastActiveAt: string | null;
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

export function updateAdminUserStatus(id: string, status: CloudUser["status"]) {
    return backendRequest<{ user: CloudUser }>(`/admin/users/${id}/status`, { method: "PATCH", body: { status } });
}
