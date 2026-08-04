export default {
    productName: "无限画布",
    browserTitle: "无限画布",
    actions: {
        edit: "编辑",
        done: "完成",
        cancel: "取消",
        save: "保存",
        delete: "删除",
        copy: "复制",
        details: "详情",
        addAsset: "加入资产",
    },
    capabilities: {
        image: "生图",
        video: "视频",
        text: "文本",
        audio: "音频",
    },
    agent: {
        open: "打开 Agent",
        close: "收起 Agent",
    },
    userActions: {
        plugins: "节点插件",
        docs: "文档",
        config: "配置",
        shortcuts: "快捷键",
        lightTheme: "切换到浅色主题",
        darkTheme: "切换到深色主题",
    },
    duration: { minutesSeconds: "{{minutes}}分{{seconds}}秒", seconds: "{{seconds}}秒" },
} as const;
