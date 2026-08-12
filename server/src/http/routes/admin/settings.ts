import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../../db.js";
import { writeAuditLog } from "../../../modules/audit.js";
import { isRegistrationOpen } from "../../../modules/auth/service.js";
import { ok, route } from "../../response.js";

const bodySchema = z.object({ registrationOpen: z.boolean() });
const REGISTRATION_SETTING_KEY = "registration_open";

export const adminSettingsRouter = Router();

adminSettingsRouter.get(
    "/",
    route(async (_req, res) => ok(res, { registrationOpen: await isRegistrationOpen() })),
);

adminSettingsRouter.patch(
    "/",
    route(async (req, res) => {
        const body = bodySchema.parse(req.body);
        await prisma.appSetting.upsert({ where: { key: REGISTRATION_SETTING_KEY }, update: { value: body.registrationOpen }, create: { key: REGISTRATION_SETTING_KEY, value: body.registrationOpen } });
        await writeAuditLog(req.user!.id, "settings.update", "app_setting", REGISTRATION_SETTING_KEY, body);
        ok(res, body);
    }),
);
