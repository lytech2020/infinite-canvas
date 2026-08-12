import type { User } from "@prisma/client";
import argon2 from "argon2";

import { prisma } from "../../db.js";
import { env } from "../../env.js";
import { ApiError } from "../../http/response.js";

const REGISTRATION_SETTING_KEY = "registration_open";

/** 读取是否开放自助注册；数据库未初始化时回落到环境变量初始值。 */
export async function isRegistrationOpen() {
    const setting = await prisma.appSetting.findUnique({ where: { key: REGISTRATION_SETTING_KEY } });
    return setting ? setting.value === true : env.registrationOpen;
}

/** 邮箱统一小写保存，避免大小写造成重复账号。 */
function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

/** 创建普通启用用户；管理员添加账号与自助注册共用邮箱和密码处理。 */
export async function createUser(email: string, password: string) {
    const normalized = normalizeEmail(email);
    if (await prisma.user.findUnique({ where: { email: normalized } })) throw new ApiError("EMAIL_ALREADY_EXISTS", "该邮箱已注册");
    return prisma.user.create({ data: { email: normalized, passwordHash: await argon2.hash(password) } });
}

/** 注册普通用户。 */
export async function registerUser(email: string, password: string) {
    if (!(await isRegistrationOpen())) throw new ApiError("REGISTRATION_CLOSED", "当前未开放自助注册");
    return createUser(email, password);
}

/** 校验邮箱密码并返回用户；账号停用时拒绝登录。 */
export async function verifyUser(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) throw new ApiError("INVALID_CREDENTIALS", "邮箱或密码错误");
    if (user.status === "disabled") throw new ApiError("ACCOUNT_DISABLED", "账号已停用");
    return user;
}

/** 修改当前用户密码；必须再次校验旧密码，避免已登录设备被他人直接接管。 */
export async function changeUserPassword(user: User, currentPassword: string, newPassword: string) {
    if (!(await argon2.verify(user.passwordHash, currentPassword))) throw new ApiError("CURRENT_PASSWORD_INVALID", "当前密码错误");
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(newPassword) } });
}

/** 对外输出的用户信息，不包含密码哈希。 */
export function publicUser(user: User) {
    return { id: user.id, email: user.email, role: user.role, status: user.status, createdAt: user.createdAt, lastActiveAt: user.lastActiveAt };
}
