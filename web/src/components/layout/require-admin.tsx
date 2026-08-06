import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useUserStore } from "@/stores/use-user-store";

/** 管理后台路由守卫；会话恢复完成前不做跳转，避免刷新时误判未登录。 */
export function RequireAdmin({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const user = useUserStore((state) => state.user);
    const restored = useUserStore((state) => state.restored);

    if (!restored) return null;
    if (!user) return <Navigate to={`/login?redirect=${encodeURIComponent(pathname)}`} replace />;
    if (user.role !== "admin") return <Navigate to="/" replace />;
    return <>{children}</>;
}
