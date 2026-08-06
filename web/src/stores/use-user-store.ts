import { create } from "zustand";

import * as authApi from "@/services/api/auth";
import type { CloudUser } from "@/services/api/auth";

type UserStore = {
    user: CloudUser | null;
    /** 首次会话恢复是否已完成，避免登录校验在恢复期间误判为未登录。 */
    restored: boolean;
    restoreSession: () => Promise<void>;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
};

export const useUserStore = create<UserStore>()((set) => ({
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
    login: async (email, password) => set({ user: (await authApi.login(email, password)).user, restored: true }),
    register: async (email, password) => set({ user: (await authApi.register(email, password)).user, restored: true }),
    logout: async () => {
        await authApi.logout().catch(() => undefined);
        set({ user: null });
    },
}));
