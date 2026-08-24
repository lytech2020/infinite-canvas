import type { ReactNode } from "react";
import { useEffect } from "react";
import { ProConfigProvider } from "@ant-design/pro-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import enUS from "antd/es/locale/en_US";
import jaJP from "antd/es/locale/ja_JP";
import koKR from "antd/es/locale/ko_KR";
import zhCN from "antd/es/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/ja";
import "dayjs/locale/ko";
import "dayjs/locale/zh-cn";

import { ClientRootInit } from "@/components/layout/client-root-init";
import i18n from "@/i18n";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useLocaleStore } from "@/stores/use-locale-store";
import { useThemeStore } from "@/stores/use-theme-store";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});
const antdLocales = { "zh-CN": zhCN, "ja-JP": jaJP, "en-US": enUS, "ko-KR": koKR };
const dayjsLocales = { "zh-CN": "zh-cn", "ja-JP": "ja", "en-US": "en", "ko-KR": "ko" };

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useThemeStore((state) => state.theme);
    const locale = useLocaleStore((state) => state.locale);
    const dark = theme === "dark";

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
    }, [dark, theme]);

    useEffect(() => {
        document.documentElement.lang = locale;
        document.title = i18n.getFixedT(locale, "common")("browserTitle");
        dayjs.locale(dayjsLocales[locale]);
        void i18n.changeLanguage(locale);
    }, [locale]);

    return (
        <ConfigProvider locale={antdLocales[locale]} theme={getAntThemeConfig(dark)}>
            <ProConfigProvider dark={dark}>
                <App>
                    <QueryClientProvider client={queryClient}>
                        <ClientRootInit>{children}</ClientRootInit>
                    </QueryClientProvider>
                </App>
            </ProConfigProvider>
        </ConfigProvider>
    );
}
