// 建筑日文关键词库:项目内只读静态数据,由 scripts/import-architecture-keywords.mjs 生成。
export type ArchitectureKeyword = {
    templateId: string;
    title: string;
    prompt: string;
    category: string;
    coverUrl: string;
    templateVersion: string;
};

export const ARCHITECTURE_KEYWORD_CATEGORIES = ["建築", "インテリア", "ランドスケープ", "都市計画", "総合"];

export async function fetchArchitectureKeywords(): Promise<ArchitectureKeyword[]> {
    const response = await fetch("/keywords/architecture-keywords.json", { cache: "force-cache" });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
}
