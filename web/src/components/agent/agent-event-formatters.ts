import { isSiteTool } from "@/lib/agent/agent-site-tools";
import { summarizeCanvasAgentOps, type CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { randomId } from "@/lib/utils";
import i18n from "@/i18n";
import { useAgentStore, type AgentAttachment, type AgentChatItem, type AgentEventLog, type AgentTokenUsage } from "@/stores/use-agent-store";
import type { AgentChatAttachment } from "./agent-chat-message";
export const REASONING_PLACEHOLDER = "正在分析任务…";

function tr(key: string, options?: Record<string, unknown>) {
    return i18n.t(`events.${key}`, { ns: "agent", ...options });
}

export type AgentEventPayload = {
    agent?: string;
    type?: string;
    threadId?: string;
    thread_id?: string;
    turnId?: string;
    turn_id?: string;
    sourceClientId?: string;
    replayed?: boolean;
    item?: AgentEventItem;
    error?: { message?: string };
    message?: string;
    status?: string;
    explanation?: unknown;
    plan?: unknown;
    usage?: Record<string, unknown>;
    duration_ms?: number;
};
export type AgentEventItem = {
    id?: string;
    type?: string;
    text?: unknown;
    delta?: unknown;
    message?: unknown;
    server?: string;
    tool?: string;
    status?: string;
    arguments?: unknown;
    result?: unknown;
    error?: { message?: string };
    command?: unknown;
    cwd?: unknown;
    aggregatedOutput?: unknown;
    exitCode?: unknown;
    durationMs?: unknown;
    contentItems?: unknown;
    success?: unknown;
    changes?: unknown;
    summary?: unknown;
    query?: unknown;
    action?: unknown;
    path?: unknown;
    savedPath?: unknown;
    revisedPrompt?: unknown;
};
export type AgentUserDetail = { kind: string; status: string; rows?: Array<{ label: string; value: string }>; output?: string; files?: Array<{ path: string; action?: string }>; tasks?: Array<{ step: string; status: string }>; explanation?: string };

export type AgentLogContext = { endpoint: string; connected: boolean; enabled: boolean; activity: string; waiting: boolean; sending: boolean; messages: number; pendingTool?: string };

export function agentMessageToChatMessage(item: AgentChatItem) {
    return { ...item, meta: item.role === "user" || item.role === "assistant" ? undefined : item.meta, attachments: item.attachments?.map(agentAttachmentToChatAttachment) };
}

export function agentAttachmentToChatAttachment(item: AgentAttachment): AgentChatAttachment {
    return { id: item.id, name: item.name, url: item.dataUrl || item.url };
}

export function formatAgentEvent(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const item = event.item;
    if (event.type === "item.completed" && item?.type === "agent_message") return { role: "assistant", title: "Codex", text: stringText(item.text) };
    return null;
}

export function formatAgentActivity(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const item = event.item;
    if (!item || (event.type !== "item.started" && event.type !== "item.completed")) return null;
    const completed = event.type === "item.completed";
    const status = String(item.status || (completed ? "completed" : "inProgress"));
    const failed = Boolean(item.error?.message) || item.success === false || ["failed", "error"].includes(status);
    const itemStatus = failed ? "failed" : status;
    if (item.type === "reasoning") {
        const text = readableText(item.summary);
        if (completed && !text) return null;
        return { role: "tool", title: tr("reasoning"), text: text || activityPlaceholder(item.type), detail: { kind: "reasoning", status: itemStatus } };
    }
    if (item.type === "plan") {
        const text = stringText(item.text);
        if (completed && !text && !item.error?.message) return null;
        return { role: "tool", title: tr("plan"), text: item.error?.message || text || activityPlaceholder(item.type), detail: { kind: "plan", status: itemStatus, ...(item.error?.message ? { output: item.error.message } : {}) } };
    }
    if (item.type === "command_execution") {
        const command = stringText(item.command);
        const text = command || (completed ? tr(failed ? "commandFailed" : "commandCompleted") : activityPlaceholder(item.type));
        return { role: "tool", title: tr("command"), text, detail: commandActivityDetail(item, itemStatus) };
    }
    if (item.type === "file_change") {
        const files = activityFiles(item.changes);
        return { role: "tool", title: tr("editFiles"), text: item.error?.message || fileActivitySummary(files, completed), detail: { kind: "file", status: itemStatus, files, ...(item.error?.message ? { output: item.error.message } : {}) } };
    }
    if (item.type === "web_search") {
        return { role: "tool", title: tr("search"), text: item.error?.message || webSearchSummary(item), detail: { kind: "search", status: itemStatus, rows: webSearchDetailRows(item), ...(item.error?.message ? { output: item.error.message } : {}) } };
    }
    if (item.type === "image_view") return { role: "tool", title: tr("viewImage"), text: item.error?.message || stringText(item.path) || tr(completed ? "viewedImage" : "viewingImage"), detail: { kind: "image", status: itemStatus, ...(item.error?.message ? { output: item.error.message } : {}) } };
    if (item.type === "image_generation") {
        return { role: "tool", title: tr("imageGeneration"), text: item.error?.message || tr(completed ? failed ? "imageFailed" : "imageCompleted" : "generatingImage"), detail: { kind: "image", status: itemStatus, savedPath: item.savedPath, ...(item.error?.message ? { output: item.error.message } : {}) } };
    }
    if (item.type === "context_compaction") return { role: "tool", title: tr("compactContext"), text: item.error?.message || tr(completed ? "contextCompacted" : "compactingContext"), detail: { kind: "context", status: itemStatus, ...(item.error?.message ? { output: item.error.message } : {}) } };
    if (isMcpToolItem(item)) {
        const name = String(item.tool || "");
        return { role: "tool", title: toolName(name), text: completed ? item.error?.message || toolSummary(item) : tr("runningTool", { action: toolAction(name) }), detail: toolDetail(item, itemStatus) };
    }
    if (item.type === "dynamic_tool_call") {
        const name = String(item.tool || "");
        const title = toolName(name);
        return {
            role: "tool",
            title,
            text: completed ? item.error?.message || readableText(item.contentItems) : tr("runningTool", { action: toolAction(name) }),
            detail: toolDetail(item, itemStatus),
        };
    }
    if (item.type === "collab_tool_call") return { role: "tool", title: tr("collaboration"), text: item.error?.message || tr(completed ? failed ? "collaborationFailed" : "collaborationCompleted" : "collaborating"), detail: { kind: "tool", status: itemStatus, ...(item.error?.message ? { output: item.error.message } : {}) } };
    return null;
}

export function formatAgentPlan(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const tasks = planTasks(event.plan);
    if (!tasks.length) return null;
    const completed = tasks.filter((item) => item.status === "completed").length;
    return {
        role: "tool",
        title: tr("taskProgress"),
        text: tr("progress", { completed, total: tasks.length }),
        detail: { kind: "todo", status: completed === tasks.length ? "completed" : "inProgress", tasks, explanation: stringText(event.explanation) },
    };
}

function planTasks(value: unknown) {
    return (Array.isArray(value) ? value : []).flatMap((item) => {
        const step = stringText(objectField(item, "step")).trim();
        return step ? [{ step, status: stringText(objectField(item, "status")) || "pending" }] : [];
    });
}

export function turnPlanStatus(detail: unknown, turnStatus?: string) {
    const tasks = planTasks(objectField(detail, "tasks"));
    if (turnStatus === "failed") return "failed";
    if (turnStatus === "interrupted") return "interrupted";
    if (tasks.length && tasks.every((item) => item.status === "completed")) return "completed";
    return turnStatus === "completed" ? "finished" : "inProgress";
}

export function activityDeltaFallback(item: AgentEventItem, delta: string): AgentChatItem {
    if (item.type === "command_execution") return { id: item.id || randomId(), role: "tool", title: tr("command"), text: activityPlaceholder(item.type), detail: { kind: "command", status: "inProgress", output: delta } };
    return { id: item.id || randomId(), role: "tool", title: tr(item.type === "plan" ? "plan" : "reasoning"), text: delta, detail: { kind: activityKind(item.type), status: "inProgress" } };
}

export function activityPlaceholder(type?: string) {
    if (type === "plan") return tr("organizingPlan");
    if (type === "command_execution") return tr("runningCommand");
    return tr("analyzing");
}

export function activityKind(type?: string) {
    if (type === "command_execution") return "command";
    if (type === "plan") return "plan";
    return "reasoning";
}

export function activityDetail(value: unknown, kind: string, status: string): AgentUserDetail {
    const current = value && typeof value === "object" ? (value as Partial<AgentUserDetail>) : {};
    return { kind, status, rows: current.rows, output: current.output, files: current.files, tasks: current.tasks, explanation: current.explanation };
}

function commandActivityDetail(item: AgentEventItem, status: string): AgentUserDetail {
    const rows = [detailRow(tr("workingDirectory"), item.cwd), detailRow(tr("exitStatus"), item.exitCode), durationDetailRow(item.durationMs)].flatMap((row) => (row ? [row] : []));
    const commandStatus = typeof item.exitCode === "number" && item.exitCode !== 0 ? "failed" : status;
    return { kind: "command", status: commandStatus, rows, output: item.error?.message || stringText(item.aggregatedOutput) };
}

function activityFiles(value: unknown) {
    return (Array.isArray(value) ? value : []).flatMap((change) => {
        const path = stringText(objectField(change, "path"));
        return path ? [{ path, action: changeAction(objectField(change, "kind")) }] : [];
    });
}

function fileActivitySummary(files: Array<{ path: string; action?: string }>, completed: boolean) {
    if (!files.length) return tr(completed ? "filesCompleted" : "preparingFiles");
    if (files.length === 1) return tr(completed ? "oneFileCompleted" : "oneFileRunning", { action: files[0].action || tr("modified"), path: files[0].path });
    const names = files.slice(0, 3).map((file) => file.path).join("、");
    return tr(completed ? "filesCompletedMany" : "filesRunningMany", { count: files.length, names, more: files.length > 3 ? tr("more") : "" });
}

function webSearchSummary(item: AgentEventItem) {
    const action = item.action;
    const type = stringText(objectField(action, "type"));
    if (type === "openPage") return tr("openPage", { url: stringText(objectField(action, "url")) });
    if (type === "findInPage") return tr("findPage", { pattern: stringText(objectField(action, "pattern")) || tr("content") });
    return tr("searchFor", { query: stringText(item.query) || stringText(objectField(action, "query")) || tr("related") });
}

function webSearchDetailRows(item: AgentEventItem) {
    const action = item.action;
    return [detailRow(tr("keyword"), item.query || objectField(action, "query")), detailRow(tr("webpage"), objectField(action, "url"))].flatMap((row) => (row ? [row] : []));
}

function readableText(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map(readableText).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    return readableText(objectField(value, "text"));
}

function detailRow(label: string, value: unknown) {
    return value === undefined || value === null || value === "" ? null : { label, value: String(value) };
}

function durationDetailRow(value: unknown) {
    const duration = Number(value || 0);
    return duration > 0 ? { label: tr("duration"), value: tr("seconds", { value: (duration / 1000).toFixed(1) }) } : null;
}

function changeAction(value: unknown) {
    if (value === "add") return tr("added");
    if (value === "delete") return tr("deleted");
    return tr("modified");
}

export function parseEventData<T>(event: Event) {
    try {
        return JSON.parse((event as MessageEvent).data) as T;
    } catch {
        return null;
    }
}

export function isCurrentThreadEvent(event: { threadId?: string; thread_id?: string }) {
    const threadId = event.threadId || event.thread_id || "";
    return Boolean(threadId) && threadId === useAgentStore.getState().activeThreadId;
}

export function registerLiveAgentTurn(
    event: { replayed?: boolean; threadId?: string; thread_id?: string; turnId?: string; turn_id?: string },
    authoritativeTurns: ReadonlySet<string>,
    liveTurns: Set<string>,
) {
    const threadId = event.threadId || event.thread_id || "";
    const turnId = event.turnId || event.turn_id || "";
    const key = threadId && turnId ? `${threadId}\0${turnId}` : "";
    if (event.replayed && key && authoritativeTurns.has(key)) return false;
    if (key) liveTurns.add(key);
    return true;
}

export function formatLogText(logs: AgentEventLog[], context: AgentLogContext) {
    const head = [
        tr("diagnosis"),
        tr("address", { endpoint: context.endpoint }),
        tr("connection", { connection: i18n.t(context.connected ? "log.online" : context.enabled ? "log.connecting" : "log.disabled", { ns: "agent" }), status: context.activity }),
        tr("messageTool", { messages: context.messages, tool: context.pendingTool ? toolName(context.pendingTool) : tr("none") }),
    ].join("\n");
    const body = logs.map((item) => `${item.time} ${item.title}${item.text && item.text !== item.title ? ` · ${item.text}` : ""}`).join("\n");
    return [head, body || i18n.t("log.noEvents", { ns: "agent" })].join("\n\n");
}

export function formatLogJson(logs: AgentEventLog[], context: AgentLogContext) {
    return JSON.stringify({ context, logs: logs.map(({ time, title, text, raw }) => ({ time, title, text, raw })) }, null, 2);
}

export function formatAgentEventLog(event: AgentEventPayload) {
    const item = event.item;
    if (event.type === "thread.started") return { title: tr("createThread"), text: shortId(event.thread_id) };
    if (event.type === "turn.started") return { title: tr("startTurn"), text: shortId(event.turn_id) };
    if (event.type === "plan.updated") {
        const tasks = planTasks(event.plan);
        return { title: tr("updateProgress"), text: tr("progress", { completed: tasks.filter((item) => item.status === "completed").length, total: tasks.length }) };
    }
    if (event.type === "turn.completed" && event.status === "failed") return { title: tr("processFailed"), text: agentErrorView(event.error?.message).text };
    if (event.type === "turn.completed") return { title: tr(event.status === "interrupted" ? "processStopped" : "processCompleted"), text: turnSummary(event) };
    if (event.type === "turn.failed" || event.type === "error") return { title: tr("processFailed"), text: agentErrorView(event.message || event.error?.message).text };
    if (event.type === "item.started" && isMcpToolItem(item)) return { title: tr("callTool"), text: toolName(String(item?.tool || "")) };
    if (event.type === "item.completed" && isMcpToolItem(item)) return { title: tr(item.error ? "toolFailed" : "toolCompleted"), text: `${toolName(String(item?.tool || ""))}${item.error?.message ? ` · ${item.error.message}` : ""}` };
    if (event.type === "item.completed" && item?.type === "agent_message") return { title: tr("responseReceived"), text: compactText(stringText(item.text)) };
    return null;
}

function turnSummary(event: AgentEventPayload) {
    return event.duration_ms ? tr("seconds", { value: (event.duration_ms / 1000).toFixed(1) }) : tr("completed");
}

export function agentErrorView(value: unknown) {
    const text = normalizeText(value);
    if (/selected model is at capacity/i.test(text)) return { title: tr("modelBusy"), text: tr("modelBusyText") };
    return { title: tr("taskFailed"), text: text || tr("taskFailedText") };
}

export function eventUsage(event: AgentEventPayload): AgentTokenUsage {
    return {
        input: numberField(event.usage, "input_tokens"),
        cached: numberField(event.usage, "cached_input_tokens"),
        output: numberField(event.usage, "output_tokens"),
    };
}

function shortId(value?: string) {
    return value ? value.slice(0, 8) : "";
}

export function compactText(value: string, maxLength = 120) {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function isConnectionErrorMessage(item: AgentChatItem) {
    return item.role === "error" && /连接失败|无法连接本地 Agent|本地 Agent 连接失败/.test(item.text);
}

export function toolName(name: string) {
    if (name === "imagegen" || name.endsWith("__imagegen")) return tr("imagegen");
    if (name === "view_image" || name.endsWith("__view_image")) return tr("viewImage");
    if (name === "exec" || name === "exec_command" || name.endsWith("__exec_command")) return tr("exec");
    if (name === "apply_patch" || name.endsWith("__apply_patch")) return tr("editFile");
    if (name === "web__run" || name.endsWith("__web__run")) return tr("search");
    const canvasTools: Record<string, string> = {
        canvas_apply_ops: "canvasOps", canvas_get_state: "readCanvas", canvas_get_selection: "readSelection", canvas_export_snapshot: "exportSnapshot", canvas_create_node: "createNode", canvas_create_attachment_nodes: "addAttachments", canvas_create_text_node: "createText", canvas_create_text_nodes: "createTexts", canvas_create_config_node: "createConfig", canvas_create_image_prompt_flow: "createImageFlow", canvas_create_generation_flow: "createFlow", canvas_generate_text: "generateText", canvas_generate_image: "imagegen", canvas_generate_video: "generateVideo", canvas_generate_audio: "generateAudio", canvas_update_node: "updateNode", canvas_update_node_text: "updateText", canvas_move_nodes: "moveNodes", canvas_resize_node: "resizeNode", canvas_delete_nodes: "deleteNodes", canvas_connect_nodes: "connectNodes", canvas_select_nodes: "selectNodes", canvas_set_viewport: "setViewport", canvas_run_generation: "runGeneration", site_navigate: "openSitePage",
    };
    if (canvasTools[name]) return tr(canvasTools[name]);
    const siteTools: Record<string, string> = { canvas_list_projects: "canvasList", generation_get_status: "generationStatus", workbench_image_get_config: "imageConfig", workbench_image_generate: "imageWorkbenchGenerate", workbench_video_get_config: "videoConfig", workbench_video_generate: "videoWorkbenchGenerate", prompts_search: "searchPrompts", assets_list: "assetList", assets_add: "addAsset" };
    if (isSiteTool(name)) return tr(siteTools[name]);
    return name ? tr("toolCall", { name }) : tr("toolOperation");
}

function siteToolSummary(name: string, result: unknown, input: unknown) {
    const data = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    if (name === "site_navigate") return tr("opened", { page: routeName(stringText(objectField(input, "path")) || "/") });
    if (name === "canvas_list_projects") return tr("canvasTotal", { count: numberField(data, "total") });
    if (name === "prompts_search") return tr("promptsFound", { count: numberField(data, "total") });
    if (name === "assets_list") return tr("assetsTotal", { count: numberField(data, "total") });
    if (name === "assets_add") return tr("assetAdded");
    if (name === "generation_get_status") {
        const summary = data.summary && typeof data.summary === "object" ? (data.summary as Record<string, unknown>) : {};
        return tr("taskStatus", { total: numberField(data, "total"), queued: numberField(summary, "queued"), running: numberField(summary, "running"), succeeded: numberField(summary, "succeeded"), failed: numberField(summary, "failed") });
    }
    if (name === "workbench_image_generate" || name === "workbench_video_generate") return typeof data.note === "string" ? data.note : tr("workbenchExecuted");
    if (name === "workbench_image_get_config" || name === "workbench_video_get_config") return tr("workbenchConfigRead");
    return "";
}

function isMcpToolItem(item?: AgentEventItem): item is AgentEventItem & { type: "mcp_tool_call" } {
    return item?.type === "mcp_tool_call";
}

export function toolDetail(item: AgentEventItem | undefined, status: string): AgentUserDetail {
    const name = String(item?.tool || "");
    return { kind: "tool", status, rows: toolInputRows(name, item?.arguments), ...(item?.error?.message ? { output: item.error.message } : {}) };
}

export function toolCallDetail(name: string, input: unknown, status: string, error = ""): AgentUserDetail {
    return { kind: "tool", status, rows: toolInputRows(name, input), ...(error ? { output: error } : {}) };
}

function toolInputRows(name: string, input: unknown) {
    input = parseToolArguments(input);
    if (name === "site_navigate") return [detailRow(tr("targetPage"), routeName(stringText(objectField(input, "path")) || "/"))].flatMap((row) => (row ? [row] : []));
    if (name === "prompts_search") return [detailRow(tr("searchContent"), objectField(input, "query"))].flatMap((row) => (row ? [row] : []));
    if (name === "canvas_create_text_node") return [detailRow(tr("textContent"), objectField(input, "text"))].flatMap((row) => (row ? [row] : []));
    if (name === "canvas_apply_ops") return [detailRow(tr("operationContent"), summarizeCanvasAgentOps((objectField(input, "ops") as CanvasAgentOp[] | undefined) || []))].flatMap((row) => (row ? [row] : []));
    if (name === "canvas_create_attachment_nodes") return [detailRow(tr("imageCount"), Array.isArray(objectField(input, "attachmentIds")) ? (objectField(input, "attachmentIds") as unknown[]).length : 0)].flatMap((row) => (row ? [row] : []));
    return [];
}

export function toolSummary(item?: AgentEventItem) {
    const result = parseToolResult(item?.result);
    const name = String(item?.tool || "");
    if (name === "site_navigate" || isSiteTool(name)) return siteToolSummary(name, result, parseToolArguments(item?.arguments));
    const nodeField = objectField(result, "nodes");
    const connectionField = objectField(result, "connections");
    const nodes = Array.isArray(nodeField) ? nodeField : [];
    const connections = Array.isArray(connectionField) ? connectionField : [];
    if (name === "canvas_get_state") return Array.isArray(nodeField) || Array.isArray(connectionField) ? canvasContentSummary(nodes, connections.length) : tr("canvasRead");
    if (name === "canvas_get_selection") return tr("selectionRead");
    return "";
}

function canvasContentSummary(nodes: unknown[], connections: number) {
    const counts = nodes.reduce<Record<string, number>>((result, node) => {
        const type = stringText(objectField(node, "type")) || "other";
        result[type] = (result[type] || 0) + 1;
        return result;
    }, {});
    const known = new Set(["text", "image", "config", "video", "audio", "group"]);
    const other = Object.entries(counts).reduce((total, [type, count]) => total + (known.has(type) ? 0 : count), 0);
    const parts = [
        counts.text ? tr("textNodes", { count: counts.text }) : "",
        counts.image ? tr("imageNodes", { count: counts.image }) : "",
        counts.config ? tr("configNodes", { count: counts.config }) : "",
        counts.video ? tr("videoNodes", { count: counts.video }) : "",
        counts.audio ? tr("audioNodes", { count: counts.audio }) : "",
        counts.group ? tr("groups", { count: counts.group }) : "",
        other ? tr("otherNodes", { count: other }) : "",
        connections ? tr("connections", { count: connections }) : "",
    ].filter(Boolean);
    return parts.length ? parts.join("、") : tr("emptyCanvas");
}

export function toolAction(name: string) {
    const label = toolName(name);
    if (name === "view_image" || name.endsWith("__view_image") || name === "web__run" || name.endsWith("__web__run") || ["canvas_get_state", "canvas_get_selection", "site_navigate", "prompts_search", "canvas_list_projects", "assets_list"].includes(name)) return label;
    return tr("executing", { label });
}

export function routeName(path: string) {
    if (path === "/") return tr("home");
    if (path === "/canvas") return tr("canvasPage");
    if (path.startsWith("/canvas/")) return tr("specificCanvas");
    if (path.startsWith("/image")) return tr("imageWorkbench");
    if (path.startsWith("/video")) return tr("videoWorkbench");
    if (path.startsWith("/prompts")) return tr("promptCenter");
    if (path.startsWith("/assets")) return tr("assets");
    if (path.startsWith("/config")) return tr("configPage");
    return path;
}

export function workingActivity(item?: AgentChatItem) {
    const status = String(objectField(item?.detail, "status") || "");
    const output = stringText(objectField(item?.detail, "output"));
    const key = `${item?.id || "waiting"}-${status}-${item?.text || ""}-${output.length}`;
    if (item?.role !== "tool") return { key, text: tr("thinking") };
    if (["inProgress", "in_progress", "running", "pending"].includes(status)) return { key, text: tr("toolRunning", { title: item.title || tr("toolOperation") }) };
    if (item.title === tr("readCanvas") || item.title === "读取画布") return { key, text: tr("canvasOrganizing") };
    return { key, text: tr("toolContinuing", { title: item.title || tr("toolOperation") }) };
}

export function currentPlanMessage(messages: AgentChatItem[]) {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (isPlanMessage(message)) return message;
        if (message.role === "user") return;
    }
}

export function latestPlanMessage(messages: AgentChatItem[]) {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (isPlanMessage(messages[index])) return messages[index];
    }
}

export function isPlanMessage(message: AgentChatItem) {
    return message.role === "tool" && objectField(message.detail, "kind") === "todo";
}

function parseToolResult(result: unknown) {
    const content = objectField(result, "content");
    const text = Array.isArray(content)
        ? content
              .map((item) => objectField(item, "text"))
              .filter((item): item is string => typeof item === "string")
              .join("\n")
        : "";
    try {
        return text ? JSON.parse(text) : result;
    } catch {
        return text || result;
    }
}

export function normalizeText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return JSON.stringify(value, null, 2);
}

export function stringText(value: unknown) {
    return typeof value === "string" ? value : "";
}

export function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function numberField(value: unknown, key: string) {
    const field = objectField(value, key);
    return typeof field === "number" ? field : 0;
}

export function promptWithAttachments(text: string, attachments: AgentAttachment[]) {
    return text || (attachments.length ? tr("attachmentPrompt") : "");
}

export function attachmentPayloadBytes(attachments: AgentAttachment[]) {
    return attachments.reduce((total, item) => total + item.dataUrl.length, 0);
}

export function formatBytes(bytes: number) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
}

export function isCanvasWriteTool(name: string) {
    return name === "canvas_apply_ops" || name === "canvas_create_attachment_nodes";
}

function parseToolArguments(value: unknown) {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return {};
    }
}

export function agentMessageId(threadId: string, turnId: string, itemId: string) {
    return `${threadId}:${turnId}:${itemId}`;
}

export function scopeChatItem(item: AgentChatItem, threadId: string, turnId: string) {
    const scopeTurnId = turnId || "pending";
    const prefix = `${threadId || "local"}:${scopeTurnId}:`;
    const sourceItemId = item.itemId || (item.id.startsWith(prefix) ? item.id.slice(prefix.length) : item.id);
    const itemId = item.role === "user" ? "synthetic:user" : sourceItemId;
    return { ...item, id: agentMessageId(threadId || "local", scopeTurnId, itemId), itemId, threadId, turnId };
}

export function bindPendingTurnMessages(messages: AgentChatItem[], threadId: string, turnId: string) {
    const index = messages.findLastIndex((item) => item.role === "user" && item.threadId === threadId && !item.turnId);
    if (index < 0) return messages;
    return messages.map((item, itemIndex) => itemIndex === index ? scopeChatItem(item, threadId, turnId) : item);
}

export function upsertAgentMessage(messages: AgentChatItem[], item: AgentChatItem) {
    const index = messages.findIndex((current) => current.id === item.id);
    if (index < 0) return [...messages, item];
    const current = messages[index];
    const next = { ...current, ...item, attachments: item.attachments || current.attachments, historyText: item.historyText || current.historyText };
    return messages.map((message, itemIndex) => itemIndex === index ? next : message);
}

export function mergeAgentMessages(snapshot: AgentChatItem[], current: AgentChatItem[], threadId: string, liveTurnKeys: ReadonlySet<string>) {
    let messages = [...snapshot];
    current.filter((item) => item.threadId === threadId).forEach((item) => {
        const live = Boolean(item.turnId && liveTurnKeys.has(`${threadId}\0${item.turnId}`));
        const index = messages.findIndex((message) => message.id === item.id);
        if (index < 0) {
            if (!item.turnId || live) messages = upsertAgentMessage(messages, item);
            return;
        }
        const history = messages[index];
        const next = live
            ? { ...history, ...item, attachments: item.attachments || history.attachments, historyText: item.historyText || history.historyText }
            : { ...history, attachments: item.attachments || history.attachments, historyText: item.historyText || history.historyText };
        messages = messages.map((message, itemIndex) => itemIndex === index ? next : message);
    });
    return messages;
}

export function normalizeHistoryMessages(messages: AgentChatItem[]) {
    return messages
        .filter((item) => (normalizeText(item.text) || item.role === "tool") && item.itemId && item.threadId && item.turnId)
        .map(({ streamId: _streamId, ...item }) => scopeChatItem({ ...item, text: normalizeText(item.text) } as AgentChatItem, item.threadId!, item.turnId!));
}

export function mergeHistoryAttachments(messages: AgentChatItem[], currentMessages: AgentChatItem[]) {
    const currentUsers = currentMessages.filter((item) => item.role === "user" && item.attachments?.length).reverse();
    return [...messages]
        .reverse()
        .map((item) => {
            if (item.role !== "user") return item;
            let index = item.clientMessageId
                ? currentUsers.findIndex((current) => current.clientMessageId === item.clientMessageId && current.threadId === item.threadId)
                : -1;
            if (index < 0 && item.turnId) index = currentUsers.findIndex((current) => current.turnId === item.turnId && current.threadId === item.threadId);
            if (index < 0) {
                const candidates = currentUsers
                    .map((current, candidateIndex) => ({ current, candidateIndex }))
                    .filter(({ current }) => current.threadId === item.threadId && (current.text === item.text || current.historyText === item.text));
                if (new Set(candidates.map(({ current }) => current.clientMessageId || current.id)).size === 1) index = candidates[0]?.candidateIndex ?? -1;
            }
            if (index < 0) return item;
            const current = currentUsers.splice(index, 1)[0];
            return { ...item, text: current.text, historyText: current.historyText, attachments: current.attachments };
        })
        .reverse();
}

export function reasoningActivityText(items: Record<string, string>, fallback = "") {
    const summaries = Object.values(items).map((item) => item.trim()).filter(isReasoningSummary);
    return summaries.join("\n\n") || fallback || tr("analyzing");
}

export function isReasoningSummary(value = "") {
    const text = value.trim();
    return Boolean(text && text !== REASONING_PLACEHOLDER && text !== tr("analyzing") && text !== "已完成分析" && text !== tr("analysisCompleted"));
}

export function mergeStreamText(prefix: string, incoming: string) {
    if (!prefix || incoming.startsWith(prefix)) return incoming || prefix;
    if (!incoming || prefix.startsWith(incoming)) return prefix;
    return incoming.length >= prefix.length ? incoming : prefix;
}
