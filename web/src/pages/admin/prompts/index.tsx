import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input, Select, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";

import { AdminPageHeader, capabilityLabels } from "@/pages/admin/components";
import { fetchAdminPrompts, type Capability } from "@/services/api/admin";

export default function AdminPromptsPage() {
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
            <AdminPageHeader title="提示词分析" description="查看用户提交的提示词，了解常用关键词和实际使用场景。每次查看都会记录审计日志。" />
            <div className="mb-5 flex flex-wrap gap-2">
                <Input.Search
                    className="max-w-sm"
                    allowClear
                    placeholder="搜索提示词内容"
                    onSearch={(value) => {
                        setKeyword(value.trim());
                        setPage(1);
                    }}
                />
                <Select
                    className="w-32"
                    allowClear
                    placeholder="生成类型"
                    value={capability}
                    onChange={(value) => {
                        setCapability(value);
                        setPage(1);
                    }}
                    options={Object.entries(capabilityLabels).map(([value, label]) => ({ value, label }))}
                />
            </div>
            <Table
                rowKey="jobId"
                loading={isFetching}
                dataSource={data?.items || []}
                pagination={{ current: page, pageSize, total: data?.total || 0, showSizeChanger: false, onChange: setPage }}
                columns={[
                    { title: "时间", dataIndex: "createdAt", width: 160, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm") },
                    { title: "用户", dataIndex: "userEmail", width: 190, ellipsis: true },
                    { title: "模型", dataIndex: "modelName", width: 140, ellipsis: true },
                    { title: "类型", dataIndex: "capability", width: 80, render: (value) => <Tag>{capabilityLabels[value as Capability]}</Tag> },
                    {
                        title: "提示词",
                        dataIndex: "prompt",
                        render: (value) => (
                            <Typography.Paragraph className="!mb-0 whitespace-pre-wrap" ellipsis={{ rows: 3, expandable: true, symbol: "展开" }}>
                                {value}
                            </Typography.Paragraph>
                        ),
                    },
                ]}
            />
        </div>
    );
}
