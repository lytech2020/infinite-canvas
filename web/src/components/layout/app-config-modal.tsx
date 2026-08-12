import { App, Button, Form, Input, Modal, Select } from "antd";
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { selectableLocales } from "@/i18n/locale";
import { useConfigStore, type ModelCapability } from "@/stores/use-config-store";
import { useLocaleStore } from "@/stores/use-locale-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    labelKey: string;
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", labelKey: "preferences.imageModel" },
    { capability: "video", modelKey: "videoModel", labelKey: "preferences.videoModel" },
    { capability: "text", modelKey: "textModel", labelKey: "preferences.textModel" },
    { capability: "audio", modelKey: "audioModel", labelKey: "preferences.audioModel" },
];

export function AppConfigPanel({ showDoneButton = false }: { showDoneButton?: boolean }) {
    const { message } = App.useApp();
    const { t } = useTranslation(["common", "config"]);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const locale = useLocaleStore((state) => state.locale);
    const setLocale = useLocaleStore((state) => state.setLocale);
    const finishConfig = () => {
        setConfigDialogOpen(false);
        message.success(t(shouldPromptContinue ? "savedContinue" : "saved", { ns: "config" }));
        clearPromptContinue();
    };

    return (
        <>
            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                                    <Languages className="size-4" />
                                    {t("language.section", { ns: "config" })}
                                </div>
                                <Form.Item label={t("language.label", { ns: "config" })} extra={t("language.description", { ns: "config" })} className="mb-5 max-w-sm">
                                    <Select
                                        value={locale}
                                        options={selectableLocales.map((value) => ({ value, label: t(value === "ja-JP" ? "language.options.jaJP" : "language.options.zhCN", { ns: "config" }) }))}
                                        onChange={setLocale}
                                    />
                                </Form.Item>
                                <div className="mb-2 text-sm font-semibold">{t("preferences.defaultModels", { ns: "config" })}</div>
                                <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={t(group.labelKey, { ns: "config" })} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="mb-2 text-sm font-semibold">{t("preferences.generation", { ns: "config" })}</div>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label={t("preferences.canvasImageCount", { ns: "config" })} extra={t("preferences.canvasImageCountHelp", { ns: "config" })} className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label={t("preferences.audioVoice", { ns: "config" })} className="mb-4">
                                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("preferences.audioFormat", { ns: "config" })} className="mb-4">
                                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label={t("preferences.audioSpeed", { ns: "config" })} className="mb-4">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                        />
                                    </Form.Item>
                                </div>
                                <Form.Item label={t("preferences.audioInstructions", { ns: "config" })} className="mb-4">
                                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder={t("preferences.audioInstructionsPlaceholder", { ns: "config" })} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
            </Form>
            {showDoneButton ? (
                <div className="mt-4 flex justify-end">
                    <Button type="primary" onClick={finishConfig}>
                        {t("actions.done")}
                    </Button>
                </div>
            ) : null}
        </>
    );
}

export function AppConfigModal() {
    const { t } = useTranslation("config");
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">{t("title")}</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">{t("subtitle")}</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton />
        </Modal>
    );
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}
