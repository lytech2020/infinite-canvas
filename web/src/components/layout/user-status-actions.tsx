import type { CSSProperties } from "react";
import { Dropdown } from "antd";
import { Check, Globe2, Keyboard, Puzzle, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { selectableLocales } from "@/i18n/locale";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useLocaleStore } from "@/stores/use-locale-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { t } = useTranslation("common");
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const locale = useLocaleStore((state) => state.locale);
    const setLocale = useLocaleStore((state) => state.setLocale);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label={t("userActions.plugins")} title={t("userActions.plugins")}>
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                menu={{
                    items: selectableLocales.map((value) => ({
                        key: value,
                        label: { "zh-CN": "简体中文", "ja-JP": "日本語", "en-US": "English", "ko-KR": "한국어" }[value],
                        icon: locale === value ? <Check className="size-3.5" /> : <span className="inline-block size-3.5" />,
                        onClick: () => setLocale(value),
                    })),
                }}
            >
                <button type="button" className={naturalIconClass} style={iconStyle} aria-label={t("userActions.language")} title={t("userActions.language")}>
                    <Globe2 className="size-4" />
                </button>
            </Dropdown>
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={t("userActions.config")} title={t("userActions.config")}>
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? t("userActions.lightTheme") : t("userActions.darkTheme")} title={theme === "dark" ? t("userActions.lightTheme") : t("userActions.darkTheme")} />
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("userActions.shortcuts")} title={t("userActions.shortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}
