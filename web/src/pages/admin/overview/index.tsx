import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DatePicker, Empty, Segmented, Skeleton, Table, Tag } from "antd";
import type { Dayjs } from "dayjs";

import { AdminPageHeader, capabilityLabels, integer, MetricCard, statusLabels, usd } from "@/pages/admin/components";
import { fetchAdminOverview, type UsageGroup } from "@/services/api/admin";

type Range = "today" | "month" | "custom";

export default function AdminOverviewPage() {
    const [range, setRange] = useState<Range>("month");
    const [dates, setDates] = useState<[Dayjs, Dayjs] | null>(null);
    const filters = range === "custom" && dates ? { from: dates[0].startOf("day").toISOString(), to: dates[1].endOf("day").toISOString() } : {};
    const { data, isLoading } = useQuery({ queryKey: ["admin-overview", filters], queryFn: () => fetchAdminOverview(filters) });
    const summary = data?.[range];

    return (
        <div className="mx-auto max-w-7xl">
            <AdminPageHeader
                title="数据总览"
                description="查看用户规模、当前任务和 AI 使用成本。"
                extra={
                    <div className="flex flex-wrap gap-2">
                        <Segmented<Range>
                            value={range}
                            onChange={setRange}
                            options={[
                                { label: "今日", value: "today" },
                                { label: "本月", value: "month" },
                                { label: "自定义", value: "custom" },
                            ]}
                        />
                        {range === "custom" ? <DatePicker.RangePicker value={dates} onChange={(value) => setDates(value as [Dayjs, Dayjs] | null)} allowClear /> : null}
                    </div>
                }
            />

            {isLoading ? (
                <Skeleton active />
            ) : (
                <>
                    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <MetricCard label="累计用户" value={integer(data?.users.total)} secondary={`近 30 天活跃 ${integer(data?.users.activeIn30Days)} 人`} />
                        <MetricCard label="正在执行" value={integer(data?.runningJobs)} secondary="排队中与生成中的任务" />
                        <MetricCard label="调用次数" value={integer(summary?.calls)} secondary={`Token ${integer(summary?.totalTokens)}`} />
                        <MetricCard label="估算成本" value={usd(summary?.amountUsd)} secondary="按当前价格规则计算" />
                    </section>

                    <section className="mt-8 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
                        <div>
                            <h2 className="mb-3 text-sm font-medium">模型使用排行</h2>
                            <Table<UsageGroup>
                                rowKey="key"
                                size="middle"
                                pagination={false}
                                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无调用记录" /> }}
                                dataSource={data?.byModel || []}
                                columns={[
                                    { title: "模型", dataIndex: "modelName" },
                                    { title: "类型", dataIndex: "capability", width: 90, render: (value) => (value ? capabilityLabels[value as keyof typeof capabilityLabels] : "—") },
                                    { title: "调用", dataIndex: "calls", width: 90, render: integer },
                                    { title: "金额", dataIndex: "amountUsd", width: 110, align: "right", render: usd },
                                ]}
                            />
                        </div>
                        <div>
                            <h2 className="mb-3 text-sm font-medium">任务状态</h2>
                            <Table<UsageGroup>
                                rowKey="key"
                                size="middle"
                                pagination={false}
                                dataSource={data?.byStatus || []}
                                columns={[
                                    {
                                        title: "状态",
                                        dataIndex: "key",
                                        render: (value) => <Tag color={value === "succeeded" ? "green" : value === "failed" ? "red" : undefined}>{statusLabels[value as keyof typeof statusLabels] || value}</Tag>,
                                    },
                                    { title: "调用", dataIndex: "calls", width: 90, render: integer },
                                    { title: "金额", dataIndex: "amountUsd", width: 110, align: "right", render: usd },
                                ]}
                            />
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
