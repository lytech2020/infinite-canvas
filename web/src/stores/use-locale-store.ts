import { create } from "zustand";
import { persist } from "zustand/middleware";

import { detectBrowserLocale, type AppLocale } from "@/i18n/locale";

type LocaleStore = {
    locale: AppLocale;
    setLocale: (locale: AppLocale) => void;
};

export const useLocaleStore = create<LocaleStore>()(
    persist(
        (set) => ({
            locale: detectBrowserLocale(),
            setLocale: (locale) => set({ locale }),
        }),
        { name: "infinite-canvas:locale" },
    ),
);
