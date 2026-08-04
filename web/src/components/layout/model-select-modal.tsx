import { App, Button, Checkbox, Input, Modal, Tabs } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchChannelModels } from "@/services/api/image";
import type { ModelChannel } from "@/stores/use-config-store";

// 选择渠道模型弹窗：拉取上游模型列表或手动增加，勾选后才会进入渠道模型列表。
export function ModelSelectModal({ open, channel, selectedNames, onConfirm, onClose }: { open: boolean; channel: ModelChannel | null; selectedNames: string[]; onConfirm: (names: string[]) => void; onClose: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation(["common", "config"]);
    const [existing, setExisting] = useState<string[]>([]);
    const [fetched, setFetched] = useState<string[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState("new");
    const [search, setSearch] = useState("");
    const [manual, setManual] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        setExisting(selectedNames);
        setFetched([]);
        setSelected(new Set(selectedNames));
        setActiveTab(selectedNames.length ? "existing" : "new");
        setSearch("");
        setManual("");
    }, [open, selectedNames]);

    const currentList = activeTab === "new" ? fetched : existing;
    const visibleList = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        return keyword ? currentList.filter((name) => name.toLowerCase().includes(keyword)) : currentList;
    }, [currentList, search]);
    const visibleSelectedCount = visibleList.filter((name) => selected.has(name)).length;

    const toggle = (name: string, checked: boolean) =>
        setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(name);
            else next.delete(name);
            return next;
        });

    const selectVisible = (checked: boolean) =>
        setSelected((current) => {
            const next = new Set(current);
            visibleList.forEach((name) => (checked ? next.add(name) : next.delete(name)));
            return next;
        });

    const addManual = () => {
        const name = manual.trim();
        if (!name) return;
        if (!fetched.includes(name) && !existing.includes(name)) setFetched((current) => [name, ...current]);
        setSelected((current) => new Set(current).add(name));
        setManual("");
        setActiveTab("new");
    };

    const fetchModels = async () => {
        if (!channel) return;
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error(t("modelSelect.missingConfig", { ns: "config" }));
            return;
        }
        setLoading(true);
        try {
            const models = await fetchChannelModels(channel);
            setFetched(models);
            setActiveTab("new");
            message.success(t("modelSelect.fetched", { ns: "config", count: models.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("modelSelect.fetchFailed", { ns: "config" }));
        } finally {
            setLoading(false);
        }
    };

    const confirm = () => {
        const ordered = [...existing, ...fetched].filter((name, index, list) => list.indexOf(name) === index).filter((name) => selected.has(name));
        onConfirm(ordered);
        onClose();
    };

    return (
        <Modal
            open={open}
            width={880}
            centered
            onCancel={onClose}
            title={
                <span>
                    {t("modelSelect.title", { ns: "config" })} <span className="ml-2 text-xs font-normal text-stone-500">{t("modelSelect.selected", { ns: "config", selected: selected.size, total: new Set([...existing, ...fetched]).size })}</span>
                </span>
            }
            styles={{ body: { maxHeight: "62vh", overflowY: "auto" } }}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    {t("actions.cancel")}
                </Button>,
                <Button key="confirm" type="primary" onClick={confirm}>
                    {t("actions.done")}
                </Button>,
            ]}
        >
            <div className="flex flex-wrap items-center gap-3">
                <Input className="min-w-[200px] flex-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("modelSelect.search", { ns: "config" })} prefix={<Search className="size-4 text-stone-400" />} allowClear />
                <Input className="min-w-[180px] flex-1" value={manual} onChange={(event) => setManual(event.target.value)} onPressEnter={addManual} placeholder={t("modelSelect.manual", { ns: "config" })} />
                <Button onClick={addManual}>{t("modelSelect.add", { ns: "config" })}</Button>
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void fetchModels()}>
                    {t("modelSelect.fetch", { ns: "config" })}
                </Button>
            </div>
            <div className="mt-2 text-xs text-stone-500">{t("modelSelect.hint", { ns: "config" })}</div>

            <Tabs
                className="mt-3"
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    { key: "new", label: t("modelSelect.newTab", { ns: "config", count: fetched.length }) },
                    { key: "existing", label: t("modelSelect.existingTab", { ns: "config", count: existing.length }) },
                ]}
            />

            <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs text-stone-500">{t("modelSelect.visibleSelected", { ns: "config", selected: visibleSelectedCount, total: visibleList.length })}</span>
                <div className="flex gap-2">
                    <Button size="small" disabled={!visibleList.length} onClick={() => selectVisible(true)}>
                        {t("modelSelect.selectAll", { ns: "config" })}
                    </Button>
                    <Button size="small" disabled={!visibleSelectedCount} onClick={() => selectVisible(false)}>
                        {t("modelSelect.clearCurrent", { ns: "config" })}
                    </Button>
                </div>
            </div>

            {visibleList.length ? (
                <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
                    {visibleList.map((name) => (
                        <Checkbox key={name} checked={selected.has(name)} onChange={(event) => toggle(name, event.target.checked)}>
                            <span className="truncate" title={name}>
                                {name}
                            </span>
                        </Checkbox>
                    ))}
                </div>
            ) : (
                <div className="py-8 text-center text-sm text-stone-500">{t(activeTab === "new" ? "modelSelect.emptyNew" : "modelSelect.emptyExisting", { ns: "config" })}</div>
            )}
        </Modal>
    );
}
