import { useEffect, useState } from "react";
import { App, Button, Form, Input } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import { fetchRegistrationOpen } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

type LoginForm = { email: string; password: string };

export default function LoginPage() {
    const { t } = useTranslation("auth");
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const user = useUserStore((state) => state.user);
    const login = useUserStore((state) => state.login);
    const register = useUserStore((state) => state.register);
    const [mode, setMode] = useState<"login" | "register">("login");
    const [registrationOpen, setRegistrationOpen] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const redirect = searchParams.get("redirect") || "/";

    useEffect(() => {
        void fetchRegistrationOpen()
            .then(({ open }) => setRegistrationOpen(open))
            .catch(() => setRegistrationOpen(false));
    }, []);

    useEffect(() => {
        if (user) navigate(redirect, { replace: true });
    }, [navigate, redirect, user]);

    const submit = async (values: LoginForm) => {
        setSubmitting(true);
        try {
            await (mode === "login" ? login(values.email, values.password) : register(values.email, values.password));
            message.success(t(mode === "login" ? "loginSuccess" : "registerSuccess"));
            navigate(redirect, { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("loginFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-10 text-stone-900 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)] dark:text-stone-100">
            <section className="w-full max-w-sm">
                <div className="mb-8 text-center">
                    <h1 className="text-2xl font-semibold tracking-normal">{t(mode === "login" ? "loginTitle" : "registerTitle")}</h1>
                    <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{t(mode === "login" ? "loginDescription" : "registerDescription")}</p>
                </div>

                <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                    <Form<LoginForm> layout="vertical" onFinish={submit} requiredMark={false} disabled={submitting}>
                        <Form.Item name="email" label={t("email")} rules={[{ required: true, type: "email", message: t("emailInvalid") }]}>
                            <Input size="large" autoComplete="email" placeholder="you@example.com" />
                        </Form.Item>
                        <Form.Item name="password" label={t("password")} rules={[{ required: true, min: 8, message: t("passwordRule") }]}>
                            <Input.Password size="large" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={t("passwordRule")} />
                        </Form.Item>
                        <Button type="primary" size="large" htmlType="submit" block loading={submitting}>
                            {t(mode === "login" ? "loginAction" : "registerAction")}
                        </Button>
                    </Form>

                    {registrationOpen ? (
                        <button type="button" className="mt-4 w-full text-center text-sm text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100" onClick={() => setMode(mode === "login" ? "register" : "login")}>
                            {t(mode === "login" ? "switchToRegister" : "switchToLogin")}
                        </button>
                    ) : null}
                </div>

                <p className="mt-6 text-center text-xs leading-5 text-stone-400 dark:text-stone-500">{t("privacyNotice")}</p>
            </section>
        </main>
    );
}
