import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

import { prisma } from "../../db.js";
import { ApiError, ok, param, route } from "../response.js";
import { removeUploadReferences, syncUploadReferences } from "../../modules/storage/upload-references.js";
import { logger } from "../../logger.js";

const keySchema = z.string().trim().min(1).max(1024).regex(/^[a-zA-Z0-9_-]+$/);
const valueBody = z.object({ value: z.unknown().refine((value) => value !== undefined) });
const collectionItemBody = z.object({ id: z.string().trim().min(1).max(256), value: z.unknown().refine((value) => value !== undefined) });
const collectionItemId = z.string().trim().min(1).max(256);

export const userDataRouter = Router();
const MAX_ITEM_BYTES = 4 * 1024 * 1024;
const MAX_ROWS_PER_USER = 10_000;
const MAX_BYTES_PER_USER = 200 * 1024 * 1024;
const MAX_COLLECTION_ITEMS = 2000;
const writeLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 240,
    keyGenerator: (req) => req.user!.id,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "云端数据写入过于频繁，请稍后再试" } }),
});
const deleteLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 1200,
    keyGenerator: (req) => req.user!.id,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "云端数据删除过于频繁，请稍后再试" } }),
});

function encodeDataKey(value: string) {
    return Buffer.from(value).toString("base64url");
}

function collectionKeys(encodedBase: string, id?: string) {
    const base = Buffer.from(keySchema.parse(encodedBase), "base64url").toString("utf8");
    if (!base || encodeDataKey(base) !== encodedBase) throw new ApiError("VALIDATION_FAILED", "集合标识不合法");
    return { indexKey: encodeDataKey(`${base}:index`), itemKey: id ? encodeDataKey(`${base}:item:${id}`) : "", itemKeyFor: (itemId: string) => encodeDataKey(`${base}:item:${itemId}`) };
}

function collectionIds(value: unknown, userId: string, indexKey: string) {
    if (value === null || value === undefined) return [];
    const parsed = z.array(collectionItemId).max(MAX_COLLECTION_ITEMS).safeParse(value);
    if (parsed.success) return parsed.data;
    logger.warn("用户云端集合索引损坏", { userId, indexKey });
    return [];
}

userDataRouter.get(
    "/collections/:key",
    route(async (req, res) => {
        const { indexKey, itemKeyFor } = collectionKeys(param(req, "key"));
        const index = await prisma.userData.findUnique({ where: { userId_key: { userId: req.user!.id, key: indexKey } }, select: { value: true } });
        const ids = collectionIds(index?.value, req.user!.id, indexKey);
        const keys = ids.map(itemKeyFor);
        const rows = keys.length ? await prisma.userData.findMany({ where: { userId: req.user!.id, key: { in: keys } }, select: { key: true, value: true } }) : [];
        const values = new Map(rows.map((row) => [row.key, row.value]));
        ok(res, { items: ids.flatMap((id) => values.has(itemKeyFor(id)) ? [{ id, value: values.get(itemKeyFor(id)) }] : []) });
    }),
);

userDataRouter.put(
    "/collections/:key",
    writeLimit,
    route(async (req, res) => {
        const body = collectionItemBody.parse(req.body);
        const { indexKey, itemKey, itemKeyFor } = collectionKeys(param(req, "key"), body.id);
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user!.id} FOR UPDATE`;
            const index = await tx.userData.findUnique({ where: { userId_key: { userId: req.user!.id, key: indexKey } }, select: { value: true } });
            const ids = collectionIds(index?.value, req.user!.id, indexKey);
            const next = [body.id, ...ids.filter((id) => id !== body.id)];
            const kept = next.slice(0, MAX_COLLECTION_ITEMS);
            const overflowKeys = next.slice(MAX_COLLECTION_ITEMS).map(itemKeyFor);
            const affectedKeys = [indexKey, itemKey, ...overflowKeys];
            const [rows, usage] = await Promise.all([
                tx.userData.findMany({ where: { userId: req.user!.id, key: { in: affectedKeys } }, select: { key: true, bytes: true } }),
                tx.userData.aggregate({ where: { userId: req.user!.id }, _count: true, _sum: { bytes: true } }),
            ]);
            const existing = new Map(rows.map((row) => [row.key, row.bytes]));
            const itemBytes = Buffer.byteLength(JSON.stringify(body.value));
            const indexBytes = Buffer.byteLength(JSON.stringify(kept));
            if (itemBytes > MAX_ITEM_BYTES) throw new ApiError("FILE_TOO_LARGE", "单项云端数据超过限制", { maxBytes: MAX_ITEM_BYTES });
            const removedBytes = affectedKeys.reduce((total, key) => total + (existing.get(key) || 0), 0);
            const removedRows = overflowKeys.filter((key) => existing.has(key)).length;
            const addedRows = Number(!existing.has(indexKey)) + Number(!existing.has(itemKey));
            if (usage._count - removedRows + addedRows > MAX_ROWS_PER_USER) throw new ApiError("RATE_LIMITED", "云端数据条目超过限制", { maxRows: MAX_ROWS_PER_USER });
            if ((usage._sum.bytes || 0) - removedBytes + itemBytes + indexBytes > MAX_BYTES_PER_USER) throw new ApiError("FILE_TOO_LARGE", "云端数据总量超过限制", { maxBytes: MAX_BYTES_PER_USER });
            await tx.userData.upsert({ where: { userId_key: { userId: req.user!.id, key: itemKey } }, update: { value: body.value as never, bytes: itemBytes }, create: { userId: req.user!.id, key: itemKey, value: body.value as never, bytes: itemBytes } });
            await tx.userData.upsert({ where: { userId_key: { userId: req.user!.id, key: indexKey } }, update: { value: kept, bytes: indexBytes }, create: { userId: req.user!.id, key: indexKey, value: kept, bytes: indexBytes } });
            await syncUploadReferences(tx, req.user!.id, "user_data", itemKey, body.value);
            if (overflowKeys.length) {
                await tx.userData.deleteMany({ where: { userId: req.user!.id, key: { in: overflowKeys } } });
                await tx.uploadReference.deleteMany({ where: { userId: req.user!.id, sourceType: "user_data", sourceKey: { in: overflowKeys } } });
            }
        });
        ok(res, { ok: true });
    }),
);

userDataRouter.delete(
    "/collections/:key/:id",
    deleteLimit,
    route(async (req, res) => {
        const id = collectionItemId.parse(param(req, "id"));
        const { indexKey, itemKey } = collectionKeys(param(req, "key"), id);
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user!.id} FOR UPDATE`;
            const index = await tx.userData.findUnique({ where: { userId_key: { userId: req.user!.id, key: indexKey } }, select: { value: true } });
            const ids = collectionIds(index?.value, req.user!.id, indexKey).filter((item) => item !== id);
            const bytes = Buffer.byteLength(JSON.stringify(ids));
            await tx.userData.upsert({ where: { userId_key: { userId: req.user!.id, key: indexKey } }, update: { value: ids, bytes }, create: { userId: req.user!.id, key: indexKey, value: ids, bytes } });
            await tx.userData.deleteMany({ where: { userId: req.user!.id, key: itemKey } });
            await removeUploadReferences(tx, req.user!.id, "user_data", itemKey);
        });
        ok(res, { ok: true });
    }),
);

userDataRouter.delete(
    "/collections/:key",
    deleteLimit,
    route(async (req, res) => {
        const { indexKey, itemKeyFor } = collectionKeys(param(req, "key"));
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user!.id} FOR UPDATE`;
            const index = await tx.userData.findUnique({ where: { userId_key: { userId: req.user!.id, key: indexKey } }, select: { value: true } });
            const ids = collectionIds(index?.value, req.user!.id, indexKey);
            const keys = [indexKey, ...ids.map(itemKeyFor)];
            await tx.userData.deleteMany({ where: { userId: req.user!.id, key: { in: keys } } });
            await tx.uploadReference.deleteMany({ where: { userId: req.user!.id, sourceType: "user_data", sourceKey: { in: keys } } });
        });
        ok(res, { ok: true });
    }),
);

userDataRouter.get(
    "/:key",
    route(async (req, res) => {
        const key = keySchema.parse(param(req, "key"));
        const item = await prisma.userData.findUnique({ where: { userId_key: { userId: req.user!.id, key } } });
        ok(res, { value: item?.value ?? null });
    }),
);

userDataRouter.put(
    "/:key",
    writeLimit,
    route(async (req, res) => {
        const key = keySchema.parse(param(req, "key"));
        const { value } = valueBody.parse(req.body);
        const bytes = Buffer.byteLength(JSON.stringify(value));
        if (bytes > MAX_ITEM_BYTES) throw new ApiError("FILE_TOO_LARGE", "单项云端数据超过限制", { maxBytes: MAX_ITEM_BYTES });
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user!.id} FOR UPDATE`;
            const [existing, usage] = await Promise.all([
                tx.userData.findUnique({ where: { userId_key: { userId: req.user!.id, key } }, select: { bytes: true } }),
                tx.userData.aggregate({ where: { userId: req.user!.id }, _count: true, _sum: { bytes: true } }),
            ]);
            if (!existing && usage._count >= MAX_ROWS_PER_USER) throw new ApiError("RATE_LIMITED", "云端数据条目超过限制", { maxRows: MAX_ROWS_PER_USER });
            if ((usage._sum.bytes || 0) - (existing?.bytes || 0) + bytes > MAX_BYTES_PER_USER) throw new ApiError("FILE_TOO_LARGE", "云端数据总量超过限制", { maxBytes: MAX_BYTES_PER_USER });
            await tx.userData.upsert({
                where: { userId_key: { userId: req.user!.id, key } },
                update: { value: value as never, bytes },
                create: { userId: req.user!.id, key, value: value as never, bytes },
            });
            await syncUploadReferences(tx, req.user!.id, "user_data", key, value);
        });
        ok(res, { ok: true });
    }),
);

userDataRouter.delete(
    "/:key",
    deleteLimit,
    route(async (req, res) => {
        const key = keySchema.parse(param(req, "key"));
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user!.id} FOR UPDATE`;
            await tx.userData.deleteMany({ where: { userId: req.user!.id, key } });
            await removeUploadReferences(tx, req.user!.id, "user_data", key);
        });
        ok(res, { ok: true });
    }),
);
