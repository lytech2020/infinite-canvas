import type { ReactNode } from "react";
import { Compass, Focus, HelpCircle } from "lucide-react";
import { useState } from "react";
import { Button, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number) => void;
    onReset: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap }: CanvasZoomControlsProps) {
    const { t } = useTranslation("canvas");
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(28,25,23,.12)" };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    return (
        <div className="absolute bottom-5 left-5 z-50" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex h-14 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={dockStyle}>
                <Tooltip title={t(isMiniMapOpen ? "controls.closeMiniMap" : "controls.openMiniMap")}>
                    <Button
                        type="text"
                        className="!h-8 !w-8 !min-w-8 !p-0"
                        style={isMiniMapOpen ? activeStyle : { color: theme.toolbar.item }}
                        icon={<Compass className="size-4" />}
                        onClick={onToggleMiniMap}
                        aria-label={t(isMiniMapOpen ? "controls.closeMiniMap" : "controls.openMiniMap")}
                    />
                </Tooltip>
                <Tooltip title={t("controls.resetView")}>
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={{ color: theme.toolbar.item }} icon={<Focus className="size-4" />} onClick={onReset} aria-label={t("controls.resetView")} />
                </Tooltip>
                <Tooltip title={t("controls.zoom")}>
                    <input
                        type="range"
                        min="5"
                        max="500"
                        step="1"
                        value={Math.round(scale * 100)}
                        className="w-24"
                        style={{ accentColor: theme.node.activeStroke }}
                        onChange={(event) => onScaleChange(Number(event.target.value) / 100)}
                        aria-label={t("controls.zoom")}
                    />
                </Tooltip>
                <span className="w-10 text-right text-xs tabular-nums" style={{ color: theme.node.muted }}>
                    {Math.round(scale * 100)}%
                </span>
                <Tooltip title={t("controls.shortcuts")}>
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={shortcutsOpen ? activeStyle : { color: theme.toolbar.item }} icon={<HelpCircle className="size-4" />} onClick={() => setShortcutsOpen(true)} aria-label={t("controls.shortcuts")} />
                </Tooltip>
            </div>
            <Modal title={t("controls.shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-3 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut label={t("topBar.shortcutItems.dragCanvas")} value={t("topBar.shortcutItems.panView")} />
                    <Shortcut label={t("topBar.shortcutItems.wheel")} value={t("topBar.shortcutItems.zoomCanvas")} />
                    <Shortcut label={`Ctrl / Cmd + ${t("topBar.shortcutItems.drag")}`} value={t("topBar.shortcutItems.boxSelect")} />
                    <Shortcut label={`Shift / Ctrl / Cmd + ${t("topBar.shortcutItems.click")}`} value={t("topBar.shortcutItems.addSelection")} />
                    <Shortcut label="Ctrl / Cmd + C / V" value={t("controls.copyPasteNodes")} />
                    <Shortcut label="Delete / Backspace" value={t("topBar.shortcutItems.deleteSelected")} />
                </div>
            </Modal>
        </div>
    );
}

function Shortcut({ label, value }: { label: ReactNode; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-base font-medium">{label}</span>
            <span className="opacity-60">{value}</span>
        </div>
    );
}
