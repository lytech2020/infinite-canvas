import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Form, Input, InputNumber, Modal, Table, Tag } from "antd";
import dayjs from "dayjs";
import { UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { AdminPageHeader, integer, MetricCard, usd } from "@/pages/admin/components";
import { createAdminUser, fetchAdminUser, fetchAdminUserProjects, fetchAdminUsers, updateAdminUserLimits, updateAdminUserStatus, type CloudUser, type UserLimits } from "@/services/api/auth";

type CreateUserValues = { email: string; password: string };
type UserLimitValues = { dailyCallLimit?: number; monthlyBudgetUsd?: string; concurrencyLimit?: number; videoConcurrencyLimit?: number };

export default function AdminUsersPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [form] = Form.useForm<CreateUserValues>();
    const [limitsForm] = Form.useForm<UserLimitValues>();
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
    const [limitsOpen, setLimitsOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<CloudUser | null>(null);
    const pageSize = 20;

    const { data, isFetching } = useQuery({ queryKey: ["admin-users", keyword, page], queryFn: () => fetchAdminUsers({ keyword, page, pageSize }) });
    const detail = useQuery({ queryKey: ["admin-user", selectedUser?.id], queryFn: () => fetchAdminUser(selectedUser!.id), enabled: Boolean(selectedUser) });
    const projects = useQuery({ queryKey: ["admin-user-projects", selectedUser?.id], queryFn: () => fetchAdminUserProjects(selectedUser!.id), enabled: Boolean(selectedUser) });

    const createUser = useMutation({
        mutationFn: ({ email, password }: CreateUserValues) => createAdminUser(email, password),
        onSuccess: async () => {
            setCreateOpen(false);
            setPage(1);
            form.resetFields();
            message.success("用户已添加");
            await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
        },
        onError: (error: Error) => message.error(error.message),
    });

    const saveLimits = useMutation({
        mutationFn: (values: UserLimitValues) =>
            updateAdminUserLimits(selectedUser!.id, {
                dailyCallLimit: values.dailyCallLimit ?? null,
                monthlyBudgetUsd: values.monthlyBudgetUsd?.trim() || null,
                concurrencyLimit: values.concurrencyLimit ?? null,
                videoConcurrencyLimit: values.videoConcurrencyLimit ?? null,
            } satisfies UserLimits),
        onSuccess: async () => {
            setLimitsOpen(false);
            message.success("账户限额已更新");
            await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-user", selectedUser?.id] }), queryClient.invalidateQueries({ queryKey: ["admin-users"] })]);
        },
        onError: (error: Error) => message.error(error.message),
    });

    const openLimits = () => {
        const user = detail.data?.user || selectedUser;
        if (!user) return;
        limitsForm.setFieldsValue({
            dailyCallLimit: user.dailyCallLimit ?? undefined,
            monthlyBudgetUsd: user.monthlyBudgetUsd ? String(Number(user.monthlyBudgetUsd)) : undefined,
            concurrencyLimit: user.concurrencyLimit ?? undefined,
            videoConcurrencyLimit: user.videoConcurrencyLimit ?? undefined,
        });
        setLimitsOpen(true);
    };

    const toggleStatus = useMutation({
        mutationFn: ({ id, status }: { id: string; status: CloudUser["status"] }) => updateAdminUserStatus(id, status),
        onSuccess: async () => {
            message.success("账号状态已更新");
            await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
        },
        onError: (error: Error) => message.error(error.message),
    });

    return (
        <div className="mx-auto max-w-7xl">
            <AdminPageHeader
                title="用户管理"
                description="查看注册用户、使用成本和画布项目，并控制账号状态。"
                extra={
                    <Button type="primary" icon={<UserPlus size={16} />} onClick={() => setCreateOpen(true)}>
                        添加用户
                    </Button>
                }
            />
            <Input.Search
                className="mb-5 max-w-sm"
                allowClear
                placeholder="按邮箱搜索"
                onSearch={(value) => {
                    setKeyword(value.trim());
                    setPage(1);
                }}
            />
            <Table<CloudUser>
                rowKey="id"
                loading={isFetching}
                dataSource={data?.items || []}
                scroll={{ x: 900 }}
                pagination={{ current: page, pageSize, total: data?.total || 0, showSizeChanger: false, onChange: setPage }}
                columns={[
                    { title: "邮箱", dataIndex: "email", ellipsis: true },
                    { title: "角色", dataIndex: "role", width: 110, render: (role) => <Tag color={role === "admin" ? "gold" : undefined}>{role === "admin" ? "管理员" : "普通用户"}</Tag> },
                    { title: "状态", dataIndex: "status", width: 100, render: (status) => <Tag color={status === "active" ? "green" : "red"}>{status === "active" ? "已启用" : "已停用"}</Tag> },
                    { title: "调用", dataIndex: "calls", width: 90, align: "right", render: integer },
                    { title: "近 30 天", dataIndex: "amountUsdIn30Days", width: 110, align: "right", render: usd },
                    { title: "累计金额", dataIndex: "amountUsd", width: 110, align: "right", render: usd },
                    {
                        title: "操作",
                        width: 180,
                        render: (_, record) => (
                            <div className="flex gap-2">
                                <Button size="small" type="text" onClick={() => setSelectedUser(record)}>
                                    查看
                                </Button>
                                <Button size="small" type="text" danger={record.status === "active"} loading={toggleStatus.isPending} onClick={() => toggleStatus.mutate({ id: record.id, status: record.status === "active" ? "disabled" : "active" })}>
                                    {record.status === "active" ? "停用" : "启用"}
                                </Button>
                            </div>
                        ),
                    },
                ]}
            />

            <Modal
                title="添加用户"
                open={createOpen}
                okText="添加"
                cancelText="取消"
                confirmLoading={createUser.isPending}
                destroyOnHidden
                onOk={() => form.submit()}
                onCancel={() => setCreateOpen(false)}
                afterClose={() => form.resetFields()}
            >
                <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">创建一个可立即登录的普通用户账号。</p>
                <Form<CreateUserValues> form={form} layout="vertical" preserve={false} onFinish={(values) => createUser.mutate(values)}>
                    <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email", message: "请输入有效邮箱" }]}>
                        <Input autoComplete="off" placeholder="name@example.com" />
                    </Form.Item>
                    <Form.Item name="password" label="初始密码" extra="密码长度为 8–16 个字符。" rules={[{ required: true, min: 8, max: 16, message: "请输入 8–16 个字符的密码" }]}>
                        <Input.Password autoComplete="new-password" placeholder="请输入初始密码" />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title="账户限额"
                open={limitsOpen}
                okText="保存"
                cancelText="取消"
                confirmLoading={saveLimits.isPending}
                destroyOnHidden
                onOk={() => limitsForm.submit()}
                onCancel={() => setLimitsOpen(false)}
                afterClose={() => limitsForm.resetFields()}
            >
                <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">留空表示调用和金额不限制，并发则继承系统默认值。金额达到上限后将禁止创建下一次任务。</p>
                <Form<UserLimitValues> form={limitsForm} layout="vertical" preserve={false} onFinish={(values) => saveLimits.mutate(values)}>
                    <div className="grid gap-x-4 sm:grid-cols-2">
                        <Form.Item name="dailyCallLimit" label="每日调用次数" rules={[{ type: "integer", min: 1, max: 1_000_000, message: "请输入 1–1,000,000 的整数" }]}>
                            <InputNumber className="w-full" min={1} max={1_000_000} precision={0} placeholder="不限" />
                        </Form.Item>
                        <Form.Item name="monthlyBudgetUsd" label="每月消费上限" rules={[{ pattern: /^(?=.*[1-9])(?:0\.\d{1,4}|[1-9]\d{0,8}(?:\.\d{1,4})?)$/, message: "请输入大于 0、最多 4 位小数的金额" }]}>
                            <Input prefix="$" placeholder="不限" />
                        </Form.Item>
                        <Form.Item name="concurrencyLimit" label="同时运行任务数" rules={[{ type: "integer", min: 1, max: 1000, message: "请输入 1–1000 的整数" }]}>
                            <InputNumber className="w-full" min={1} max={1000} precision={0} placeholder="继承系统默认" />
                        </Form.Item>
                        <Form.Item name="videoConcurrencyLimit" label="同时运行视频数" rules={[{ type: "integer", min: 1, max: 1000, message: "请输入 1–1000 的整数" }]}>
                            <InputNumber className="w-full" min={1} max={1000} precision={0} placeholder="继承系统默认" />
                        </Form.Item>
                    </div>
                </Form>
            </Modal>

            <Drawer title={selectedUser?.email} width={680} open={Boolean(selectedUser)} onClose={() => setSelectedUser(null)}>
                <section className="grid gap-3 sm:grid-cols-3">
                    <MetricCard label="累计调用" value={integer(detail.data?.total.calls)} />
                    <MetricCard label="累计 Token" value={integer(detail.data?.total.totalTokens)} />
                    <MetricCard label="累计金额" value={usd(detail.data?.total.amountUsd)} />
                </section>
                <div className="mb-3 mt-7 flex items-center justify-between">
                    <h3 className="text-sm font-medium">账户限额</h3>
                    <Button type="text" size="small" onClick={openLimits}>
                        编辑限额
                    </Button>
                </div>
                <section className="grid gap-3 sm:grid-cols-2">
                    <MetricCard label="今日调用" value={`${integer(detail.data?.quotaUsage.dailyCalls)} / ${detail.data?.user.dailyCallLimit ? integer(detail.data.user.dailyCallLimit) : "不限"}`} secondary={`按 ${detail.data?.quotaUsage.timezone || "—"} 重置`} />
                    <MetricCard label="本月消费" value={`${usd(detail.data?.quotaUsage.monthlyAmountUsd)} / ${detail.data?.user.monthlyBudgetUsd ? usd(detail.data.user.monthlyBudgetUsd) : "不限"}`} secondary="按已结算金额计算" />
                    <MetricCard label="任务并发" value={integer(detail.data?.quotaUsage.effectiveConcurrencyLimit)} secondary={detail.data?.user.concurrencyLimit ? "账户单独设置" : "继承系统默认"} />
                    <MetricCard label="视频并发" value={integer(detail.data?.quotaUsage.effectiveVideoConcurrencyLimit)} secondary={detail.data?.user.videoConcurrencyLimit ? "账户单独设置" : "继承系统默认"} />
                </section>
                <h3 className="mb-3 mt-7 text-sm font-medium">项目用量</h3>
                <Button className="mb-3" size="small" onClick={() => navigate(`/admin/usage?userId=${selectedUser?.id || ""}`)}>
                    查看全部调用明细
                </Button>
                <Table
                    rowKey={(record) => record.projectId || "workbench"}
                    size="small"
                    loading={projects.isFetching}
                    pagination={false}
                    dataSource={projects.data?.items || []}
                    columns={[
                        { title: "项目", dataIndex: "name", ellipsis: true },
                        { title: "最近使用", dataIndex: "lastUsedAt", width: 140, render: (value) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—") },
                        { title: "调用", dataIndex: "calls", width: 75, align: "right", render: integer },
                        { title: "金额", dataIndex: "amountUsd", width: 90, align: "right", render: usd },
                        {
                            title: "操作",
                            width: 70,
                            render: (_, record) => (
                                <Button type="text" size="small" onClick={() => navigate(`/admin/usage?userId=${selectedUser?.id || ""}${record.projectId ? `&projectId=${record.projectId}` : ""}`)}>
                                    明细
                                </Button>
                            ),
                        },
                    ]}
                />
            </Drawer>
        </div>
    );
}
