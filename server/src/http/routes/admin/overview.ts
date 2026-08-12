import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../../db.js";
import { quotaPeriods } from "../../../modules/quota/service.js";
import { modelNames, summarize, summarizeBy } from "../../../modules/usage/query.js";
import { ok, route } from "../../response.js";

export const adminOverviewRouter = Router();

const rangeQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });

/** 后台概览：用户规模、当前负载，以及今日、本月和自定义区间的调用量与金额。 */
adminOverviewRouter.get(
    "/",
    route(async (req, res) => {
        const { from, to } = rangeQuery.parse(req.query);
        const activeSince = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const customRange = from || to ? { createdAt: { gte: from, lte: to } } : {};
        const { dayStart, monthStart } = quotaPeriods();

        const now = new Date();
        const [totalUsers, activeUsers, runningJobs, modelsMissingPrice, today, month, custom, byCapability, byStatus, byModel] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { lastActiveAt: { gte: activeSince } } }),
            prisma.generationJob.count({ where: { status: { in: ["queued", "running"] } } }),
            prisma.model.count({
                where: {
                    enabled: true,
                    provider: { enabled: true },
                    prices: { none: { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] } },
                },
            }),
            summarize({ createdAt: { gte: dayStart } }),
            summarize({ createdAt: { gte: monthStart } }),
            summarize(customRange),
            summarizeBy("capability", customRange),
            summarizeBy("status", customRange),
            summarizeBy("modelId", customRange),
        ]);

        const names = await modelNames(byModel.map((row) => row.key));
        ok(res, {
            users: { total: totalUsers, activeIn30Days: activeUsers },
            runningJobs,
            modelsMissingPrice,
            today,
            month,
            custom,
            byCapability,
            byStatus,
            byModel: byModel.map((row) => ({ ...row, modelName: names.get(row.key)?.displayName ?? "（模型已删除）", capability: names.get(row.key)?.capability ?? null })),
        });
    }),
);
