import { Dropdown } from "antd";
import { LogOut, Shield, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { useUserStore } from "@/stores/use-user-store";

/** 顶部登录用户入口：未登录显示登录按钮，已登录显示邮箱菜单和管理员入口。 */
export function UserMenu() {
    const { t } = useTranslation("auth");
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const user = useUserStore((state) => state.user);
    const logout = useUserStore((state) => state.logout);

    const iconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";

    if (!user) {
        return (
            <button type="button" className="inline-flex h-7 shrink-0 items-center gap-1.5 px-1 text-sm text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white" onClick={() => navigate(`/login?redirect=${encodeURIComponent(pathname)}`)}>
                <UserRound className="size-4" />
                <span>{t("loginAction")}</span>
            </button>
        );
    }

    return (
        <Dropdown
            trigger={["click"]}
            menu={{
                items: [
                    { key: "email", label: user.email, disabled: true },
                    ...(user.role === "admin" ? [{ type: "divider" as const }, { key: "admin", icon: <Shield className="size-4" />, label: t("adminEntry") }] : []),
                    { type: "divider" as const },
                    { key: "logout", icon: <LogOut className="size-4" />, label: t("logout") },
                ],
                onClick: async ({ key }) => {
                    if (key === "admin") navigate("/admin/users");
                    if (key === "logout") {
                        await logout();
                        navigate("/");
                    }
                },
            }}
        >
            <button type="button" className={iconClass} aria-label={t("userMenu")} title={user.email}>
                <UserRound className="size-4" />
            </button>
        </Dropdown>
    );
}
