import { create } from "zustand";

import * as authApi from "@/services/api/auth";
import type { CloudUser } from "@/services/api/auth";
import { randomId } from "@/lib/utils";

type UserStore = {
    user: CloudUser | null;
    /** 首次会话恢复是否已完成，避免登录校验在恢复期间误判为未登录。 */
    restored: boolean;
    restoreSession: () => Promise<void>;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
};

const authChannel = typeof window === "undefined" || !("BroadcastChannel" in window) ? null : new BroadcastChannel("infinite-canvas-auth");
const authTabId = randomId();
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function flushAccountData() {
    const [{ flushPendingCloudProjects }, { flushPendingAssets }, { flushPendingConfig }] = await Promise.all([
        import("@/stores/canvas/use-canvas-store"),
        import("@/stores/use-asset-store"),
        import("@/stores/use-config-store"),
    ]);
    await Promise.all([flushPendingCloudProjects(), flushPendingAssets(), flushPendingConfig()]);
}

async function prepareSessionChange() {
    if (!authChannel) {
        await flushAccountData().catch(() => undefined);
        return;
    }
    const requestId = randomId();
    const expected = new Set<string>();
    const prepared = new Set<string>();
    const listener = (event: MessageEvent<{ type?: string; requestId?: string; tabId?: string }>) => {
        if (event.data?.requestId !== requestId || !event.data.tabId) return;
        if (event.data.type === "session-tab-present") expected.add(event.data.tabId);
        if (event.data.type === "session-tab-prepared") prepared.add(event.data.tabId);
    };
    authChannel.addEventListener("message", listener);
    authChannel.postMessage({ type: "probe-session-tabs", requestId });
    await wait(300);
    authChannel.postMessage({ type: "prepare-session-change", requestId });
    await Promise.all([
        flushAccountData().catch(() => undefined),
        new Promise<void>((resolve) => {
            const startedAt = Date.now();
            const timer = setInterval(() => {
                if ([...expected].every((id) => prepared.has(id)) || Date.now() - startedAt >= 5000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 25);
        }),
    ]);
    authChannel.removeEventListener("message", listener);
}

export function subscribeAuthChanges() {
    const listener = (event: MessageEvent<{ type?: string; requestId?: string } | string>) => {
        if (typeof event.data === "object" && event.data?.type === "probe-session-tabs") {
            authChannel?.postMessage({ type: "session-tab-present", requestId: event.data.requestId, tabId: authTabId });
            return;
        }
        if (typeof event.data === "object" && event.data?.type === "prepare-session-change") {
            void flushAccountData()
                .catch(() => window.dispatchEvent(new CustomEvent("cloud-save-error")))
                .finally(() => authChannel?.postMessage({ type: "session-tab-prepared", requestId: event.data.requestId, tabId: authTabId }));
            return;
        }
        if (typeof event.data === "object" && ["session-tab-present", "session-tab-prepared"].includes(event.data?.type || "")) return;
        void useUserStore.getState().restoreSession();
    };
    authChannel?.addEventListener("message", listener);
    return () => authChannel?.removeEventListener("message", listener);
}

export const useUserStore = create<UserStore>()((set, get) => ({
    user: null,
    restored: false,
    restoreSession: async () => {
        try {
            const { user } = await authApi.fetchCurrentUser();
            set({ user, restored: true });
        } catch {
            set({ user: null, restored: true });
        }
    },
    login: async (email, password) => {
        if (get().user) await prepareSessionChange();
        set({ user: (await authApi.login(email, password)).user, restored: true });
        authChannel?.postMessage({ type: "session-changed" });
    },
    register: async (email, password) => {
        if (get().user) await prepareSessionChange();
        set({ user: (await authApi.register(email, password)).user, restored: true });
        authChannel?.postMessage({ type: "session-changed" });
    },
    logout: async () => {
        await prepareSessionChange();
        await authApi.logout().catch(() => undefined);
        set({ user: null });
        authChannel?.postMessage({ type: "session-changed" });
    },
}));
