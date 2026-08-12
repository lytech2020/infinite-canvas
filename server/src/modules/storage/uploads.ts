import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";

import { prisma } from "../../db.js";
import { env } from "../../env.js";
import { ApiError } from "../../http/response.js";
import { deleteObject, getObjectPrefix, headObject, presignDownload, presignUpload, putObject } from "./s3.js";

/** 后台默认文件限制，模型配置了更严格的限制时以模型为准。 */
export const FILE_LIMITS = {
    image: { maxCount: 9, maxSizeMb: 20, mimePrefix: "image/" },
    video: { maxCount: 3, maxSizeMb: 200, mimePrefix: "video/" },
    audio: { maxCount: 3, maxSizeMb: 20, mimePrefix: "audio/" },
} as const;
const MAX_PENDING_UPLOADS_PER_USER = 100;

export type FileKind = keyof typeof FILE_LIMITS;

const EXTENSIONS: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/opus": ".opus",
    "audio/aac": ".aac",
    "audio/flac": ".flac",
};

/** 按 MIME 判断文件类别；不属于图片、视频、音频的一律拒绝。 */
export function fileKind(mimeType: string): FileKind {
    const kind = (Object.keys(FILE_LIMITS) as FileKind[]).find((key) => mimeType.startsWith(FILE_LIMITS[key].mimePrefix));
    if (!kind) throw new ApiError("FILE_TYPE_NOT_ALLOWED", "不支持的文件类型", { mimeType });
    return kind;
}

function storageKey(userId: string, mimeType: string) {
    const month = new Date().toISOString().slice(0, 7).replace("-", "");
    return `uploads/${userId}/${month}/${randomUUID()}${EXTENSIONS[mimeType] || ""}`;
}

/** 申请限时上传地址；先按类型和大小校验，再签发只能用于该对象的地址。 */
export async function createUpload(userId: string, mimeType: string, size: number) {
    const limit = FILE_LIMITS[fileKind(mimeType)];
    if (size > limit.maxSizeMb * 1024 * 1024) throw new ApiError("FILE_TOO_LARGE", "文件超过大小限制", { maxSizeMb: limit.maxSizeMb });
    const pending = await prisma.upload.count({ where: { userId, status: "pending", expiresAt: { gt: new Date() } } });
    if (pending >= MAX_PENDING_UPLOADS_PER_USER) throw new ApiError("RATE_LIMITED", "待上传文件过多，请完成或等待旧记录过期", { maxPending: MAX_PENDING_UPLOADS_PER_USER });

    const key = storageKey(userId, mimeType);
    const upload = await prisma.upload.create({
        data: { userId, storageKey: key, mimeType, size, expiresAt: new Date(Date.now() + env.tempFileTtlHours * 3600 * 1000) },
    });
    return { upload, url: await presignUpload(key, mimeType, size), expiresInSeconds: env.uploadUrlTtlSeconds };
}

/** 确认上传完成；以对象存储中的真实大小和类型为准，不信任前端声明。 */
export async function completeUpload(userId: string, uploadId: string) {
    const upload = await prisma.upload.findUnique({ where: { id: uploadId } });
    if (!upload || upload.userId !== userId) throw new ApiError("NOT_FOUND", "上传记录不存在");

    const head = await headObject(upload.storageKey).catch(() => null);
    if (!head) throw new ApiError("VALIDATION_FAILED", "尚未检测到已上传的文件");
    if (head.size !== upload.size) {
        await deleteObject(upload.storageKey).catch(() => undefined);
        throw new ApiError("VALIDATION_FAILED", "文件实际大小与申请上传时不一致");
    }
    const detected = await getObjectPrefix(upload.storageKey).then(fileTypeFromBuffer).catch(() => undefined);
    const declaredKind = fileKind(upload.mimeType);
    if (!detected || fileKind(detected.mime) !== declaredKind) {
        await deleteObject(upload.storageKey).catch(() => undefined);
        throw new ApiError("FILE_TYPE_NOT_ALLOWED", "文件内容与声明类型不一致");
    }
    const limit = FILE_LIMITS[declaredKind];
    if (head.size > limit.maxSizeMb * 1024 * 1024) throw new ApiError("FILE_TOO_LARGE", "文件超过大小限制", { maxSizeMb: limit.maxSizeMb });

    return prisma.upload.update({ where: { id: upload.id }, data: { status: "ready", size: head.size, mimeType: detected.mime } });
}

/** 校验生成请求引用的文件：必须属于当前用户、已上传完成，且数量不超限。 */
export async function resolveJobFiles(userId: string, fileIds: string[]) {
    if (!fileIds.length) return [];
    const uploads = await prisma.upload.findMany({ where: { id: { in: fileIds }, userId, status: "ready", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (uploads.length !== fileIds.length) throw new ApiError("NOT_FOUND", "引用的文件不存在或尚未上传完成");

    const counts = new Map<FileKind, number>();
    for (const upload of uploads) {
        const kind = fileKind(upload.mimeType);
        counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    for (const [kind, count] of counts) {
        if (count > FILE_LIMITS[kind].maxCount) throw new ApiError("FILE_COUNT_EXCEEDED", "文件数量超出限制", { kind, maxCount: FILE_LIMITS[kind].maxCount });
    }
    return uploads;
}

/** 保存生成结果到对象存储，返回可下发给前端的限时地址。 */
export async function saveGeneratedFile(userId: string, jobId: string, body: Buffer, mimeType: string) {
    const key = `outputs/${userId}/${jobId}/${randomUUID()}${EXTENSIONS[mimeType] || ""}`;
    await putObject(key, body, mimeType);
    return { storageKey: key, mimeType, size: body.length, url: await presignDownload(key) };
}

/** 清理过期临时上传的对象和数据库记录；已进入任务的数据在 24 小时后同样无需继续保留。 */
export async function cleanupExpiredUploads() {
    const expired = await prisma.upload.findMany({ where: { expiresAt: { lt: new Date() } }, select: { id: true, storageKey: true } });
    const deletedIds: string[] = [];
    for (const upload of expired) {
        try {
            await deleteObject(upload.storageKey);
            deletedIds.push(upload.id);
        } catch {
            // 对象存储暂时不可用时保留数据库记录，下个周期继续清理。
        }
    }
    if (deletedIds.length) await prisma.upload.deleteMany({ where: { id: { in: deletedIds } } });
    return deletedIds.length;
}
