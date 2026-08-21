import winston, { format, transports } from "winston";

import { env } from "./env.js";

const line = format.printf(({ level, message, timestamp, ...meta }) => `${timestamp} ${level.toUpperCase()} ${message}${Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ""}`);

/** 后台统一日志；密码、会话令牌和 API Key 一律不写入。 */
export const logger = winston.createLogger({
    level: env.logLevel,
    transports: [new transports.Console({ format: format.combine(format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), line) })],
});
