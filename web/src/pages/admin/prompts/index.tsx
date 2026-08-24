import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input, Select, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";

import { AdminPageHeader, capabilities } from "@/pages/admin/components";
import { fetchAdminPrompts, type Capability } from "@/services/api/admin";

export default function AdminPromptsPage() {
    const { t } = useTranslation("admin");
    const [keyword, setKeyword] = useState("");
    const [capability, setCapability] = useState<Capability>();
    const [page, setPage] = useState(1);
    const pageSize = 20;
    const { data, isFetching } = useQuery({
        queryKey: ["admin-prompts", keyword, capability, page],
        queryFn: () => fetchAdminPrompts({ keyword: keyword || undefined, capability, page, pageSize }),
    });

    return (
        <div className="mx-auto max-w-7xl">
            <AdminPageHeader title={t("nav.prompts")} description={t("prompts.description")} />
            <div className="mb-5 flex flex-wrap gap-2">
                <Input.Search
                    className="max-w-sm"
                    allowClear
                    placeholder={t("prompts.search")}
                    onSearch={(value) => {
                        setKeyword(value.trim());
                        setPage(1);
                    }}
                />
                <Select
                    className="w-32"
                    allowClear
                    placeholder={t("prompts.generationType")}
                    value={capability}
                    onChange={(value) => {
                        setCapability(value);
                        setPage(1);
                    }}
                    options={capabilities.map((value) => ({ value, label: t(`common.${value}`) }))}
                />
            </div>
            <Table
                rowKey="jobId"
                loading={isFetching}
                dataSource={data?.items || []}
                pagination={{ current: page, pageSize, total: data?.total || 0, showSizeChanger: false, onChange: setPage }}
                columns={[
                    { title: t("common.time"), dataIndex: "createdAt", width: 160, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
                    { title: t("common.user"), dataIndex: "userEmail", width: 190, ellipsis: true },
                    { title: t("common.model"), dataIndex: "modelName", width: 140, ellipsis: true },
                    { title: t("common.type"), dataIndex: "capability", width: 80, render: (value) => <Tag>{t(`common.${value}`)}</Tag> },
                    {
                        title: t("common.prompt"),
                        dataIndex: "prompt",
                        render: (value) => (
                            <Typography.Paragraph className="!mb-0 whitespace-pre-wrap" ellipsis={{ rows: 3, expandable: true, symbol: t("prompts.expand") }}>
                                {value}
                            </Typography.Paragraph>
                        ),
                    },
                ]}
            />
        </div>
    );
}
