import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button, DatePicker, Input, Select, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { saveAs } from "file-saver";
import { Download } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AdminPageHeader, capabilities, integer, MetricCard, statuses } from "@/pages/admin/components";
import { downloadAdminUsage, fetchAdminModels, fetchAdminUsage, type Capability, type JobStatus, type UsageFilters } from "@/services/api/admin";
import { fetchAdminUsers } from "@/services/api/auth";

export default function AdminUsagePage() {
    const { t } = useTranslation("admin");
    const { message } = App.useApp();
    const [searchParams] = useSearchParams();
    const [page, setPage] = useState(1);
    const [capability, setCapability] = useState<Capability>();
    const [status, setStatus] = useState<JobStatus>();
    const [dates, setDates] = useState<[Dayjs, Dayjs] | null>(null);
    const [userId, setUserId] = useState(searchParams.get("userId") || undefined);
    const [projectId, setProjectId] = useState(searchParams.get("projectId") || undefined);
    const [userKeyword, setUserKeyword] = useState("");
    const users = useQuery({ queryKey: ["admin-user-options", userKeyword], queryFn: () => fetchAdminUsers({ keyword: userKeyword, page: 1, pageSize: 30 }) });
    const models = useQuery({ queryKey: ["admin-model-options"], queryFn: () => fetchAdminModels() });
    const [modelId, setModelId] = useState<string>();
    const [exporting, setExporting] = useState(false);
    const filters: UsageFilters = {
        userId,
        projectId,
        modelId,
        capability,
        status,
        from: dates?.[0].startOf("day").toISOString(),
        to: dates?.[1].endOf("day").toISOString(),
    };
    const pageSize = 20;
    const { data, isFetching } = useQuery({ queryKey: ["admin-usage", filters, page], queryFn: () => fetchAdminUsage({ ...filters, page, pageSize }) });

    function resetPage<T>(setter: (value: T) => void, value: T) {
        setter(value);
        setPage(1);
    }

    async function exportCsv() {
        setExporting(true);
        try {
            saveAs(await downloadAdminUsage(filters), `usage-${dayjs().format("YYYY-MM-DD")}.csv`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("usage.exportFailed"));
        } finally {
            setExporting(false);
        }
    }

    return (
        <div className="mx-auto max-w-7xl">
            <AdminPageHeader
                title={t("nav.usage")}
                description={t("usage.description")}
                extra={
                    <Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportCsv()}>
                        {t("usage.export")}
                    </Button>
                }
            />
            <div className="mb-5 flex flex-wrap gap-2">
                <Select
                    className="w-56"
                    allowClear
                    showSearch
                    filterOption={false}
                    placeholder={t("usage.selectUser")}
                    value={userId}
                    onSearch={setUserKeyword}
                    onChange={(value) => resetPage(setUserId, value)}
                    options={users.data?.items.map((user) => ({ value: user.id, label: user.email }))}
                />
                <Select
                    className="w-44"
                    allowClear
                    placeholder={t("usage.selectModel")}
                    value={modelId}
                    onChange={(value) => resetPage(setModelId, value)}
                    options={models.data?.items.map((model) => ({ value: model.id, label: model.displayName }))}
                />
                <Select
                    className="w-32"
                    allowClear
                    placeholder={t("usage.generationType")}
                    value={capability}
                    onChange={(value) => resetPage(setCapability, value)}
                    options={capabilities.map((value) => ({ value, label: t(`common.${value}`) }))}
                />
                <Select
                    className="w-32"
                    allowClear
                    placeholder={t("usage.taskStatus")}
                    value={status}
                    onChange={(value) => resetPage(setStatus, value)}
                    options={statuses.map((value) => ({ value, label: t(`common.${value}`) }))}
                />
                <Input.Search
                    className="w-52"
                    allowClear
                    defaultValue={projectId}
                    placeholder={t("usage.projectFilter")}
                    onSearch={(value) => resetPage(setProjectId, value.trim() || undefined)}
                />
                <DatePicker.RangePicker value={dates} onChange={(value) => resetPage(setDates, value as [Dayjs, Dayjs] | null)} />
            </div>
            <section className="mb-6 grid gap-3 sm:grid-cols-2">
                <MetricCard label={t("usage.filtered")} value={integer(data?.summary.calls)} secondary={t("usage.recorded")} />
                <MetricCard label={t("usage.totalTokens")} value={integer(data?.summary.totalTokens)} />
            </section>
            <Table
                rowKey="jobId"
                loading={isFetching}
                dataSource={data?.items || []}
                scroll={{ x: 1050 }}
                pagination={{ current: page, pageSize, total: data?.total || 0, showSizeChanger: false, onChange: setPage }}
                columns={[
                    { title: t("common.time"), dataIndex: "createdAt", width: 160, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
                    { title: t("common.user"), dataIndex: "userEmail", width: 200, ellipsis: true },
                    { title: t("common.project"), dataIndex: "projectName", width: 150, ellipsis: true, render: (value) => value || t("common.standalone") },
                    { title: t("common.model"), dataIndex: "modelName", width: 150, ellipsis: true },
                    { title: t("common.type"), dataIndex: "capability", width: 80, render: (value) => t(`common.${value}`) },
                    {
                        title: t("common.status"),
                        dataIndex: "status",
                        width: 90,
                        render: (value) => <Tag color={value === "succeeded" ? "green" : value === "failed" ? "red" : undefined}>{t(`common.${value}`)}</Tag>,
                    },
                    { title: "Token", dataIndex: "totalTokens", width: 100, align: "right", render: integer },
                    { title: t("usage.usageSource"), dataIndex: "usageSource", width: 100, render: (value) => value === "provider" ? t("usage.provider") : value === "estimated" ? t("usage.estimated") : value === "none" ? t("usage.noUsage") : "—" },
                ]}
            />
        </div>
    );
}
