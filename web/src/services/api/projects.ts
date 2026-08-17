import { backendRequest } from "./backend";

export type CloudProject<T = Record<string, unknown>> = { id: string; name: string; data: T; version: number; createdAt: string; updatedAt: string; deletedAt: string | null };

export async function listCloudProjects<T>() {
    return (await backendRequest<{ projects: CloudProject<T>[] }>("/projects")).projects;
}

export async function getCloudProject<T>(id: string) {
    return (await backendRequest<{ project: CloudProject<T> }>(`/projects/${encodeURIComponent(id)}`)).project;
}

export async function createCloudProject(id: string, name: string, data: unknown) {
    return (await backendRequest<{ project: CloudProject }>("/projects", { method: "POST", body: { id, name, data } })).project;
}

export async function updateCloudProject(id: string, patch: { name?: string; data?: unknown; version: number }, keepalive = false) {
    return (await backendRequest<{ project: CloudProject }>(`/projects/${id}`, { method: "PATCH", body: patch, keepalive })).project;
}

export async function deleteCloudProject(id: string) {
    await backendRequest<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" });
}
