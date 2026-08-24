import type { ReactNode } from "react";
import i18n from "@/i18n";

export function AdminPageHeader({ title, description, extra }: { title: string; description: string; extra?: ReactNode }) {
    return (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
                <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
                <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{description}</p>
            </div>
            {extra}
        </div>
    );
}

export function MetricCard({ label, value, secondary }: { label: string; value: ReactNode; secondary?: ReactNode }) {
    return (
        <div className="rounded-xl border border-stone-200 bg-background p-5 dark:border-stone-800">
            <div className="text-sm text-stone-500 dark:text-stone-400">{label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
            {secondary ? <div className="mt-2 text-xs text-stone-400">{secondary}</div> : null}
        </div>
    );
}

export function integer(value: number | null | undefined) {
    return new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language).format(value || 0);
}
export const capabilities = ["text", "image", "video", "audio"] as const;
export const statuses = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
// Kept for catalog compatibility until its form labels are moved into the admin namespace.
export const capabilityLabels = { text: "文本", image: "图片", video: "视频", audio: "音频" } as const;
