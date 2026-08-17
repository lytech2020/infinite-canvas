import { create } from "zustand";
import { nanoid } from "nanoid";

import { createCloudProject, deleteCloudProject, getCloudProject, listCloudProjects, updateCloudProject } from "@/services/api/projects";
import { BackendError } from "@/services/api/backend";
import { reportCloudSaveError } from "@/services/api/user-data";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    loadProjects: () => Promise<void>;
    reset: () => void;
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveTasks = new Map<string, Promise<void>>();
const pendingProjects = new Map<string, CanvasProject>();
const serverVersions = new Map<string, number>();
const unsyncedProjects = new Set<string>();
let loadVersion = 0;
let saveVersion = 0;

function body(project: CanvasProject) {
    const { id: _id, title: _title, createdAt: _createdAt, updatedAt: _updatedAt, ...data } = project;
    return withoutSignedUrls(data);
}

function withoutSignedUrls<T>(value: T): T {
    if (Array.isArray(value)) return value.map(withoutSignedUrls) as T;
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    const next = Object.fromEntries(Object.entries(source).map(([key, item]) => [key, withoutSignedUrls(item)]));
    if (typeof source.storageKey === "string" && source.storageKey) for (const key of ["content", "dataUrl", "url", "coverUrl"]) if (typeof next[key] === "string") next[key] = "";
    return next as T;
}

function queueCloudSave(project: CanvasProject, create = false, keepalive = false) {
    const version = saveVersion;
    const previous = saveTasks.get(project.id) || Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
        if (version !== saveVersion) return;
        const data = body(project);
        const patch = { name: project.title, data, version: serverVersions.get(project.id)! };
        let saved: Awaited<ReturnType<typeof createCloudProject>>;
        if (create || unsyncedProjects.has(project.id) || !serverVersions.has(project.id)) {
            try {
                saved = await createCloudProject(project.id, project.title, data);
            } catch (error) {
                if (!(error instanceof BackendError && error.code === "CONFLICT")) throw error;
                const existing = await getCloudProject(project.id);
                saved = await updateCloudProject(project.id, { name: project.title, data, version: existing.version });
            }
        } else {
            saved = await updateCloudProject(project.id, patch, keepalive && JSON.stringify(patch).length < 60_000);
        }
        if (version !== saveVersion) return;
        serverVersions.set(project.id, saved.version);
        unsyncedProjects.delete(project.id);
    }).catch((error) => {
        if (version !== saveVersion) return;
        if (error instanceof BackendError && error.code === "CONFLICT") {
            window.dispatchEvent(new CustomEvent("cloud-save-conflict"));
            void useCanvasStore.getState().loadProjects();
            return;
        }
        if (create || (error instanceof BackendError && error.code === "NOT_FOUND")) unsyncedProjects.add(project.id);
        reportCloudSaveError(error);
    }).finally(() => {
        if (saveTasks.get(project.id) === task) saveTasks.delete(project.id);
    });
    saveTasks.set(project.id, task);
    return task;
}

function saveProject(project: CanvasProject, create = false) {
    if (create) {
        void queueCloudSave(project, true);
        return;
    }
    const previous = saveTimers.get(project.id);
    if (previous) clearTimeout(previous);
    pendingProjects.set(project.id, project);
    saveTimers.set(project.id, setTimeout(() => {
        saveTimers.delete(project.id);
        pendingProjects.delete(project.id);
        void queueCloudSave(project);
    }, 500));
}

export function flushPendingCloudProjects(keepalive = false) {
    const tasks: Promise<void>[] = [...saveTasks.values()];
    pendingProjects.forEach((project, id) => {
        const timer = saveTimers.get(id);
        if (timer) clearTimeout(timer);
        saveTimers.delete(id);
        tasks.push(queueCloudSave(project, false, keepalive));
    });
    pendingProjects.clear();
    return Promise.all(tasks);
}

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
    hydrated: false,
    projects: [],
    loadProjects: async () => {
        const version = ++loadVersion;
        set({ hydrated: false, projects: [] });
        const projects = await listCloudProjects<Omit<CanvasProject, "id" | "title" | "createdAt" | "updatedAt">>();
        if (version !== loadVersion) return;
        serverVersions.clear();
        projects.forEach((project) => serverVersions.set(project.id, project.version));
        set({
            hydrated: true,
            projects: projects.map((project) => ({
                id: project.id,
                title: project.name,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                nodes: project.data.nodes || [],
                connections: project.data.connections || [],
                chatSessions: project.data.chatSessions || [],
                activeChatId: project.data.activeChatId || null,
                backgroundMode: project.data.backgroundMode || "lines",
                showImageInfo: project.data.showImageInfo || false,
                viewport: project.data.viewport || initialViewport,
            })),
        });
    },
    reset: () => {
        loadVersion += 1;
        saveVersion += 1;
        saveTimers.forEach(clearTimeout);
        saveTimers.clear();
        pendingProjects.clear();
        saveTasks.clear();
        serverVersions.clear();
        unsyncedProjects.clear();
        set({ hydrated: false, projects: [] });
    },
    createProject: (title = "未命名画布") => {
        const now = new Date().toISOString();
        const project: CanvasProject = { id: nanoid(), title, createdAt: now, updatedAt: now, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: initialViewport };
        set((state) => ({ projects: [project, ...state.projects] }));
        saveProject(project, true);
        return project.id;
    },
    importProject: (source) => {
        const now = new Date().toISOString();
        const project: CanvasProject = { id: nanoid(), title: source.title || "导入画布", createdAt: source.createdAt || now, updatedAt: now, nodes: source.nodes || [], connections: source.connections || [], chatSessions: source.chatSessions || [], activeChatId: source.activeChatId || null, backgroundMode: source.backgroundMode || "lines", showImageInfo: source.showImageInfo || false, viewport: source.viewport || initialViewport };
        set((state) => ({ projects: [project, ...state.projects] }));
        saveProject(project, true);
        return project.id;
    },
    openProject: (id) => get().projects.find((item) => item.id === id) || null,
    renameProject: (id, title) => {
        set((state) => ({ projects: state.projects.map((project) => project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project) }));
        const project = get().projects.find((item) => item.id === id);
        if (project) saveProject(project);
    },
    deleteProjects: (ids) => {
        ids.forEach((id) => {
            const timer = saveTimers.get(id);
            if (timer) clearTimeout(timer);
            saveTimers.delete(id);
            pendingProjects.delete(id);
            void (saveTasks.get(id) || Promise.resolve()).then(() => deleteCloudProject(id)).catch(reportCloudSaveError);
        });
        set((state) => ({ projects: state.projects.filter((project) => !ids.includes(project.id)) }));
    },
    replaceProjects: (projects) => {
        const existing = new Set(get().projects.map((project) => project.id));
        set({ projects });
        projects.forEach((project) => saveProject(project, !existing.has(project.id)));
    },
    updateProject: (id, patch) => {
        set((state) => ({ projects: state.projects.map((project) => project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project) }));
        const project = get().projects.find((item) => item.id === id);
        if (project) saveProject(project);
    },
}));
