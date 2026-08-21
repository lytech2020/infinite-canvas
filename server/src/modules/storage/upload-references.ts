import { Prisma } from "@prisma/client";
import { ApiError } from "../../http/response.js";

function collectUploadIds(value: unknown, ids = new Set<string>()) {
    if (!value || typeof value !== "object") return ids;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey) ids.add(value.storageKey);
    Object.values(value).forEach((item) => {
        if (Array.isArray(item)) item.forEach((child) => collectUploadIds(child, ids));
        else collectUploadIds(item, ids);
    });
    return ids;
}

export async function syncUploadReferences(tx: Prisma.TransactionClient, userId: string, sourceType: "project" | "user_data", sourceKey: string, value: unknown) {
    const ids = [...collectUploadIds(value)];
    const owned = ids.length
        ? await tx.$queryRaw<Array<{ id: string; delete_locked: boolean }>>(Prisma.sql`SELECT id, delete_locked FROM uploads WHERE user_id = ${userId} AND persistent = true AND id IN (${Prisma.join(ids)}) FOR UPDATE`)
        : [];
    if (owned.some((upload) => upload.delete_locked)) throw new ApiError("NOT_FOUND", "引用的文件正在清理，请重新上传");
    if (owned.length) await tx.upload.updateMany({ where: { id: { in: owned.map(({ id }) => id) }, userId }, data: { deletePending: false } });
    await tx.uploadReference.deleteMany({ where: { userId, sourceType, sourceKey } });
    if (owned.length) await tx.uploadReference.createMany({ data: owned.map(({ id }) => ({ uploadId: id, userId, sourceType, sourceKey })), skipDuplicates: true });
}

export function removeUploadReferences(tx: Prisma.TransactionClient, userId: string, sourceType: "project" | "user_data", sourceKey: string) {
    return tx.uploadReference.deleteMany({ where: { userId, sourceType, sourceKey } });
}
