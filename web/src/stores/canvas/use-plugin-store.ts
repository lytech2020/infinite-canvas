import { create } from "zustand";

import { readUserData, reportCloudSaveError, writeUserData } from "@/services/api/user-data";

export type InstalledPlugin = { id: string; name: string; version: string; description?: string; url: string; source: string; enabled: boolean; local?: boolean; official?: boolean; installedAt: string };
type PluginStore = {
    hydrated: boolean;
    plugins: InstalledPlugin[];
    loadPlugins: () => Promise<void>;
    reset: () => void;
    upsert: (plugin: Omit<InstalledPlugin, "installedAt"> & { installedAt?: string }) => void;
    setEnabled: (id: string, enabled: boolean) => void;
    remove: (id: string) => void;
};

const KEY = "plugin_store";
let loadVersion = 0;
function save(plugins: InstalledPlugin[]) {
    void writeUserData(KEY, plugins).catch(reportCloudSaveError);
}

export const usePluginStore = create<PluginStore>()((set, get) => ({
    hydrated: false,
    plugins: [],
    loadPlugins: async () => {
        const version = ++loadVersion;
        const plugins = (await readUserData<InstalledPlugin[]>(KEY)) || [];
        if (version === loadVersion) set({ plugins, hydrated: true });
    },
    reset: () => { loadVersion += 1; set({ plugins: [], hydrated: false }); },
    upsert: (plugin) => {
        const next = { ...plugin, installedAt: plugin.installedAt || new Date().toISOString() };
        const plugins = get().plugins.some((item) => item.id === plugin.id) ? get().plugins.map((item) => item.id === plugin.id ? next : item) : [next, ...get().plugins];
        set({ plugins });
        save(plugins);
    },
    setEnabled: (id, enabled) => {
        const plugins = get().plugins.map((item) => item.id === id ? { ...item, enabled } : item);
        set({ plugins });
        save(plugins);
    },
    remove: (id) => {
        const plugins = get().plugins.filter((item) => item.id !== id);
        set({ plugins });
        save(plugins);
    },
}));
