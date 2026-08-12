import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

import { changeUserPassword, isRegistrationOpen, publicUser, registerUser, verifyUser } from "../../modules/auth/service.js";
import { createSession, revokeOtherUserSessions, revokeSession } from "../../modules/auth/session.js";
import { requireUser } from "../auth-middleware.js";
import { ok, route } from "../response.js";

const credentials = z.object({ email: z.string().email(), password: z.string().min(8).max(16) });
const passwordBody = z.object({ currentPassword: z.string().min(8).max(16), newPassword: z.string().min(8).max(16) });

export const authRouter = Router();
const credentialLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "尝试次数过多，请稍后再试" } }),
});

/** 注册后直接建立会话，前端无需再登录一次。 */
authRouter.post(
    "/register",
    credentialLimit,
    route(async (req, res) => {
        const { email, password } = credentials.parse(req.body);
        const user = await registerUser(email, password);
        await createSession(res, user.id);
        ok(res, { user: publicUser(user) });
    }),
);

authRouter.post(
    "/login",
    credentialLimit,
    route(async (req, res) => {
        const { email, password } = credentials.parse(req.body);
        const user = await verifyUser(email, password);
        await createSession(res, user.id);
        ok(res, { user: publicUser(user) });
    }),
);

authRouter.post(
    "/logout",
    route(async (req, res) => {
        if (req.sessionToken) await revokeSession(res, req.sessionToken);
        ok(res, { ok: true });
    }),
);

/** 当前用户，前端启动时用于恢复登录状态。 */
authRouter.get(
    "/me",
    requireUser,
    route((req, res) => ok(res, { user: publicUser(req.user!) })),
);

authRouter.post(
    "/password",
    credentialLimit,
    requireUser,
    route(async (req, res) => {
        const { currentPassword, newPassword } = passwordBody.parse(req.body);
        await changeUserPassword(req.user!, currentPassword, newPassword);
        if (req.sessionToken) await revokeOtherUserSessions(req.user!.id, req.sessionToken);
        ok(res, { ok: true });
    }),
);

/** 登录页据此决定是否展示注册入口。 */
authRouter.get(
    "/registration",
    route(async (_req, res) => ok(res, { open: await isRegistrationOpen() })),
);
