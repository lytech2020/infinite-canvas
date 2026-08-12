import type { JobStatus, Prisma, PrismaClient, User } from "@prisma/client";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

import { env } from "../../env.js";
import { ApiError } from "../../http/response.js";

dayjs.extend(utc);
dayjs.extend(timezone);

function periods(now = new Date()) {
    const local = dayjs(now).tz(env.quotaTimezone);
    return {
        dayStart: local.startOf("day").toDate(),
        dayResetAt: local.add(1, "day").startOf("day").toDate(),
        monthStart: local.startOf("month").toDate(),
        monthResetAt: local.add(1, "month").startOf("month").toDate(),
    };
}

export async function readUserQuotaUsage(db: Prisma.TransactionClient | PrismaClient, user: User) {
    const { dayStart, dayResetAt, monthStart, monthResetAt } = periods();
    const [dailyCalls, month] = await Promise.all([
        db.generationJob.count({ where: { userId: user.id, createdAt: { gte: dayStart } } }),
        db.aiUsageRecord.aggregate({ where: { userId: user.id, createdAt: { gte: monthStart } }, _sum: { amountUsd: true } }),
    ]);
    return {
        dailyCalls,
        monthlyAmountUsd: month._sum.amountUsd?.toFixed(8) ?? "0.00000000",
        effectiveConcurrencyLimit: user.concurrencyLimit ?? env.userMaxConcurrentJobs,
        effectiveVideoConcurrencyLimit: user.videoConcurrencyLimit ?? env.userMaxConcurrentVideoJobs,
        timezone: env.quotaTimezone,
        dayResetAt,
        monthResetAt,
    };
}

/** 账户限额在用户级事务锁内检查；金额按已结算记录软限制，达到后拒绝下一次任务。 */
export async function assertUserQuota(db: Prisma.TransactionClient, user: User, capability: "text" | "image" | "video" | "audio") {
    const active = { userId: user.id, status: { in: ["queued", "running"] as JobStatus[] } };
    const concurrencyLimit = user.concurrencyLimit ?? env.userMaxConcurrentJobs;
    const videoConcurrencyLimit = user.videoConcurrencyLimit ?? env.userMaxConcurrentVideoJobs;
    const { dayStart, monthStart } = periods();
    const [running, videos, dailyCalls, month] = await Promise.all([
        db.generationJob.count({ where: active }),
        capability === "video" ? db.generationJob.count({ where: { ...active, capability: "video" } }) : Promise.resolve(0),
        user.role !== "admin" && user.dailyCallLimit ? db.generationJob.count({ where: { userId: user.id, createdAt: { gte: dayStart } } }) : Promise.resolve(0),
        user.role !== "admin" && user.monthlyBudgetUsd ? db.aiUsageRecord.aggregate({ where: { userId: user.id, createdAt: { gte: monthStart } }, _sum: { amountUsd: true } }) : Promise.resolve(null),
    ]);
    if (running >= concurrencyLimit) throw new ApiError("CONCURRENCY_LIMIT", "当前运行任务过多", { limit: concurrencyLimit });
    if (capability === "video" && videos >= videoConcurrencyLimit) throw new ApiError("CONCURRENCY_LIMIT", "视频任务过多", { limit: videoConcurrencyLimit });
    if (user.role !== "admin" && user.dailyCallLimit && dailyCalls >= user.dailyCallLimit) throw new ApiError("DAILY_CALL_LIMIT", "今日调用次数已用完", { limit: user.dailyCallLimit });
    if (user.role !== "admin" && user.monthlyBudgetUsd && month?._sum.amountUsd?.gte(user.monthlyBudgetUsd)) {
        throw new ApiError("MONTHLY_BUDGET_LIMIT", "本月额度已用完", { limit: user.monthlyBudgetUsd.toFixed(8) });
    }
}
