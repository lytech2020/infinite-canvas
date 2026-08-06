import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { logger } from "../logger.js";

/** 稳定错误代码与 HTTP 状态码的对应关系，前端只依据代码选择本地化文案。 */
export const errorStatus = {
    VALIDATION_FAILED: 400,
    AUTH_REQUIRED: 401,
    INVALID_CREDENTIALS: 401,
    EMAIL_ALREADY_EXISTS: 409,
    REGISTRATION_CLOSED: 403,
    ACCOUNT_DISABLED: 403,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    DUPLICATE_REQUEST: 409,
    JOB_NOT_CANCELABLE: 409,
    CONCURRENCY_LIMIT: 429,
    RATE_LIMITED: 429,
    FILE_TOO_LARGE: 413,
    FILE_TYPE_NOT_ALLOWED: 415,
    FILE_COUNT_EXCEEDED: 400,
    MODEL_UNAVAILABLE: 409,
    PROVIDER_ERROR: 502,
    PROVIDER_TIMEOUT: 504,
    SERVICE_BUSY: 503,
    INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof errorStatus;

/** 带稳定错误代码的业务异常。 */
export class ApiError extends Error {
    constructor(
        readonly code: ErrorCode,
        message = "",
        readonly details?: Record<string, unknown>,
    ) {
        super(message || code);
    }
}

/** 返回统一成功结构。 */
export function ok(res: Response, data: unknown) {
    res.json({ data });
}

/** 返回统一分页结构。 */
export function okList(res: Response, items: unknown[], total: number, page: number, pageSize: number) {
    res.json({ data: { items, total, page, pageSize } });
}

/** 读取路径参数。Express 5 的类型允许重复参数返回数组，这里统一取第一个值。 */
export function param(req: Request, name: string) {
    const value = req.params[name];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** 包裹异步路由，把抛出的异常交给统一错误处理。 */
export function route(handler: (req: Request, res: Response) => Promise<void> | void) {
    return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next);
}

/** 统一错误响应；未知异常记录日志后返回 INTERNAL_ERROR，不下发内部细节。 */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
    if (error instanceof ApiError) {
        res.status(errorStatus[error.code]).json({ error: { code: error.code, message: error.message, details: error.details } });
        return;
    }
    if (error instanceof ZodError) {
        res.status(errorStatus.VALIDATION_FAILED).json({ error: { code: "VALIDATION_FAILED", message: "请求参数不合法", details: { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } } });
        return;
    }
    logger.error("未处理的服务端错误", { message: error instanceof Error ? error.message : String(error) });
    res.status(errorStatus.INTERNAL_ERROR).json({ error: { code: "INTERNAL_ERROR", message: "服务内部错误" } });
}
