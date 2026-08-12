import type { User } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";

import { env } from "../env.js";
import { readSessionUser } from "../modules/auth/session.js";
import { ApiError } from "./response.js";

declare module "express-serve-static-core" {
    interface Request {
        user?: User;
        sessionToken?: string;
    }
}

/** 解析会话 Cookie，把当前用户挂到请求上；不做拦截。 */
export async function attachUser(req: Request, res: Response, next: NextFunction) {
    try {
        const token = req.cookies?.[env.sessionCookieName];
        if (token) {
            req.sessionToken = token;
            req.user = (await readSessionUser(token, res)) || undefined;
        }
        next();
    } catch (error) {
        next(error);
    }
}

/** 要求已登录且账号可用。 */
export function requireUser(req: Request, _res: Response, next: NextFunction) {
    if (!req.user) return next(new ApiError("AUTH_REQUIRED", "请先登录"));
    if (req.user.status === "disabled") return next(new ApiError("ACCOUNT_DISABLED", "账号已停用"));
    next();
}

/** 要求管理员角色，用于全部 /admin 接口。 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
    if (req.user?.role !== "admin") return next(new ApiError("FORBIDDEN", "需要管理员权限"));
    next();
}
