export const appLocales = ["zh-CN", "ja-JP", "en-US"] as const;
export const selectableLocales = ["zh-CN", "ja-JP"] as const;

export type AppLocale = (typeof appLocales)[number];

export const defaultLocale: AppLocale = "zh-CN";

export function detectBrowserLocale(): AppLocale {
    if (typeof navigator === "undefined") return defaultLocale;
    return navigator.languages.some((locale) => locale.toLowerCase().startsWith("ja")) ? "ja-JP" : defaultLocale;
}
