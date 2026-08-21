import { create } from "zustand";

import { DEFAULT_PROMPT_SOURCES, createPromptSource, type PromptSource } from "@/services/api/prompt-source-presets";
import { readUserData, reportCloudSaveError, writeUserData } from "@/services/api/user-data";

export type PromptSourceSchedule = { intervalMinutes: number; lastFetchedAt: string };
const defaultSchedule: PromptSourceSchedule = { intervalMinutes: 30, lastFetchedAt: "" };
export const PROMPT_SOURCE_INTERVAL_OPTIONS = [
    { label: "关闭定时", value: 0 },
    { label: "每 30 分钟", value: 30 },
    { label: "每 1 小时", value: 60 },
    { label: "每 6 小时", value: 360 },
    { label: "每 24 小时", value: 1440 },
];

type PromptSourceState = { sources: PromptSource[]; schedule: PromptSourceSchedule };
type PromptSourceStore = PromptSourceState & {
    loadSources: () => Promise<void>;
    reset: () => void;
    addSource: () => PromptSource;
    saveSource: (source: PromptSource) => void;
    removeSource: (id: string) => void;
    toggleSource: (id: string, enabled: boolean) => void;
    updateSchedule: <K extends keyof PromptSourceSchedule>(key: K, value: PromptSourceSchedule[K]) => void;
};

const KEY = "prompt_source_store";
let loadVersion = 0;
function merged(saved?: Partial<PromptSourceState> | null): PromptSourceState {
    const savedSources = Array.isArray(saved?.sources) ? saved.sources : [];
    const enabledById = new Map(savedSources.map((source) => [source.id, source.enabled]));
    const builtIn = DEFAULT_PROMPT_SOURCES.map((source) => ({ ...source, enabled: enabledById.get(source.id) ?? source.enabled }));
    const custom = savedSources.filter((source) => !source.builtIn).map((source) => createPromptSource(source));
    return { sources: [...builtIn, ...custom], schedule: { ...defaultSchedule, ...(saved?.schedule || {}) } };
}
function save(state: PromptSourceState) {
    void writeUserData(KEY, state).catch(reportCloudSaveError);
}

export const usePromptSourceStore = create<PromptSourceStore>()((set, get) => ({
    ...merged(),
    loadSources: async () => {
        const version = ++loadVersion;
        const state = merged(await readUserData<PromptSourceState>(KEY));
        if (version === loadVersion) set(state);
    },
    reset: () => { loadVersion += 1; set(merged()); },
    addSource: () => createPromptSource(),
    saveSource: (source) => {
        const sources = get().sources.some((item) => item.id === source.id) ? get().sources.map((item) => item.id === source.id && !item.builtIn ? createPromptSource(source) : item) : [...get().sources, createPromptSource(source)];
        set({ sources }); save({ sources, schedule: get().schedule });
    },
    removeSource: (id) => {
        const sources = get().sources.filter((item) => item.id !== id || item.builtIn);
        set({ sources }); save({ sources, schedule: get().schedule });
    },
    toggleSource: (id, enabled) => {
        const sources = get().sources.map((item) => item.id === id ? { ...item, enabled } : item);
        set({ sources }); save({ sources, schedule: get().schedule });
    },
    updateSchedule: (key, value) => {
        const schedule = { ...get().schedule, [key]: value };
        set({ schedule }); save({ sources: get().sources, schedule });
    },
}));
