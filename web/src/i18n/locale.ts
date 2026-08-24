export const appLocales = ["zh-CN", "ja-JP", "en-US", "ko-KR"] as const;
export const selectableLocales = appLocales;

export type AppLocale = (typeof appLocales)[number];

export const defaultLocale: AppLocale = "zh-CN";

export function detectBrowserLocale(): AppLocale {
    if (typeof navigator === "undefined") return defaultLocale;
    const languages = navigator.languages.map((locale) => locale.toLowerCase());
    if (languages.some((locale) => locale.startsWith("ja"))) return "ja-JP";
    if (languages.some((locale) => locale.startsWith("ko"))) return "ko-KR";
    if (languages.some((locale) => locale.startsWith("en"))) return "en-US";
    return defaultLocale;
}
