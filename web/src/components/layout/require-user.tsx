import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useUserStore } from "@/stores/use-user-store";

export function RequireUser({ children }: { children: ReactNode }) {
    const location = useLocation();
    const user = useUserStore((state) => state.user);
    const restored = useUserStore((state) => state.restored);
    if (!restored) return null;
    if (!user) return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    return <>{children}</>;
}
