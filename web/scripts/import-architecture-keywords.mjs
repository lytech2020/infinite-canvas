// 从建筑模板索引导入日文关键词库(只读源,不修改源文件)。
// 用法: node scripts/import-architecture-keywords.mjs [源 JSON 路径]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = process.argv[2] || "/Users/nanzhou/Desktop/建筑学长模板索引/仅建筑相关/architecture-only-local.json";
const sourceDir = dirname(sourcePath);
const dataPath = resolve(webRoot, "public/keywords/architecture-keywords.json");
const coverDir = resolve(webRoot, "public/keywords/covers");

const CATEGORY_MAP = { 建筑: "建築", 室内: "インテリア", 景观: "ランドスケープ", 规划: "都市計画", 综合: "総合" };

const templates = JSON.parse(readFileSync(sourcePath, "utf8")).templates;
const failures = [];
const records = [];

for (const item of templates) {
    if (item.baseImageUrls?.length !== 0) continue;
    const title = (item.titleJa || "").trim();
    const prompt = (item.promptJa || "").trim();
    const category = CATEGORY_MAP[item.domain];
    if (!title || !prompt) {
        failures.push({ templateId: item.templateId, reason: !title ? "titleJa 为空" : "promptJa 为空" });
        continue;
    }
    if (!category) {
        failures.push({ templateId: item.templateId, reason: `未知分类 ${item.domain}` });
        continue;
    }
    if (!item.coverUrl) {
        failures.push({ templateId: item.templateId, reason: "coverUrl 为空" });
        continue;
    }
    records.push({ templateId: item.templateId, title, prompt, category, coverUrl: `/keywords/covers/${item.templateId}.jpg`, templateVersion: item.templateVersion, sourceCover: item.coverUrl });
}

// 封面压缩成宽 480px JPEG,避免把 1.5GB 原图放进仓库。
mkdirSync(coverDir, { recursive: true });
let coverCreated = 0;
for (const record of records) {
    const target = resolve(coverDir, `${record.templateId}.jpg`);
    if (existsSync(target)) continue;
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "68", "-Z", "480", resolve(sourceDir, record.sourceCover), "--out", target], { stdio: "ignore" });
    coverCreated += 1;
}

const existing = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, "utf8")) : [];
const byId = new Map(existing.map((item) => [item.templateId, item]));
let created = 0;
let updated = 0;
let skipped = 0;
for (const { sourceCover, ...record } of records) {
    const previous = byId.get(record.templateId);
    if (!previous) created += 1;
    else if (JSON.stringify(previous) === JSON.stringify(record)) skipped += 1;
    else updated += 1;
    byId.set(record.templateId, record);
}

const output = [...byId.values()];
mkdirSync(dirname(dataPath), { recursive: true });
writeFileSync(dataPath, `${JSON.stringify(output, null, 2)}\n`);

const counts = {};
for (const item of output) counts[item.category] = (counts[item.category] || 0) + 1;
console.log({ source: templates.length, matched: records.length, created, updated, skipped, failed: failures.length, counts, coverCreated, total: output.length });
if (failures.length) console.log(failures);
