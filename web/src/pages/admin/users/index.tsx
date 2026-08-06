import { useState } from "react";
import { App, Button, Input, Table, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchAdminUsers, updateAdminUserStatus, type CloudUser } from "@/services/api/auth";

export default function AdminUsersPage() {
    const { t } = useTranslation("auth");
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const pageSize = 20;

    const { data, isFetching } = useQuery({
        queryKey: ["admin-users", keyword, page],
        queryFn: () => fetchAdminUsers({ keyword, page, pageSize }),
    });

    const toggleStatus = useMutation({
        mutationFn: ({ id, status }: { id: string; status: CloudUser["status"] }) => updateAdminUserStatus(id, status),
        onSuccess: async () => {
            message.success(t("admin.statusUpdated"));
            await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
        },
        onError: (error: Error) => message.error(error.message),
    });

    return (
        <main className="h-full overflow-y-auto bg-background px-6 py-8 text-stone-900 dark:text-stone-100">
            <div className="mx-auto max-w-5xl">
                <h1 className="text-xl font-semibold tracking-normal">{t("admin.usersTitle")}</h1>
                <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{t("admin.usersDescription")}</p>

                <Input.Search
                    className="mt-6 max-w-sm"
                    allowClear
                    placeholder={t("admin.searchPlaceholder")}
                    onSearch={(value) => {
                        setKeyword(value.trim());
                        setPage(1);
                    }}
                />

                <Table<CloudUser>
                    className="mt-4"
                    rowKey="id"
                    loading={isFetching}
                    dataSource={data?.items || []}
                    pagination={{ current: page, pageSize, total: data?.total || 0, showSizeChanger: false, onChange: setPage }}
                    columns={[
                        { title: t("email"), dataIndex: "email" },
                        {
                            title: t("admin.role"),
                            dataIndex: "role",
                            width: 120,
                            render: (role: CloudUser["role"]) => <Tag color={role === "admin" ? "gold" : undefined}>{t(`admin.roles.${role}`)}</Tag>,
                        },
                        {
                            title: t("admin.status"),
                            dataIndex: "status",
                            width: 120,
                            render: (status: CloudUser["status"]) => <Tag color={status === "active" ? "green" : "red"}>{t(`admin.statuses.${status}`)}</Tag>,
                        },
                        {
                            title: t("admin.actions"),
                            width: 120,
                            render: (_, record) => (
                                <Button size="small" danger={record.status === "active"} loading={toggleStatus.isPending} onClick={() => toggleStatus.mutate({ id: record.id, status: record.status === "active" ? "disabled" : "active" })}>
                                    {t(record.status === "active" ? "admin.disable" : "admin.enable")}
                                </Button>
                            ),
                        },
                    ]}
                />
            </div>
        </main>
    );
}
