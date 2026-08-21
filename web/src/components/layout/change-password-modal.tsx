import { useState } from "react";
import { App, Form, Input, Modal } from "antd";
import { useTranslation } from "react-i18next";

import { changePassword } from "@/services/api/auth";

type PasswordForm = { currentPassword: string; newPassword: string; confirmPassword: string };

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation("auth");
    const { message } = App.useApp();
    const [form] = Form.useForm<PasswordForm>();
    const [saving, setSaving] = useState(false);

    function close() {
        form.resetFields();
        onClose();
    }

    async function submit(values: PasswordForm) {
        setSaving(true);
        try {
            await changePassword(values.currentPassword, values.newPassword);
            message.success(t("passwordChanged"));
            close();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("passwordChangeFailed"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal title={t("changePassword")} open={open} onCancel={close} onOk={() => form.submit()} okText={t("savePassword")} cancelText={t("cancelPassword")} confirmLoading={saving} destroyOnHidden>
            <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
                <Form.Item name="currentPassword" label={t("currentPassword")} rules={[{ required: true, min: 8, message: t("passwordRule") }]}>
                    <Input.Password autoComplete="current-password" />
                </Form.Item>
                <Form.Item name="newPassword" label={t("newPassword")} rules={[{ required: true, min: 8, message: t("passwordRule") }]}>
                    <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Form.Item
                    name="confirmPassword"
                    label={t("confirmPassword")}
                    dependencies={["newPassword"]}
                    rules={[
                        { required: true },
                        ({ getFieldValue }) => ({ validator: (_, value) => (!value || getFieldValue("newPassword") === value ? Promise.resolve() : Promise.reject(new Error(t("passwordMismatch")))) }),
                    ]}
                >
                    <Input.Password autoComplete="new-password" />
                </Form.Item>
            </Form>
        </Modal>
    );
}
