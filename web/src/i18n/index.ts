import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { appLocales, defaultLocale } from "@/i18n/locale";
import jaCommon from "@/i18n/locales/ja-JP/common";
import jaAssets from "@/i18n/locales/ja-JP/assets";
import jaAuth from "@/i18n/locales/ja-JP/auth";
import jaConfig from "@/i18n/locales/ja-JP/config";
import jaCanvas from "@/i18n/locales/ja-JP/canvas";
import jaHome from "@/i18n/locales/ja-JP/home";
import jaImage from "@/i18n/locales/ja-JP/image";
import jaNavigation from "@/i18n/locales/ja-JP/navigation";
import jaPrompts from "@/i18n/locales/ja-JP/prompts";
import jaVideo from "@/i18n/locales/ja-JP/video";
import jaSettings from "@/i18n/locales/ja-JP/settings";
import jaAgent from "@/i18n/locales/ja-JP/agent";
import jaErrors from "@/i18n/locales/ja-JP/errors";
import jaPrivacy from "@/i18n/locales/ja-JP/privacy";
import zhCommon from "@/i18n/locales/zh-CN/common";
import zhAssets from "@/i18n/locales/zh-CN/assets";
import zhAuth from "@/i18n/locales/zh-CN/auth";
import zhConfig from "@/i18n/locales/zh-CN/config";
import zhCanvas from "@/i18n/locales/zh-CN/canvas";
import zhHome from "@/i18n/locales/zh-CN/home";
import zhImage from "@/i18n/locales/zh-CN/image";
import zhNavigation from "@/i18n/locales/zh-CN/navigation";
import zhPrompts from "@/i18n/locales/zh-CN/prompts";
import zhVideo from "@/i18n/locales/zh-CN/video";
import zhSettings from "@/i18n/locales/zh-CN/settings";
import zhAgent from "@/i18n/locales/zh-CN/agent";
import zhErrors from "@/i18n/locales/zh-CN/errors";
import zhPrivacy from "@/i18n/locales/zh-CN/privacy";
import { useLocaleStore } from "@/stores/use-locale-store";

void i18n.use(initReactI18next).init({
    lng: useLocaleStore.getState().locale,
    fallbackLng: defaultLocale,
    supportedLngs: appLocales,
    defaultNS: "common",
    resources: {
        "zh-CN": { common: zhCommon, navigation: zhNavigation, config: zhConfig, home: zhHome, canvas: zhCanvas, prompts: zhPrompts, assets: zhAssets, image: zhImage, video: zhVideo, settings: zhSettings, agent: zhAgent, errors: zhErrors, auth: zhAuth, privacy: zhPrivacy },
        "ja-JP": { common: jaCommon, navigation: jaNavigation, config: jaConfig, home: jaHome, canvas: jaCanvas, prompts: jaPrompts, assets: jaAssets, image: jaImage, video: jaVideo, settings: jaSettings, agent: jaAgent, errors: jaErrors, auth: jaAuth, privacy: jaPrivacy },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

export default i18n;
