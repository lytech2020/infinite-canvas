import { Router } from "express";

import { listPublicModels } from "../../modules/catalog/service.js";
import { ok, route } from "../response.js";

export const modelsRouter = Router();

/** 普通用户可用模型；不包含渠道、密钥和实际调用名称。 */
modelsRouter.get(
    "/",
    route(async (_req, res) => ok(res, { items: await listPublicModels() })),
);
