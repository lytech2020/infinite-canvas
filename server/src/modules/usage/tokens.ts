import { getEncoding, getEncodingNameForModel, type TiktokenEncoding } from "js-tiktoken";

import { logger } from "../../logger.js";

/** 后台估算所用的 tokenizer 库版本，随记录一起保存，便于日后复核估算口径。 */
const TOKENIZER_LIB_VERSION = "js-tiktoken@1.0.21";
/** 模型未知时使用的兼容 tokenizer。 */
const FALLBACK_ENCODING: TiktokenEncoding = "o200k_base";

export type TokenCounts = { inputTokens: number; cachedTokens: number; outputTokens: number; reasoningTokens: number; totalTokens: number };

export type NormalizedUsage = {
    tokens: TokenCounts;
    /** provider：供应商真实用量；estimated：后台估算；none：本次调用没有 Token 用量 */
    source: "provider" | "estimated" | "none";
    estimationMethod?: string;
    tokenizerName?: string;
    tokenizerVersion?: string;
};

function toCount(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function detail(usage: Record<string, unknown>, key: string, field: string) {
    const nested = usage[key];
    return nested && typeof nested === "object" ? toCount((nested as Record<string, unknown>)[field]) : 0;
}

/**
 * 读取供应商返回的 Token 用量。
 * 同时兼容 Responses 接口的 `input_tokens` / `output_tokens` 和 Chat Completions 的 `prompt_tokens` / `completion_tokens`；
 * 供应商没有返回任何可用字段时返回 null，由调用方决定是否改用后台估算。
 */
export function normalizeProviderTokens(usage: Record<string, unknown> | undefined): TokenCounts | null {
    if (!usage) return null;
    const inputTokens = toCount(usage.input_tokens) || toCount(usage.prompt_tokens);
    const outputTokens = toCount(usage.output_tokens) || toCount(usage.completion_tokens);
    const cachedTokens = detail(usage, "input_tokens_details", "cached_tokens") || detail(usage, "prompt_tokens_details", "cached_tokens");
    const reasoningTokens = detail(usage, "output_tokens_details", "reasoning_tokens") || detail(usage, "completion_tokens_details", "reasoning_tokens");
    const totalTokens = toCount(usage.total_tokens) || inputTokens + outputTokens;
    if (!inputTokens && !outputTokens && !totalTokens) return null;
    return { inputTokens, cachedTokens, outputTokens, reasoningTokens, totalTokens };
}

/** 按模型选择 tokenizer；没有精确对应关系时退回兼容 tokenizer，绝不因此让估算失败。 */
function encodingFor(remoteName: string) {
    try {
        const name = getEncodingNameForModel(remoteName as Parameters<typeof getEncodingNameForModel>[0]);
        return { name, encoding: getEncoding(name) };
    } catch {
        return { name: FALLBACK_ENCODING, encoding: getEncoding(FALLBACK_ENCODING) };
    }
}

/**
 * 供应商未返回 Token 时由后台估算。
 * 估算值必须标记 `usage_source = estimated` 并保存估算方法和 tokenizer，不能伪装成供应商真实数据。
 * 估算只在后台进行，不接受前端上报的 Token。
 */
export function estimateTokens(remoteName: string, prompt: string, output: string): NormalizedUsage {
    try {
        const { name, encoding } = encodingFor(remoteName);
        const inputTokens = encoding.encode(prompt).length;
        const outputTokens = output ? encoding.encode(output).length : 0;
        return {
            tokens: { inputTokens, cachedTokens: 0, outputTokens, reasoningTokens: 0, totalTokens: inputTokens + outputTokens },
            source: "estimated",
            estimationMethod: "tokenizer_encode_prompt_and_output",
            tokenizerName: name,
            tokenizerVersion: TOKENIZER_LIB_VERSION,
        };
    } catch (error) {
        // 估算失败不能影响任务本身，退回按字符数粗算并如实记录方法。
        logger.warn("Token 估算失败，退回字符数粗算", { error: error instanceof Error ? error.message : String(error) });
        const inputTokens = Math.ceil(prompt.length / 4);
        const outputTokens = Math.ceil(output.length / 4);
        return {
            tokens: { inputTokens, cachedTokens: 0, outputTokens, reasoningTokens: 0, totalTokens: inputTokens + outputTokens },
            source: "estimated",
            estimationMethod: "character_count_div_4",
        };
    }
}

export const emptyTokens: TokenCounts = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };
