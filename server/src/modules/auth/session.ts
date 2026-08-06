import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";

import { prisma } from "../../db.js";
import { env } from "../../env.js";

const SESSION_TTL_MS = env.sessionTtlDays * 24 * 60 * 60 * 1000;

/** 会话令牌只把哈希写入数据库，明文仅存在于 Cookie。 */
function hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
}

/** 创建会话并写入 Cookie。 */
export async function createSession(res: Response, userId: string) {
    const token = randomBytes(32).toString("base64url");
    await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
    res.cookie(env.sessionCookieName, token, { httpOnly: true, sameSite: "lax", secure: env.isProduction, maxAge: SESSION_TTL_MS, path: "/" });
}

/** 读取有效会话对应的用户；过期、撤销或不存在时返回 null。 */
export async function readSessionUser(token: string) {
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
    const now = new Date();
    // 使用中滑动续期，同时更新用户活跃时间。
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) } });
    await prisma.user.update({ where: { id: session.userId }, data: { lastActiveAt: now } });
    return session.user;
}

/** 撤销当前会话并清除 Cookie。 */
export async function revokeSession(res: Response, token: string) {
    await prisma.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
    res.clearCookie(env.sessionCookieName, { path: "/" });
}

/** 撤销某个用户的全部会话，用于停用账号后立即失效。 */
export async function revokeUserSessions(userId: string) {
    await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
