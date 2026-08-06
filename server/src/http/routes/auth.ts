import { Router } from "express";
import { z } from "zod";

import { isRegistrationOpen, publicUser, registerUser, verifyUser } from "../../modules/auth/service.js";
import { createSession, revokeSession } from "../../modules/auth/session.js";
import { requireUser } from "../auth-middleware.js";
import { ok, route } from "../response.js";

const credentials = z.object({ email: z.string().email(), password: z.string().min(8).max(128) });

export const authRouter = Router();

/** 注册后直接建立会话，前端无需再登录一次。 */
authRouter.post(
    "/register",
    route(async (req, res) => {
        const { email, password } = credentials.parse(req.body);
        const user = await registerUser(email, password);
        await createSession(res, user.id);
        ok(res, { user: publicUser(user) });
    }),
);

authRouter.post(
    "/login",
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

/** 登录页据此决定是否展示注册入口。 */
authRouter.get(
    "/registration",
    route(async (_req, res) => ok(res, { open: await isRegistrationOpen() })),
);
