import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button, DatePicker, Input, Select, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { saveAs } from "file-saver";
import { Download } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { AdminPageHeader, capabilityLabels, integer, MetricCard, statusLabels, usd } from "@/pages/admin/components";
import { downloadAdminUsage, fetchAdminModels, fetchAdminUsage, type Capability, type JobStatus, type UsageFilters } from "@/services/api/admin";
import { fetchAdminUsers } from "@/services/api/auth";

const usageSourceLabels: Record<string, string> = { provider: "供应商", estimated: "估算", none: "无用量" };

export default function AdminUsagePage() {
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
            message.error(error instanceof Error ? error.message : "导出失败");
        } finally {
            setExporting(false);
        }
    }

    return (
        <div className="mx-auto max-w-7xl">
            <AdminPageHeader
                title="用量明细"
                description="按任务查看模型、Token、状态和美元成本。"
                extra={
                    <Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportCsv()}>
                        导出 CSV
                    </Button>
                }
            />
            <div className="mb-5 flex flex-wrap gap-2">
                <Select
                    className="w-56"
                    allowClear
                    showSearch
                    filterOption={false}
                    placeholder="选择用户"
                    value={userId}
                    onSearch={setUserKeyword}
                    onChange={(value) => resetPage(setUserId, value)}
                    options={users.data?.items.map((user) => ({ value: user.id, label: user.email }))}
                />
                <Select
                    className="w-44"
                    allowClear
                    placeholder="选择模型"
                    value={modelId}
                    onChange={(value) => resetPage(setModelId, value)}
                    options={models.data?.items.map((model) => ({ value: model.id, label: model.displayName }))}
                />
                <Select
                    className="w-32"
                    allowClear
                    placeholder="生成类型"
                    value={capability}
                    onChange={(value) => resetPage(setCapability, value)}
                    options={Object.entries(capabilityLabels).map(([value, label]) => ({ value, label }))}
                />
                <Select
                    className="w-32"
                    allowClear
                    placeholder="任务状态"
                    value={status}
                    onChange={(value) => resetPage(setStatus, value)}
                    options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))}
                />
                <Input.Search
                    className="w-52"
                    allowClear
                    defaultValue={projectId}
                    placeholder="按项目 ID 筛选"
                    onSearch={(value) => resetPage(setProjectId, value.trim() || undefined)}
                />
                <DatePicker.RangePicker value={dates} onChange={(value) => resetPage(setDates, value as [Dayjs, Dayjs] | null)} />
            </div>
            <section className="mb-6 grid gap-3 sm:grid-cols-3">
                <MetricCard label="筛选结果" value={integer(data?.summary.calls)} secondary="已结算调用" />
                <MetricCard label="总 Token" value={integer(data?.summary.totalTokens)} />
                <MetricCard label="合计成本" value={usd(data?.summary.amountUsd)} />
            </section>
            <Table
                rowKey="jobId"
                loading={isFetching}
                dataSource={data?.items || []}
                scroll={{ x: 1050 }}
                pagination={{ current: page, pageSize, total: data?.total || 0, showSizeChanger: false, onChange: setPage }}
                columns={[
                    { title: "时间", dataIndex: "createdAt", width: 160, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
                    { title: "用户", dataIndex: "userEmail", width: 200, ellipsis: true },
                    { title: "项目", dataIndex: "projectName", width: 150, ellipsis: true, render: (value) => value || "独立工作台" },
                    { title: "模型", dataIndex: "modelName", width: 150, ellipsis: true },
                    { title: "类型", dataIndex: "capability", width: 80, render: (value) => capabilityLabels[value as Capability] },
                    {
                        title: "状态",
                        dataIndex: "status",
                        width: 90,
                        render: (value) => <Tag color={value === "succeeded" ? "green" : value === "failed" ? "red" : undefined}>{statusLabels[value as JobStatus]}</Tag>,
                    },
                    { title: "Token", dataIndex: "totalTokens", width: 100, align: "right", render: integer },
                    { title: "金额", dataIndex: "amountUsd", width: 100, align: "right", render: usd },
                    { title: "用量来源", dataIndex: "usageSource", width: 100, render: (value) => usageSourceLabels[value as string] || "—" },
                ]}
            />
        </div>
    );
}
