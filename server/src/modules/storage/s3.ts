import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../../env.js";

const client = new S3Client({
    region: env.s3Region,
    endpoint: env.s3Endpoint,
    forcePathStyle: env.s3ForcePathStyle,
    credentials: { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey },
});

/** 签发限时上传地址；绑定内容类型和长度，避免上传地址被挪作他用。 */
export function presignUpload(key: string, mimeType: string, size: number) {
    return getSignedUrl(client, new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, ContentType: mimeType, ContentLength: size }), { expiresIn: env.uploadUrlTtlSeconds });
}

/** 签发限时下载地址；生成结果不公开可读，一律通过限时地址访问。 */
export function presignDownload(key: string, expiresIn = env.downloadUrlTtlSeconds) {
    return getSignedUrl(client, new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }), { expiresIn });
}

/** 读取对象元数据，用于核对前端上传结果的真实大小和类型。 */
export async function headObject(key: string) {
    const head = await client.send(new HeadObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return { size: Number(head.ContentLength || 0), mimeType: head.ContentType || "" };
}

/** 读取对象内容，用于把参考文件转发给供应商。 */
export async function getObjectBuffer(key: string) {
    const object = await client.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return Buffer.from(await object.Body!.transformToByteArray());
}

/** 后台直接写入对象，用于保存生成结果。 */
export async function putObject(key: string, body: Buffer, mimeType: string) {
    await client.send(new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, Body: body, ContentType: mimeType }));
    return key;
}

/** 删除过期临时上传，避免数据库记录清理后对象仍留在存储桶中。 */
export function deleteObject(key: string) {
    return client.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
}
