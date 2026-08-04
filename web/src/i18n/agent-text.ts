import i18n from "@/i18n";

const keys: Record<string, string> = {
    "需要重启 Agent": "runtime.restartRequired",
    "等待权限确认": "runtime.waitingPermission",
    "Codex 正在运行": "runtime.running",
    "已连接": "runtime.connected",
    "处理失败": "runtime.failed",
    "完成": "runtime.completed",
    "发送中": "runtime.sending",
    "发送失败": "runtime.sendFailed",
    "停止中": "runtime.stopping",
    "停止失败": "runtime.stopFailed",
    "离线": "runtime.offline",
    "连接中": "runtime.connecting",
    "连接断开": "runtime.disconnected",
    "连接失败": "runtime.connectionFailed",
    "正在新建对话": "runtime.newChat",
    "新对话": "runtime.chatCreated",
    "已恢复会话": "runtime.resumed",
    "正在提交权限决定": "runtime.submittingPermission",
    "等待 Codex 确认权限": "runtime.waitingCodexPermission",
    "正在初始化 Codex 对话": "runtime.preparing",
    "正在创建会话并启动画布工具服务": "runtime.preparingDetail",
    "Codex 对话初始化失败": "runtime.prepareFailed",
    "无法创建 Codex 会话": "runtime.createFailed",
    "正在建立工具连接并读取可用工具列表": "runtime.connectingTools",
    "工具列表加载完成，可以开始对话": "runtime.toolsReady",
    "工具服务未能完成初始化": "runtime.toolInitFailed",
    "工具服务初始化已取消": "runtime.toolInitCancelled",
    "部分 MCP 服务初始化失败": "runtime.partialMcpFailed",
    "可以查看下方服务状态和诊断日志": "runtime.diagnosticsHint",
    "正在启动 MCP 服务": "runtime.startingMcpServices",
    "本地 Agent 版本过旧，请重启 Canvas Agent 后重新连接": "local.agentOutdated",
    "本地 Agent 已连接": "local.connected",
    "本地 Agent 连接失败或已断开": "local.connectionLost",
    "连接失败，请检查地址和 token": "local.checkAddressToken",
    "图片过大": "local.imageTooLarge",
    "图片附件超过 30MB，请删减后再发送。": "local.imageTooLargeDetail",
    "图片附件最多约 30MB。": "local.imageLimit",
    "图片读取失败": "local.imageReadFailed",
    "默认模型": "local.defaultModel",
    "仅附件": "local.attachmentOnly",
    "启动对话失败": "local.startChatFailed",
    "任务仍在运行": "local.taskRunning",
    "仍有待确认的画布工具调用": "local.pendingCanvasTool",
    "工具执行失败": "local.toolFailed",
    "当前不在画布页，请先用 site_navigate 打开画布": "local.canvasUnavailable",
    "画布操作失败": "local.canvasFailed",
    "用户取消了画布工具调用": "local.toolCancelled",
    "审批请求已失效": "local.approvalExpired",
    "权限审批失败": "local.approvalFailed",
    "请填写本地 Agent 地址": "local.addressRequired",
    "没有发现本地 Agent，请先在 Codex 使用插件或手动启动 Canvas Agent": "local.agentNotFound",
    "本地 Agent 地址格式不正确": "local.invalidAddress",
    "新建对话失败": "local.newChatFailed",
    "恢复对话失败": "local.resumeFailed",
    "没有可添加的图片附件": "local.noImages",
    "图片附件节点参数无效": "local.invalidImageNode",
    "读取图片附件失败": "local.readAttachmentFailed",
    "参考图": "local.referenceImage",
    "读取 Codex 生成图片失败": "local.readGeneratedFailed",
    "读取图片失败": "local.readImageFailed",
    "导入生成图片": "local.importedImage",
    "已添加到发起任务的画布": "local.addedToCanvas",
    "图片已生成": "local.imageGenerated",
    "读取历史失败": "local.readHistoryFailed",
    "同步会话失败": "local.syncSessionFailed",
    "Agent 版本不匹配": "local.versionMismatch",
    "已批准权限": "local.permissionApproved",
    "已取消权限": "local.permissionCancelled",
    "读取模型列表失败": "local.modelListFailed",
    "发送任务": "local.sendTask",
    "发送失败": "local.sendFailed",
    "停止任务": "local.stopTask",
    "已发送停止请求": "local.stopRequested",
    "等待确认": "local.waitingConfirmation",
    "删除对话失败": "local.deleteChatFailed",
    "思考摘要": "local.reasoningSummary",
};

export function localizeAgentText(value: string) {
    const key = keys[value];
    if (key) return i18n.t(key, { ns: "agent" });
    const serviceCount = value.match(/^(\d+) 个 MCP 服务已就绪$/);
    if (serviceCount) return i18n.t("runtime.mcpServicesReady", { ns: "agent", count: Number(serviceCount[1]) });
    const initializingCount = value.match(/^正在初始化 (\d+) 个工具服务$/);
    if (initializingCount) return i18n.t("runtime.initializingServices", { ns: "agent", count: Number(initializingCount[1]) });
    const sentImages = value.match(/^发送了 (\d+) 张图片$/);
    if (sentImages) return i18n.t("local.sentImages", { ns: "agent", count: Number(sentImages[1]) });
    const attachments = value.match(/^附件 (\d+)$/);
    if (attachments) return i18n.t("local.attachments", { ns: "agent", count: Number(attachments[1]) });
    const generatedImage = value.match(/^生成图片 (\d+)$/);
    if (generatedImage) return i18n.t("local.generatedImage", { ns: "agent", count: Number(generatedImage[1]) });
    const mcp = value.match(/^(正在启动 MCP|MCP 已就绪|MCP 启动失败|MCP 启动已取消)：(.+)$/);
    if (mcp) {
        const mcpKeys: Record<string, string> = { "正在启动 MCP": "runtime.startingMcp", "MCP 已就绪": "runtime.mcpReady", "MCP 启动失败": "runtime.mcpFailed", "MCP 启动已取消": "runtime.mcpCancelled" };
        return i18n.t(mcpKeys[mcp[1]], { ns: "agent", name: mcp[2] });
    }
    return value;
}
