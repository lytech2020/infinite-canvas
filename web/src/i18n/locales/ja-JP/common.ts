export default {
    productName: "Infinite Canvas",
    browserTitle: "キャンバス",
    actions: {
        edit: "編集",
        done: "完了",
        cancel: "キャンセル",
        save: "保存",
        delete: "削除",
        copy: "コピー",
        details: "詳細",
        addAsset: "アセットに追加",
    },
    capabilities: {
        image: "画像",
        video: "動画",
        text: "テキスト",
        audio: "音声",
    },
    agent: {
        open: "Agentを開く",
        close: "Agentを閉じる",
    },
    userActions: {
        plugins: "ノードプラグイン",
        docs: "ドキュメント",
        config: "設定",
        language: "言語を切り替える",
        shortcuts: "ショートカット",
        lightTheme: "ライトテーマに切り替える",
        darkTheme: "ダークテーマに切り替える",
    },
    duration: { minutesSeconds: "{{minutes}}分{{seconds}}秒", seconds: "{{seconds}}秒" },
} as const;
