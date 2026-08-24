import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DatePicker, Empty, Segmented, Skeleton, Table, Tag } from "antd";
import type { Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";

import { AdminPageHeader, integer, MetricCard } from "@/pages/admin/components";
import { fetchAdminOverview, type UsageGroup } from "@/services/api/admin";

type Range = "today" | "month" | "custom";

export default function AdminOverviewPage() {
    const { t } = useTranslation("admin");
    const [range, setRange] = useState<Range>("month");
    const [dates, setDates] = useState<[Dayjs, Dayjs] | null>(null);
    const filters = range === "custom" && dates ? { from: dates[0].startOf("day").toISOString(), to: dates[1].endOf("day").toISOString() } : {};
    const { data, isLoading } = useQuery({ queryKey: ["admin-overview", filters], queryFn: () => fetchAdminOverview(filters) });
    const summary = data?.[range];

    return (
        <div className="mx-auto max-w-7xl">
            <AdminPageHeader
                title={t("nav.overview")}
                description={t("overview.description")}
                extra={
                    <div className="flex flex-wrap gap-2">
                        <Segmented<Range>
                            value={range}
                            onChange={setRange}
                            options={[
                                { label: t("overview.today"), value: "today" },
                                { label: t("overview.month"), value: "month" },
                                { label: t("overview.custom"), value: "custom" },
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
                    <section className="grid gap-3 sm:grid-cols-3">
                        <MetricCard label={t("overview.totalUsers")} value={integer(data?.users.total)} secondary={t("overview.active30", { count: integer(data?.users.activeIn30Days) })} />
                        <MetricCard label={t("overview.executing")} value={integer(data?.runningJobs)} secondary={t("overview.executingHint")} />
                        <MetricCard label={t("overview.callCount")} value={integer(summary?.calls)} secondary={`Token ${integer(summary?.totalTokens)}`} />
                    </section>

                    <section className="mt-8 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
                        <div>
                            <h2 className="mb-3 text-sm font-medium">{t("overview.modelRanking")}</h2>
                            <Table<UsageGroup>
                                rowKey="key"
                                size="middle"
                                pagination={false}
                                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("overview.empty")} /> }}
                                dataSource={data?.byModel || []}
                                columns={[
                                    { title: t("common.model"), dataIndex: "modelName" },
                                    { title: t("common.type"), dataIndex: "capability", width: 90, render: (value) => (value ? t(`common.${value}`) : "—") },
                                    { title: t("common.calls"), dataIndex: "calls", width: 90, render: integer },
                                ]}
                            />
                        </div>
                        <div>
                            <h2 className="mb-3 text-sm font-medium">{t("overview.taskStatus")}</h2>
                            <Table<UsageGroup>
                                rowKey="key"
                                size="middle"
                                pagination={false}
                                dataSource={data?.byStatus || []}
                                columns={[
                                    {
                                        title: t("common.status"),
                                        dataIndex: "key",
                                        render: (value) => <Tag color={value === "succeeded" ? "green" : value === "failed" ? "red" : undefined}>{String(t(`common.${value}`, { defaultValue: value }))}</Tag>,
                                    },
                                    { title: t("common.calls"), dataIndex: "calls", width: 90, render: integer },
                                ]}
                            />
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
