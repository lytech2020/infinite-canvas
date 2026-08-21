import argon2 from "argon2";

import { prisma } from "../src/db.js";
import { env } from "../src/env.js";
import { encryptSecret } from "../src/lib/crypto.js";

const CAPABILITIES = ["text", "image", "video", "audio"] as const;
type Capability = (typeof CAPABILITIES)[number];

/** 解析部署名列表，形如 `gpt-4o:text,gpt-image-1:image`；省略能力时默认 text。 */
function parseDeployments(value: string) {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
            const [name, capability = "text"] = item.split(":").map((part) => part.trim());
            if (!CAPABILITIES.includes(capability as Capability)) throw new Error(`部署 ${name} 的能力 ${capability} 不合法，可用值：${CAPABILITIES.join(" / ")}`);
            return { name, capability: capability as Capability };
        });
}

/**
 * 可选：按环境变量创建初始 Azure OpenAI 渠道和模型。
 * 密钥加密后写入数据库，之后统一在管理接口维护；重复执行只更新，不重复创建。
 */
async function seedAzureProvider() {
    const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || "").trim();
    const apiKey = (process.env.AZURE_OPENAI_API_KEY || "").trim();
    const deployments = parseDeployments(process.env.AZURE_OPENAI_DEPLOYMENT || "");
    if (!endpoint || !apiKey || !deployments.length) return;

    const name = "Azure OpenAI";
    const apiVersion = (process.env.AZURE_OPENAI_API_VERSION || "preview").trim();
    const existing = await prisma.provider.findFirst({ where: { name } });
    const provider = existing ?? (await prisma.provider.create({ data: { name, apiFormat: "azure_openai", baseUrl: endpoint, apiKeyCipher: encryptSecret(apiKey), apiVersion } }));
    if (existing) console.log(`渠道「${name}」已存在，保留管理后台中的现有配置，仅补充缺失模型`);

    for (const [index, deployment] of deployments.entries()) {
        const existingModel = await prisma.model.findFirst({ where: { providerId: provider.id, remoteName: deployment.name, capability: deployment.capability } });
        if (existingModel) continue;
        // 同一能力下的第一个部署设为默认模型。
        const isDefault = !(await prisma.model.findFirst({ where: { capability: deployment.capability, isDefault: true } }));
        await prisma.model.create({
            data: { providerId: provider.id, displayName: deployment.name, remoteName: deployment.name, capability: deployment.capability, isDefault, sortOrder: index },
        });
    }
    console.log(`已配置渠道「${name}」和 ${deployments.length} 个模型：${deployments.map((item) => `${item.name}(${item.capability})`).join("、")}`);
}

/** 初始化管理员账号和自助注册开关；已存在的管理员不会被覆盖密码。 */
async function main() {
    const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || "";
    if (!email) throw new Error("缺少 ADMIN_EMAIL");

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        if (existing.role !== "admin") await prisma.user.update({ where: { id: existing.id }, data: { role: "admin" } });
        console.log(`管理员已存在：${email}`);
    } else {
        if (password.length < 8 || password.length > 16) throw new Error("创建管理员时 ADMIN_PASSWORD 长度必须为 8-16 位");
        await prisma.user.create({ data: { email, passwordHash: await argon2.hash(password), role: "admin" } });
        console.log(`已创建管理员：${email}，请登录后立即修改密码`);
    }

    await prisma.appSetting.upsert({ where: { key: "registration_open" }, update: {}, create: { key: "registration_open", value: env.registrationOpen } });
    await seedAzureProvider();
}

await main();
await prisma.$disconnect();
