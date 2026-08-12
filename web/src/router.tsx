import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { RequireAdmin } from "@/components/layout/require-admin";
import AdminLayout from "@/layouts/admin-layout";
import UserLayout from "@/layouts/user-layout";
import AdminCatalogPage from "@/pages/admin/catalog";
import AdminOverviewPage from "@/pages/admin/overview";
import AdminPromptsPage from "@/pages/admin/prompts";
import AdminUsagePage from "@/pages/admin/usage";
import AdminUsersPage from "@/pages/admin/users";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import PrivacyPage from "@/pages/privacy";
import VideoPage from "@/pages/video";

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/login", element: <LoginPage /> },
            { path: "/privacy", element: <PrivacyPage /> },
            {
                path: "/admin",
                element: (
                    <RequireAdmin>
                        <AdminLayout />
                    </RequireAdmin>
                ),
                children: [
                    { index: true, element: <AdminOverviewPage /> },
                    { path: "usage", element: <AdminUsagePage /> },
                    { path: "users", element: <AdminUsersPage /> },
                    { path: "prompts", element: <AdminPromptsPage /> },
                    { path: "catalog", element: <AdminCatalogPage /> },
                ],
            },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
