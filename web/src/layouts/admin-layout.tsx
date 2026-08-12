import { BarChart3, BrainCircuit, Database, MessageSquareText, Users } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { cn } from "@/lib/utils";

const links = [
    { to: "/admin", label: "数据总览", icon: BarChart3, end: true },
    { to: "/admin/usage", label: "用量明细", icon: Database },
    { to: "/admin/users", label: "用户管理", icon: Users },
    { to: "/admin/prompts", label: "提示词分析", icon: MessageSquareText },
    { to: "/admin/catalog", label: "模型与渠道", icon: BrainCircuit },
];

export default function AdminLayout() {
    return (
        <div className="flex h-full min-h-0 bg-background text-foreground">
            <aside className="hidden w-56 shrink-0 border-r border-stone-200 px-4 py-6 md:block dark:border-stone-800">
                <div className="px-3 text-xs font-medium tracking-[0.16em] text-stone-400">管理后台</div>
                <nav className="mt-5 space-y-1">
                    {links.map(({ to, label, icon: Icon, end }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={end}
                            className={({ isActive }) =>
                                cn(
                                    "flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition",
                                    isActive ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-50" : "text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                )
                            }
                        >
                            <Icon className="size-4" />
                            {label}
                        </NavLink>
                    ))}
                </nav>
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
                <nav className="hide-scrollbar flex shrink-0 gap-5 overflow-x-auto border-b border-stone-200 px-5 md:hidden dark:border-stone-800">
                    {links.map(({ to, label, end }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={end}
                            className={({ isActive }) => cn("h-12 shrink-0 border-b py-3 text-sm", isActive ? "border-current font-medium" : "border-transparent text-stone-500")}
                        >
                            {label}
                        </NavLink>
                    ))}
                </nav>
                <main className="min-h-0 flex-1 overflow-y-auto px-5 py-7 lg:px-9">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
