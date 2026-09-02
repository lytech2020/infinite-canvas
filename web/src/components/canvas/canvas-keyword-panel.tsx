import { useMemo, useState } from "react";
import { Button, Empty, Input, Modal, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Copy, FileText, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { ARCHITECTURE_KEYWORD_CATEGORIES, fetchArchitectureKeywords, type ArchitectureKeyword } from "@/services/api/architecture-keywords";

import type { InsertAssetPayload } from "./asset-picker-modal";

const PAGE_SIZE = 30;

export function CanvasKeywordsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { t } = useTranslation("canvas");
    const copyText = useCopyText();
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("");
    const [visible, setVisible] = useState(PAGE_SIZE);
    const [detail, setDetail] = useState<ArchitectureKeyword | null>(null);
    const query = useQuery({ queryKey: ["architecture-keywords"], queryFn: fetchArchitectureKeywords, staleTime: Infinity });

    const items = query.data || [];
    const search = keyword.trim().toLowerCase();
    const filtered = useMemo(() => {
        const scoped = category ? items.filter((item) => item.category === category) : items;
        if (!search) return scoped;
        return scoped.filter((item) => `${item.title} ${item.prompt} ${item.category}`.toLowerCase().includes(search));
    }, [items, category, search]);

    const counts = useMemo(() => ARCHITECTURE_KEYWORD_CATEGORIES.map((name) => ({ name, count: items.filter((item) => item.category === name).length })), [items]);
    const showList = Boolean(category || search);

    const openCategory = (name: string) => {
        setCategory(name);
        setVisible(PAGE_SIZE);
    };
    const copyKeyword = (item: ArchitectureKeyword) => copyText(item.prompt, t("sidePanel.promptCopied"));
    const insertKeyword = (item: ArchitectureKeyword) => onInsert({ kind: "text", content: item.prompt, title: item.title });

    return (
        <div className="flex h-full flex-col">
            <div className="px-3 pb-2.5 pt-1">
                <Input
                    size="small"
                    allowClear
                    prefix={<Search className="size-3.5 opacity-40" />}
                    placeholder={t("sidePanel.searchKeywords")}
                    value={keyword}
                    onChange={(e) => (setKeyword(e.target.value), setVisible(PAGE_SIZE))}
                />
            </div>
            {category ? (
                <button
                    type="button"
                    onClick={() => setCategory("")}
                    className="mx-3 mb-1.5 flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                >
                    <ChevronLeft className="size-3.5" />
                    {category}
                    <span className="opacity-50">{filtered.length}</span>
                </button>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {query.isLoading ? (
                    <div className="flex justify-center py-8">
                        <Spin size="small" />
                    </div>
                ) : query.isError ? (
                    <button type="button" onClick={() => void query.refetch()} className="block w-full py-6 text-center text-xs text-red-500 opacity-80 transition hover:opacity-100">
                        {t("sidePanel.loadFailedRetry")}
                    </button>
                ) : showList ? (
                    filtered.length ? (
                        <div className="space-y-1.5">
                            {filtered.slice(0, visible).map((item) => (
                                <KeywordRow key={item.templateId} item={item} theme={theme} onView={() => setDetail(item)} onCopy={() => copyKeyword(item)} onInsert={() => insertKeyword(item)} />
                            ))}
                            {filtered.length > visible ? (
                                <button
                                    type="button"
                                    onClick={() => setVisible((prev) => prev + PAGE_SIZE)}
                                    className="mt-1 w-full rounded-md py-2 text-xs font-medium opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                                >
                                    {t("sidePanel.loadMoreKeywords", { count: filtered.length - visible })}
                                </button>
                            ) : null}
                        </div>
                    ) : (
                        <div className="py-8 text-center text-xs opacity-40">{t("sidePanel.noMatchingKeywords")}</div>
                    )
                ) : items.length ? (
                    <div className="space-y-1">
                        {counts.map((entry) => (
                            <button
                                key={entry.name}
                                type="button"
                                onClick={() => openCategory(entry.name)}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left transition hover:bg-black/5 dark:hover:bg-white/5"
                            >
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
                                <span className="text-xs opacity-45">{entry.count}</span>
                                <ChevronRight className="size-3.5 opacity-35" />
                            </button>
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("sidePanel.noKeywords")} className="pt-12" />
                )}
            </div>
            <KeywordDetailDialog item={detail} onClose={() => setDetail(null)} onCopy={copyKeyword} onInsert={insertKeyword} />
        </div>
    );
}

function KeywordRow({ item, theme, onView, onCopy, onInsert }: { item: ArchitectureKeyword; theme: CanvasTheme; onView: () => void; onCopy: () => void; onInsert: () => void }) {
    const { t } = useTranslation("canvas");
    return (
        <div className="group flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-black/5 dark:hover:bg-white/5">
            {item.coverUrl ? (
                <img src={item.coverUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" />
            ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-md">
                    <FileText className="size-4 opacity-50" />
                </span>
            )}
            <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium leading-snug">{item.title}</div>
                <div className="mt-0.5 truncate text-xs leading-snug opacity-50">{item.prompt}</div>
                <div className="mt-0.5 truncate text-[10px] leading-snug opacity-30">{item.templateVersion}</div>
            </button>
            <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button type="button" onClick={onCopy} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label={t("sidePanel.copyKeyword")} title={t("sidePanel.copyKeyword")}>
                    <Copy className="size-3.5" />
                </button>
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                    style={{ color: theme.toolbar.activeText }}
                    aria-label={t("sidePanel.insertCanvas")}
                    title={t("sidePanel.insertCanvas")}
                >
                    <Plus className="size-3.5" />
                </button>
            </div>
        </div>
    );
}

function KeywordDetailDialog({ item, onClose, onCopy, onInsert }: { item: ArchitectureKeyword | null; onClose: () => void; onCopy: (item: ArchitectureKeyword) => void; onInsert: (item: ArchitectureKeyword) => void }) {
    const { t } = useTranslation("canvas");
    return (
        <Modal title={item?.title} open={Boolean(item)} onCancel={onClose} footer={null} width={680} centered styles={{ body: { maxHeight: "70vh", overflow: "hidden" } }}>
            {item ? (
                <div className="flex max-h-[calc(70vh-24px)] flex-col">
                    {item.coverUrl ? <img src={item.coverUrl} alt={item.title} className="h-48 w-full shrink-0 rounded-lg object-cover" /> : null}
                    <div className="mt-3 flex shrink-0 items-center gap-2 text-xs opacity-45">
                        <span>{item.category}</span>
                        <span>·</span>
                        <span>{item.templateVersion}</span>
                    </div>
                    <p className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-sm leading-7">{item.prompt}</p>
                    <div className="mt-4 flex shrink-0 gap-2">
                        <Button icon={<Copy className="size-4" />} onClick={() => onCopy(item)}>
                            {t("sidePanel.copyKeyword")}
                        </Button>
                        <Button icon={<Plus className="size-4" />} onClick={() => (onInsert(item), onClose())}>
                            {t("sidePanel.insertCanvas")}
                        </Button>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}
