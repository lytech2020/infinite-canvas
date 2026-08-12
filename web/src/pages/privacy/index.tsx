import { ArrowLeft, Database, FileKey2, HardDrive, ScanSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

const sections = [
    { title: "storedTitle", body: "stored", icon: Database },
    { title: "purposeTitle", body: "purpose", icon: ScanSearch },
    { title: "promptTitle", body: "prompt", icon: FileKey2 },
    { title: "filesTitle", body: "files", icon: HardDrive },
    { title: "localTitle", body: "local", icon: HardDrive },
] as const;

export default function PrivacyPage() {
    const { t } = useTranslation("privacy");
    const navigate = useNavigate();

    return (
        <main className="h-full overflow-y-auto bg-background text-foreground">
            <article className="mx-auto w-full max-w-3xl px-6 py-10 md:py-16">
                <button type="button" onClick={() => navigate(-1)} className="mb-10 inline-flex items-center gap-2 text-sm text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100">
                    <ArrowLeft className="size-4" />
                    {t("back")}
                </button>
                <header className="border-b border-stone-200 pb-10 dark:border-stone-800">
                    <div className="mb-5 h-1 w-14 bg-stone-950 dark:bg-stone-100" />
                    <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("title")}</h1>
                    <p className="mt-5 max-w-2xl text-base leading-8 text-stone-600 dark:text-stone-300">{t("intro")}</p>
                </header>
                <div className="divide-y divide-stone-200 dark:divide-stone-800">
                    {sections.map(({ title, body, icon: Icon }, index) => (
                        <section key={title} className="grid gap-4 py-8 md:grid-cols-[3rem_1fr]">
                            <div className="flex size-9 items-center justify-center border border-stone-200 text-stone-500 dark:border-stone-800 dark:text-stone-400">
                                <Icon className="size-4" />
                            </div>
                            <div>
                                <div className="mb-2 text-xs font-medium tabular-nums text-stone-400">0{index + 1}</div>
                                <h2 className="text-lg font-semibold">{t(title)}</h2>
                                <p className="mt-3 text-sm leading-7 text-stone-600 dark:text-stone-300">{t(body)}</p>
                            </div>
                        </section>
                    ))}
                </div>
            </article>
        </main>
    );
}
