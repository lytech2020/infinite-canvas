import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "../env.js";

const KEY = Buffer.from(env.secretEncryptionKey, "base64");
if (KEY.length !== 32) throw new Error("SECRET_ENCRYPTION_KEY 必须是 32 字节的 base64 值");

/** 使用 AES-256-GCM 加密渠道密钥，密文格式为 iv:tag:data 的 base64 拼接。 */
export function encryptSecret(plain: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", KEY, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** 解密渠道密钥，仅在后台调用供应商时使用。 */
export function decryptSecret(cipherText: string) {
    const [iv, tag, data] = cipherText.split(":");
    const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** 管理界面展示用的密钥掩码，只保留末尾 4 位。 */
export function maskSecret(plain: string) {
    return plain.length <= 4 ? "****" : `****${plain.slice(-4)}`;
}
