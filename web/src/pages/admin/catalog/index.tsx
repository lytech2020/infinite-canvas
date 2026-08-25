import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Collapse, Form, Input, InputNumber, Modal, Popconfirm, Select, Switch, Table, Tabs, Tag } from "antd";

import { AdminPageHeader, capabilityLabels } from "@/pages/admin/components";
import {
    deleteAdminModel,
    deleteAdminProvider,
    fetchAdminModels,
    fetchAdminProviders,
    fetchAdminSettings,
    saveAdminModel,
    saveAdminProvider,
    saveAdminSettings,
    type AdminModel,
    type AdminProvider,
} from "@/services/api/admin";

type ProviderForm = { name: string; apiFormat: AdminProvider["apiFormat"]; baseUrl: string; apiKey?: string; apiVersion?: string; enabled: boolean };
type ModelForm = {
    providerId: string;
    displayName: string;
    remoteName: string;
    capability: AdminModel["capability"];
    paramSchemaJson: string;
    fileLimitsJson: string;
    maxOutputCount?: number;
    maxConcurrency?: number;
    enabled: boolean;
    isDefault: boolean;
    sortOrder: number;
};
const apiFormats = [
    { value: "openai", label: "OpenAI 兼容" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "azure_openai", label: "Azure OpenAI" },
    { value: "gemini", label: "Google Gemini（后台适配中）", disabled: true },
    { value: "ark", label: "火山方舟" },
];

const modelJsonDefaults: Record<AdminModel["capability"], { paramSchema: Record<string, unknown>; fileLimits: Record<string, unknown> }> = {
    text: {
        paramSchema: {
            reasoningEffort: { type: "enum", values: ["auto", "low", "medium", "high", "xhigh"], default: "auto" },
            maxOutputTokens: { type: "number", min: 1, max: 32768, step: 1, default: 4096 },
        },
        fileLimits: { image: { maxCount: 9, maxSizeMb: 20 } },
    },
    image: {
        paramSchema: {
            size: { type: "string", default: "auto" },
            quality: { type: "enum", values: ["auto", "low", "medium", "high"], default: "auto" },
        },
        fileLimits: { image: { maxCount: 9, maxSizeMb: 20 } },
    },
    video: {
        paramSchema: {
            size: { type: "string", default: "1280x720" },
            seconds: { type: "number", min: 1, max: 60, step: 1, default: 6 },
            resolution: { type: "string", default: "720p" },
            generateAudio: { type: "boolean", default: true },
            watermark: { type: "boolean", default: false },
        },
        fileLimits: {
            image: { maxCount: 9, maxSizeMb: 20 },
            video: { maxCount: 3, maxSizeMb: 200 },
            audio: { maxCount: 3, maxSizeMb: 20 },
        },
    },
    audio: {
        paramSchema: {
            voice: { type: "string", default: "alloy" },
            format: { type: "enum", values: ["mp3", "wav", "opus", "aac", "flac", "pcm"], default: "mp3" },
            speed: { type: "number", min: 0.25, max: 4, step: 0.25, default: 1 },
        },
        fileLimits: { audio: { maxCount: 3, maxSizeMb: 20 } },
    },
};

function jsonDefaults(capability: AdminModel["capability"]) {
    const defaults = modelJsonDefaults[capability];
    return { paramSchemaJson: JSON.stringify(defaults.paramSchema, null, 2), fileLimitsJson: JSON.stringify(defaults.fileLimits, null, 2) };
}

function configuredJson(value: Record<string, unknown>, fallback: string) {
    return Object.keys(value).length ? JSON.stringify(value, null, 2) : fallback;
}

function SystemSettings() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const settings = useQuery({ queryKey: ["admin-settings"], queryFn: fetchAdminSettings });
    const save = useMutation({
        mutationFn: saveAdminSettings,
        onSuccess: async () => {
            message.success("系统设置已保存");
            await queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
        },
        onError: (error: Error) => message.error(error.message),
    });
    return (
        <div className="max-w-xl rounded-xl border border-stone-200 p-5 dark:border-stone-800">
            <div className="flex items-center justify-between gap-5">
                <div>
                    <div className="text-sm font-medium">开放用户注册</div>
                    <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">关闭后已有用户仍可登录，新用户不能自行创建账号。</p>
                </div>
                <Switch loading={settings.isFetching || save.isPending} checked={settings.data?.registrationOpen ?? false} onChange={(value) => save.mutate(value)} />
            </div>
            <p className="mt-5 border-t border-stone-200 pt-4 text-xs leading-5 text-stone-400 dark:border-stone-800">用户并发上限通过部署环境变量设置；模型并发、单次生成数、参数范围和文件限制在“模型”中单独配置。</p>
        </div>
    );
}

function parseObject(value: string, label: string) {
    try {
        const result = JSON.parse(value || "{}");
        if (!result || Array.isArray(result) || typeof result !== "object") throw new Error();
        return result as Record<string, unknown>;
    } catch {
        throw new Error(`${label}必须是有效的 JSON 对象`);
    }
}

export default function AdminCatalogPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [providerForm] = Form.useForm<ProviderForm>();
    const [modelForm] = Form.useForm<ModelForm>();
    const [editingProvider, setEditingProvider] = useState<AdminProvider | null>();
    const [editingModel, setEditingModel] = useState<AdminModel | null>();

    const providers = useQuery({ queryKey: ["admin-providers"], queryFn: fetchAdminProviders });
    const models = useQuery({ queryKey: ["admin-models"], queryFn: () => fetchAdminModels() });

    const refreshCatalog = async () => {
        await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-providers"] }), queryClient.invalidateQueries({ queryKey: ["admin-models"] })]);
    };
    const providerSave = useMutation({
        mutationFn: async (values: ProviderForm) =>
            saveAdminProvider({
                id: editingProvider?.id,
                name: values.name,
                apiFormat: values.apiFormat,
                baseUrl: values.baseUrl,
                apiKey: values.apiKey,
                apiVersion: values.apiVersion || null,
                enabled: values.enabled,
            }),
        onSuccess: async () => {
            message.success("渠道已保存");
            setEditingProvider(undefined);
            await refreshCatalog();
        },
        onError: (error: Error) => message.error(error.message),
    });
    const modelSave = useMutation({
        mutationFn: async (values: ModelForm) =>
            saveAdminModel({
                id: editingModel?.id,
                providerId: values.providerId,
                displayName: values.displayName,
                remoteName: values.remoteName,
                capability: values.capability,
                paramSchema: parseObject(values.paramSchemaJson, "参数定义"),
                fileLimits: parseObject(values.fileLimitsJson, "文件限制"),
                maxOutputCount: values.maxOutputCount || null,
                maxConcurrency: values.maxConcurrency || null,
                enabled: values.enabled,
                isDefault: values.isDefault,
                sortOrder: values.sortOrder,
            }),
        onSuccess: async () => {
            message.success("模型已保存");
            setEditingModel(undefined);
            await refreshCatalog();
        },
        onError: (error: Error) => message.error(error.message),
    });
    const remove = useMutation({
        mutationFn: ({ kind, id }: { kind: "provider" | "model"; id: string }) => (kind === "provider" ? deleteAdminProvider(id) : deleteAdminModel(id)),
        onSuccess: async () => {
            message.success("已删除");
            await refreshCatalog();
        },
        onError: (error: Error) => message.error(error.message),
    });

    function openProvider(provider?: AdminProvider) {
        setEditingProvider(provider || null);
        providerForm.setFieldsValue({
            name: provider?.name || "",
            apiFormat: provider?.apiFormat || "openai",
            baseUrl: provider?.baseUrl || "",
            apiKey: "",
            apiVersion: provider?.apiVersion || "",
            enabled: provider?.enabled ?? true,
        });
    }

    function openModel(model?: AdminModel) {
        const capability = model?.capability || "text";
        const defaults = jsonDefaults(capability);
        setEditingModel(model || null);
        modelForm.setFieldsValue({
            providerId: model?.providerId || providers.data?.items[0]?.id,
            displayName: model?.displayName || "",
            remoteName: model?.remoteName || "",
            capability,
            ...(model
                ? { paramSchemaJson: configuredJson(model.paramSchema || {}, defaults.paramSchemaJson), fileLimitsJson: configuredJson(model.fileLimits || {}, defaults.fileLimitsJson) }
                : defaults),
            maxOutputCount: model?.maxOutputCount || undefined,
            maxConcurrency: model?.maxConcurrency || undefined,
            enabled: model?.enabled ?? true,
            isDefault: model?.isDefault ?? false,
            sortOrder: model?.sortOrder || 0,
        });
    }

    const providerTab = (
        <>
            <div className="mb-4 flex justify-end">
                <Button type="primary" onClick={() => openProvider()}>
                    新增渠道
                </Button>
            </div>
            <Table<AdminProvider>
                rowKey="id"
                loading={providers.isFetching}
                dataSource={providers.data?.items || []}
                columns={[
                    { title: "名称", dataIndex: "name" },
                    { title: "接口格式", dataIndex: "apiFormat", width: 140 },
                    { title: "Base URL", dataIndex: "baseUrl", ellipsis: true },
                    { title: "密钥", dataIndex: "apiKeyMask", width: 130 },
                    { title: "状态", dataIndex: "enabled", width: 90, render: (value) => <Tag color={value ? "green" : undefined}>{value ? "启用" : "停用"}</Tag> },
                    {
                        title: "操作",
                        width: 150,
                        render: (_, record) => (
                            <div className="flex gap-1">
                                <Button type="text" size="small" onClick={() => openProvider(record)}>
                                    编辑
                                </Button>
                                <Popconfirm title="确认删除这个渠道？" description="仍有模型引用时无法删除。" onConfirm={() => remove.mutate({ kind: "provider", id: record.id })}>
                                    <Button type="text" size="small" danger>
                                        删除
                                    </Button>
                                </Popconfirm>
                            </div>
                        ),
                    },
                ]}
            />
        </>
    );

    const modelTab = (
        <>
            <div className="mb-4 flex justify-end">
                <Button type="primary" disabled={!providers.data?.items.length} onClick={() => openModel()}>
                    新增模型
                </Button>
            </div>
            <Table<AdminModel>
                rowKey="id"
                loading={models.isFetching}
                dataSource={models.data?.items || []}
                scroll={{ x: 900 }}
                columns={[
                    { title: "显示名称", dataIndex: "displayName" },
                    { title: "调用名称", dataIndex: "remoteName", ellipsis: true },
                    { title: "类型", dataIndex: "capability", width: 90, render: (value) => capabilityLabels[value as AdminModel["capability"]] },
                    { title: "默认", dataIndex: "isDefault", width: 75, render: (value) => (value ? <Tag color="gold">默认</Tag> : "—") },
                    { title: "状态", dataIndex: "enabled", width: 80, render: (value) => <Tag color={value ? "green" : undefined}>{value ? "启用" : "停用"}</Tag> },
                    {
                        title: "操作",
                        width: 150,
                        render: (_, record) => (
                            <div className="flex gap-1">
                                <Button type="text" size="small" onClick={() => openModel(record)}>
                                    编辑
                                </Button>
                                <Popconfirm title="确认删除这个模型？" description="已有调用记录的模型只能停用。" onConfirm={() => remove.mutate({ kind: "model", id: record.id })}>
                                    <Button type="text" size="small" danger>
                                        删除
                                    </Button>
                                </Popconfirm>
                            </div>
                        ),
                    },
                ]}
            />
        </>
    );

    return (
        <div className="mx-auto max-w-7xl">
            <AdminPageHeader title="模型与渠道" description="配置 AI 供应商和可用模型。普通用户不会看到密钥和实际调用名称。" />
            <Tabs items={[{ key: "models", label: "模型", children: modelTab }, { key: "providers", label: "渠道", children: providerTab }, { key: "settings", label: "系统设置", children: <SystemSettings /> }]} />

            <Modal
                title={editingProvider ? "编辑渠道" : "新增渠道"}
                open={editingProvider !== undefined}
                onCancel={() => setEditingProvider(undefined)}
                onOk={() => providerForm.submit()}
                confirmLoading={providerSave.isPending}
                destroyOnHidden
            >
                <Form form={providerForm} layout="vertical" onFinish={(values) => providerSave.mutate(values)}>
                    <Form.Item name="name" label="渠道名称" rules={[{ required: true }]}>
                        <Input placeholder="例如 Azure OpenAI" />
                    </Form.Item>
                    <Form.Item name="apiFormat" label="接口格式" rules={[{ required: true }]}>
                        <Select options={apiFormats} />
                    </Form.Item>
                    <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }, { type: "url" }]}>
                        <Input placeholder="https://..." />
                    </Form.Item>
                    <Form.Item name="apiKey" label={editingProvider ? `替换 API Key（当前 ${editingProvider.apiKeyMask}）` : "API Key"} rules={editingProvider ? [] : [{ required: true }]}>
                        <Input.Password autoComplete="new-password" placeholder={editingProvider ? "留空则保持不变" : "输入渠道密钥"} />
                    </Form.Item>
                    <Form.Item name="apiVersion" label="API Version">
                        <Input placeholder="Azure OpenAI 使用，其他渠道可留空" />
                    </Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title={editingModel ? "编辑模型" : "新增模型"}
                width={720}
                open={editingModel !== undefined}
                onCancel={() => setEditingModel(undefined)}
                onOk={() => modelForm.submit()}
                confirmLoading={modelSave.isPending}
                destroyOnHidden
            >
                <Form form={modelForm} layout="vertical" onFinish={(values) => modelSave.mutate(values)}>
                    <div className="grid gap-x-4 sm:grid-cols-2">
                        <Form.Item name="providerId" label="渠道" rules={[{ required: true }]}>
                            <Select options={providers.data?.items.map((provider) => ({ value: provider.id, label: provider.name }))} />
                        </Form.Item>
                        <Form.Item name="capability" label="生成类型" rules={[{ required: true }]}>
                            <Select
                                options={Object.entries(capabilityLabels).map(([value, label]) => ({ value, label }))}
                                onChange={(capability: AdminModel["capability"]) => {
                                    if (editingModel === null) modelForm.setFieldsValue(jsonDefaults(capability));
                                }}
                            />
                        </Form.Item>
                        <Form.Item name="displayName" label="用户看到的名称" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item name="remoteName" label="供应商调用名称" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item name="maxOutputCount" label="单次最大生成数">
                            <InputNumber className="w-full" min={1} precision={0} />
                        </Form.Item>
                        <Form.Item name="maxConcurrency" label="模型并发上限">
                            <InputNumber className="w-full" min={1} precision={0} />
                        </Form.Item>
                        <Form.Item name="sortOrder" label="排序">
                            <InputNumber className="w-full" precision={0} />
                        </Form.Item>
                        <div className="flex gap-8">
                            <Form.Item name="enabled" label="启用" valuePropName="checked">
                                <Switch />
                            </Form.Item>
                            <Form.Item name="isDefault" label="设为默认" valuePropName="checked">
                                <Switch />
                            </Form.Item>
                        </div>
                    </div>
                    <Collapse
                        ghost
                        items={[
                            {
                                key: "advanced",
                                forceRender: true,
                                label: (
                                    <span className="text-sm font-medium">
                                        高级设置 <span className="ml-2 font-normal text-stone-400">参数范围与文件限制</span>
                                    </span>
                                ),
                                children: (
                                    <div className="pt-2">
                                        <Form.Item
                                            name="paramSchemaJson"
                                            label="参数定义（JSON）"
                                            tooltip="定义前端允许用户调节的尺寸、质量、时长等参数"
                                            extra="键名是请求参数；type 支持 enum、number、boolean、string。enum 配 values，数字可配 min、max、step，default 表示默认值。"
                                        >
                                            <Input.TextArea className="font-mono" autoSize={{ minRows: 4, maxRows: 10 }} />
                                        </Form.Item>
                                        <Form.Item
                                            name="fileLimitsJson"
                                            label="文件限制（JSON）"
                                            extra="按 image、video、audio 配置；maxCount 是文件数量上限，maxSizeMb 是单个文件大小（MB）。未填写的类型使用系统默认限制。"
                                        >
                                            <Input.TextArea className="font-mono" autoSize={{ minRows: 3, maxRows: 8 }} />
                                        </Form.Item>
                                    </div>
                                ),
                            },
                        ]}
                    />
                </Form>
            </Modal>

        </div>
    );
}
