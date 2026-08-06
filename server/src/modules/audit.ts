import type { Prisma } from "@prisma/client";

import { prisma } from "../db.js";

/** 把校验过的普通对象转成 Prisma 的 JSON 输入类型。 */
export function toJson(value: unknown) {
    return value as Prisma.InputJsonValue;
}

/** 写入管理员操作审计；价格调整、账号状态变更和提示词查看都必须记录。 */
export function writeAuditLog(adminId: string, action: string, targetType: string, targetId?: string, detail?: Record<string, unknown>) {
    return prisma.adminAuditLog.create({ data: { adminId, action, targetType, targetId, detail: detail ? toJson(detail) : undefined } });
}
