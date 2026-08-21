import i18n from "@/i18n";

export function errorText(key: string, values?: Record<string, unknown>) {
    return i18n.t(key, { ns: "errors", ...values });
}
