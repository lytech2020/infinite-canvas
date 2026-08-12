import type { ReactNode } from "react";

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

export function usd(value: string | null | undefined) {
    return `$${Number(value || 0).toFixed(4)}`;
}

export function integer(value: number | null | undefined) {
    return new Intl.NumberFormat("zh-CN").format(value || 0);
}

export const capabilityLabels = { text: "文本", image: "图片", video: "视频", audio: "音频" } as const;
export const statusLabels = { queued: "排队中", running: "生成中", succeeded: "成功", failed: "失败", cancelled: "已取消" } as const;
