import { Prisma, type ModelPrice } from "@prisma/client";

import { prisma } from "../../db.js";
import type { TokenCounts } from "./tokens.js";

/** 非 Token 计费单位，由各能力的执行结果归纳得出。 */
export type MediaUnits = {
    images?: number;
    imageSize?: string;
    imageQuality?: string;
    videos?: number;
    videoSeconds?: number;
    videoResolution?: string;
    audioSeconds?: number;
    audioCharacters?: number;
};

/** 金额计算过程的一行：单价、数量和小计，管理员据此追溯金额来源。 */
export type CalculationLine = { item: string; unit: string; quantity: string; unitPrice: string; amount: string };

export type Settlement = { amountUsd: Prisma.Decimal; lines: CalculationLine[] };

const ZERO = new Prisma.Decimal(0);
const MILLION = new Prisma.Decimal(1_000_000);

type UnitPrices = Record<string, unknown>;

function price(unitPrices: UnitPrices, key: string) {
    const value = unitPrices[key];
    return typeof value === "string" && value.trim() ? new Prisma.Decimal(value) : null;
}

/** 按尺寸、质量等维度区分的单价表，形如 { "1024x1024:high": "0.167" }；缺省时退回统一单价。 */
function variantPrice(unitPrices: UnitPrices, key: string, variants: string[]) {
    const table = unitPrices[key];
    if (table && typeof table === "object") {
        for (const variant of variants) {
            const value = (table as Record<string, unknown>)[variant];
            if (typeof value === "string" && value.trim()) return new Prisma.Decimal(value);
        }
    }
    return null;
}

function line(lines: CalculationLine[], item: string, unit: string, quantity: Prisma.Decimal, unitPrice: Prisma.Decimal, amount: Prisma.Decimal) {
    if (quantity.isZero() || unitPrice.isZero()) return;
    lines.push({ item, unit, quantity: quantity.toString(), unitPrice: unitPrice.toString(), amount: amount.toString() });
}

/**
 * 按每百万 Token 结算。
 * 缓存 Token 是输入 Token 的一部分，配置了缓存单价时按「输入 - 缓存」走输入价、缓存部分走缓存价；
 * 推理 Token 同理属于输出 Token 的一部分。未配置对应单价时，这部分并入原价格，不会漏算也不会重复计费。
 */
function settleTokens(unitPrices: UnitPrices, tokens: TokenCounts, lines: CalculationLine[]) {
    let amount = ZERO;
    const cachedPrice = price(unitPrices, "cachedPerMillionTokens");
    const reasoningPrice = price(unitPrices, "reasoningPerMillionTokens");
    const cached = cachedPrice ? Math.min(tokens.cachedTokens, tokens.inputTokens) : 0;
    const reasoning = reasoningPrice ? Math.min(tokens.reasoningTokens, tokens.outputTokens) : 0;

    const parts: Array<[string, number, Prisma.Decimal | null]> = [
        ["输入 Token", tokens.inputTokens - cached, price(unitPrices, "inputPerMillionTokens")],
        ["缓存 Token", cached, cachedPrice],
        ["输出 Token", tokens.outputTokens - reasoning, price(unitPrices, "outputPerMillionTokens")],
        ["推理 Token", reasoning, reasoningPrice],
    ];
    for (const [item, quantity, unitPrice] of parts) {
        if (!unitPrice || quantity <= 0) continue;
        const subtotal = new Prisma.Decimal(quantity).div(MILLION).mul(unitPrice);
        amount = amount.add(subtotal);
        line(lines, item, "每百万 Token", new Prisma.Decimal(quantity), unitPrice, subtotal);
    }
    return amount;
}

/** 按张数结算图片，支持按「尺寸:质量」或「尺寸」区分单价。 */
function settleImages(unitPrices: UnitPrices, media: MediaUnits, lines: CalculationLine[]) {
    const count = media.images ?? 0;
    if (count <= 0) return ZERO;
    const variants = [`${media.imageSize}:${media.imageQuality}`, `${media.imageSize}`];
    const unitPrice = variantPrice(unitPrices, "perImageByVariant", variants) ?? price(unitPrices, "perImage");
    if (!unitPrice) return ZERO;
    const amount = new Prisma.Decimal(count).mul(unitPrice);
    line(lines, `图片 ${media.imageSize ?? "默认尺寸"}`, "每张", new Prisma.Decimal(count), unitPrice, amount);
    return amount;
}

/** 视频可以按个数计价，也可以按秒计价，两者都配置时相加。 */
function settleVideos(unitPrices: UnitPrices, media: MediaUnits, lines: CalculationLine[]) {
    let amount = ZERO;
    const perVideo = price(unitPrices, "perVideo");
    if (perVideo && media.videos) {
        const subtotal = new Prisma.Decimal(media.videos).mul(perVideo);
        amount = amount.add(subtotal);
        line(lines, "视频", "每个", new Prisma.Decimal(media.videos), perVideo, subtotal);
    }
    const perSecond = variantPrice(unitPrices, "perVideoSecondByResolution", [`${media.videoResolution}`]) ?? price(unitPrices, "perVideoSecond");
    if (perSecond && media.videoSeconds) {
        const subtotal = new Prisma.Decimal(media.videoSeconds).mul(perSecond);
        amount = amount.add(subtotal);
        line(lines, `视频时长 ${media.videoResolution ?? ""}`.trim(), "每秒", new Prisma.Decimal(media.videoSeconds), perSecond, subtotal);
    }
    return amount;
}

/** 音频按分钟或按百万字符计价。 */
function settleAudio(unitPrices: UnitPrices, media: MediaUnits, lines: CalculationLine[]) {
    let amount = ZERO;
    const perMinute = price(unitPrices, "perAudioMinute");
    if (perMinute && media.audioSeconds) {
        const minutes = new Prisma.Decimal(media.audioSeconds).div(60);
        const subtotal = minutes.mul(perMinute);
        amount = amount.add(subtotal);
        line(lines, "音频时长", "每分钟", minutes, perMinute, subtotal);
    }
    const perMillionCharacters = price(unitPrices, "perMillionCharacters");
    if (perMillionCharacters && media.audioCharacters) {
        const subtotal = new Prisma.Decimal(media.audioCharacters).div(MILLION).mul(perMillionCharacters);
        amount = amount.add(subtotal);
        line(lines, "音频字符", "每百万字符", new Prisma.Decimal(media.audioCharacters), perMillionCharacters, subtotal);
    }
    return amount;
}

/** 取任务发生时点生效的价格规则；同一时点存在多条时取最近一次生效的。 */
export function resolvePrice(modelId: string, at: Date) {
    return prisma.modelPrice.findFirst({
        where: { modelId, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
        orderBy: { effectiveFrom: "desc" },
    });
}

/**
 * 按价格规则和实际用量计算金额。
 * 全程使用高精度小数，不用浮点数累计；`perCall` 作为附加的固定每次调用费用，可与任意计费方式叠加。
 */
export function settle(rule: ModelPrice, tokens: TokenCounts, media: MediaUnits): Settlement {
    const unitPrices = (rule.unitPrices || {}) as UnitPrices;
    const lines: CalculationLine[] = [];
    let amount = ZERO;
    if (rule.pricingType === "token") amount = amount.add(settleTokens(unitPrices, tokens, lines));
    if (rule.pricingType === "image") amount = amount.add(settleImages(unitPrices, media, lines));
    if (rule.pricingType === "video") amount = amount.add(settleVideos(unitPrices, media, lines));
    if (rule.pricingType === "audio") amount = amount.add(settleAudio(unitPrices, media, lines));

    const perCall = price(unitPrices, "perCall");
    if (perCall) {
        amount = amount.add(perCall);
        line(lines, "固定调用费", "每次", new Prisma.Decimal(1), perCall, perCall);
    }
    return { amountUsd: amount, lines };
}
