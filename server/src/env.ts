import "dotenv/config";

/** 读取必填环境变量，缺失时直接终止启动，避免运行期才发现配置错误。 */
function required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`缺少必填环境变量 ${name}`);
    return value;
}

export const env = {
    port: Number(process.env.PORT) || 8787,
    nodeEnv: process.env.NODE_ENV || "development",
    isProduction: process.env.NODE_ENV === "production",
    logLevel: process.env.LOG_LEVEL || "info",
    databaseUrl: required("DATABASE_URL"),
    secretEncryptionKey: required("SECRET_ENCRYPTION_KEY"),
    sessionCookieName: process.env.SESSION_COOKIE_NAME || "ic_session",
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS) || 30,
    registrationOpen: process.env.REGISTRATION_OPEN !== "false",
    userMaxConcurrentJobs: Number(process.env.USER_MAX_CONCURRENT_JOBS) || 2,
    userMaxConcurrentVideoJobs: Number(process.env.USER_MAX_CONCURRENT_VIDEO_JOBS) || 1,
    providerTimeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS) || 120000,
    s3Endpoint: required("S3_ENDPOINT"),
    s3Region: process.env.S3_REGION || "us-east-1",
    s3Bucket: required("S3_BUCKET"),
    s3AccessKeyId: required("S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    uploadUrlTtlSeconds: Number(process.env.UPLOAD_URL_TTL_SECONDS) || 300,
    downloadUrlTtlSeconds: Number(process.env.DOWNLOAD_URL_TTL_SECONDS) || 3600,
    tempFileTtlHours: Number(process.env.TEMP_FILE_TTL_HOURS) || 24,
};
