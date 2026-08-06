# 云端版后台技术方案与接口契约

状态：第一阶段方案，待确认后进入编码

本文件是 [云端版最小后台](cloud-backend.md) 需求的技术落地方案，负责回答“用什么、放哪里、接口长什么样”。需求范围仍以 `cloud-backend.md` 为准，前端改造范围以 `cloud-frontend.md` 为准。

设计原则：优先简单、稳定、容易部署，只实现当前阶段明确需要的能力，不引入队列中间件、微服务和多套配置体系。

## 1. 技术栈

| 方向 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js 20 + TypeScript | 与 `canvas-agent` 一致，团队已有写法可沿用 |
| Web 框架 | Express 5 | `canvas-agent` 已在用；无需再引入新框架 |
| 参数校验 | zod | `canvas-agent` 已在用，同时用于生成错误码 `VALIDATION_FAILED` |
| 数据库 | PostgreSQL 16 | 需要高精度 `NUMERIC` 金额、JSONB 价格快照和全文/关键词检索 |
| ORM 与迁移 | Prisma | 自带迁移、`Decimal` 类型和类型安全查询，部署只需 `prisma migrate deploy` |
| 身份认证 | 邮箱 + 密码，服务端会话 Cookie | 不依赖第三方身份服务和 SMTP，见第 4 节 |
| 密码哈希 | `argon2` | 成熟库，不自行实现加密 |
| 密钥加密 | Node 内置 `crypto` AES-256-GCM | 渠道 API Key 加密落库，主密钥来自环境变量 |
| 对象存储 | S3 兼容（生产 S3 / R2，本地 MinIO） | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 签发限时上传地址 |
| 日志 | winston | 与 `canvas-agent` 一致 |
| HTTP 客户端 | axios | 与前端一致，调用供应商接口 |

不引入：Redis、消息队列、GraphQL、独立鉴权服务、ORM 之外的查询构建器。

## 2. 仓库结构与部署拓扑

### 2.1 新增目录

```text
server/
  package.json
  tsconfig.json
  Dockerfile
  prisma/
    schema.prisma
    migrations/
    seed.ts               # 创建初始管理员
  src/
    index.ts              # Express 启动入口
    env.ts                # 环境变量读取与校验
    db.ts                 # Prisma Client 单例
    http/
      response.ts         # 统一响应与错误码
      auth-middleware.ts  # 会话解析、登录校验、管理员校验
      routes/
        auth.ts
        models.ts
        projects.ts
        uploads.ts
        generations.ts
        admin/*.ts
    modules/
      auth/               # 注册、登录、会话
      catalog/            # 渠道、模型、价格
      projects/
      generation/         # 任务编排、并发保护、供应商适配
      providers/          # openai / azure-openai / gemini / ark 适配器
      usage/              # Token 归一化、估算、价格快照、金额结算
      storage/            # S3 预签名与清理
    lib/
      crypto.ts           # AES-256-GCM 加解密
      money.ts            # Decimal 计算封装
```

前端仍在 `web/`，不改变现有目录约定。前端调用后台的代码统一放在 `web/src/services/api/`（沿用 AGENTS.md 前端规范）。

### 2.2 部署拓扑

```text
浏览器
  -> nginx (静态前端 dist + /api 反向代理)
       -> server (Node/Express, :8787)
            -> postgres
            -> S3 兼容对象存储
```

- 生产使用 docker-compose 三个服务：`web`（现有 nginx 镜像）、`server`、`db`；对象存储使用外部 S3 兼容服务。
- 保留现有 `Dockerfile` 与 `docker-entrypoint.sh` 的 `config.js` 运行期配置机制，不改动前端构建方式。
- nginx 新增 `location /api/ { proxy_pass http://server:8787; }`，前端生产环境与 API 同源，无需 CORS。
- 开发环境由 Vite `server.proxy` 把 `/api` 转发到 `http://localhost:8787`，同样同源。

## 3. 数据库设计

金额统一使用 `NUMERIC(24, 10)`（Prisma `Decimal`），币种固定 `USD`，禁止使用浮点类型累计。

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `users` | `id`, `email`(唯一), `password_hash`, `role`(`user`/`admin`), `status`(`active`/`disabled`), `concurrency_limit`, `created_at`, `last_active_at` | 角色和启用状态在此判定 |
| `sessions` | `id`, `user_id`, `token_hash`(唯一), `expires_at`, `created_at`, `last_used_at`, `revoked_at` | 会话可撤销，停用用户即时失效 |
| `projects` | `id`(前端生成的画布 ID), `user_id`, `name`, `created_at`, `updated_at`, `deleted_at` | 软删除，历史用量不受影响 |
| `providers` | `id`, `name`, `api_format`, `base_url`, `api_key_cipher`, `api_version`, `extra`(JSONB), `enabled` | `api_key_cipher` 为 AES-256-GCM 密文，任何接口都不返回明文 |
| `models` | `id`, `provider_id`, `display_name`, `remote_name`(即 Deployment Name), `capability`, `param_schema`(JSONB), `file_limits`(JSONB), `max_concurrency`, `enabled`, `sort_order` | 面向用户的接口只返回展示字段 |
| `model_prices` | `id`, `model_id`, `currency`(`USD`), `pricing_type`, `unit_prices`(JSONB), `effective_from`, `effective_to`, `created_by`, `created_at` | 价格按生效时间取用，历史记录不可变 |
| `generation_jobs` | `id`, `request_id`(与 `user_id` 唯一), `provider_request_id`, `user_id`, `project_id`, `project_name_snapshot`, `node_id`, `source`, `model_id`, `capability`, `prompt_text`, `params`(JSONB), `status`, `error_code`, `error_detail`, `created_at`, `started_at`, `finished_at` | `prompt_text` 长期保存，原文不翻译不改写 |
| `ai_usage_records` | `job_id`(唯一), `user_id`, `project_id`, `model_id`, `price_snapshot`(JSONB), `input_tokens`, `cached_tokens`, `output_tokens`, `reasoning_tokens`, `total_tokens`, `media_units`(JSONB), `usage_source`(`provider`/`estimated`), `usage_estimation_method`, `tokenizer_name`, `tokenizer_version`, `amount_usd`, `calculation_detail`(JSONB), `created_at` | 一次调用一条结算记录，靠 `job_id` 唯一保证不重复计费 |
| `uploads` | `id`, `user_id`, `storage_key`, `mime_type`, `size`, `status`(`pending`/`ready`), `expires_at`, `created_at` | 只存元数据，文件本体在对象存储 |
| `admin_audit_logs` | `id`, `admin_id`, `action`, `target_type`, `target_id`, `detail`(JSONB), `created_at` | 记录提示词查看、价格修改、用户停用等 |
| `app_settings` | `key`, `value`(JSONB), `updated_at` | 例如是否开放自助注册 |

汇总口径：用户与项目累计金额一律由 `ai_usage_records` 聚合得出，不在 `users` / `projects` 上维护无法追溯的手工数字。后续需要提速时再增加可重算的汇总表。

关键索引：`ai_usage_records(user_id, created_at)`、`ai_usage_records(project_id, created_at)`、`generation_jobs(user_id, status)`、`generation_jobs(model_id, created_at)`、`generation_jobs` 的 `prompt_text` 关键词检索索引。

## 4. 身份认证

- 注册：`email` + `password`（最少 8 位）。是否开放自助注册由 `app_settings.registration_open` 控制。
- 登录：校验密码后生成 32 字节随机会话令牌，明文只写入 Cookie，数据库保存 `sha256` 哈希。
- Cookie：`ic_session`，`HttpOnly`、`SameSite=Lax`、生产环境 `Secure`，有效期 30 天，使用中滑动续期。
- 登录状态恢复：前端启动调用 `GET /api/v1/auth/me`，未登录返回 `AUTH_REQUIRED`。
- 退出登录：撤销当前会话并清 Cookie。
- 停用用户：`users.status = disabled` 并撤销其全部会话，后续请求返回 `ACCOUNT_DISABLED`。
- 管理接口统一经过 `requireAdmin` 中间件校验 `role = admin`。
- 初始管理员由 `prisma/seed.ts` 按 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 创建，不做“首个注册用户自动成为管理员”。
- 不使用 JWT：服务端会话可即时撤销，配合停用账号的需求更直接。
- 密码、会话令牌、API Key、验证码一律不写入日志。

## 5. 对象存储

- 前端不直接持有存储密钥，先调用 `POST /api/v1/uploads/presign` 获取限时 `PUT` 地址。
- 预签名有效期 5 分钟，签名时绑定 `Content-Type` 与 `Content-Length`，`storage_key` 形如 `uploads/{user_id}/{yyyymm}/{upload_id}{ext}`。
- 上传完成后调用 `POST /api/v1/uploads/{id}/complete`，后台核对对象大小与 MIME，置为 `ready`。
- 生成请求只提交 `fileIds`，后台校验归属、状态、类型、数量和总大小。
- 未被任务引用的 `pending` 上传超过 24 小时由定时清理任务删除。
- 图片、视频、音频和 base64 大数据一律不写入数据库。

## 6. API 契约

### 6.1 统一响应结构

成功：

```json
{ "data": { } }
```

分页列表：

```json
{ "data": { "items": [], "total": 0, "page": 1, "pageSize": 20 } }
```

失败（HTTP 状态码同时具备语义）：

```json
{ "error": { "code": "MODEL_UNAVAILABLE", "message": "模型已停用", "details": { } } }
```

- `code` 为稳定错误代码，前端只依据 `code` 选择本地化文案，不解析 `message`。
- `message` 仅用于日志和管理员排查，不直接展示第三方原始错误。
- `details` 可选，用于携带限制值，例如 `{ "maxSizeMb": 20 }`。

### 6.2 用户接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | 邮箱密码注册 |
| POST | `/api/v1/auth/login` | 登录并下发会话 Cookie |
| POST | `/api/v1/auth/logout` | 退出登录 |
| GET | `/api/v1/auth/me` | 当前用户，用于登录状态恢复 |
| GET | `/api/v1/models` | 已启用模型（脱敏），含展示名称、能力、参数范围和文件限制 |
| POST | `/api/v1/projects` | 登记画布项目，按 `id` 幂等 upsert |
| GET | `/api/v1/projects/{id}` | 确认项目存在 |
| PATCH | `/api/v1/projects/{id}` | 重命名，同步名称 |
| DELETE | `/api/v1/projects/{id}` | 软删除，保留历史用量和名称快照 |
| POST | `/api/v1/uploads/presign` | 申请限时上传地址 |
| POST | `/api/v1/uploads/{id}/complete` | 确认上传完成 |
| POST | `/api/v1/generations` | 创建生成任务 |
| GET | `/api/v1/generations/{id}` | 查询任务状态与结果 |
| POST | `/api/v1/generations/{id}/cancel` | 取消任务 |

`GET /api/v1/models` 返回示例（不含任何供应商信息）：

```json
{
  "data": {
    "items": [
      {
        "id": "mdl_01",
        "displayName": "GPT Image 1",
        "capability": "image",
        "isDefault": true,
        "params": { "size": { "type": "enum", "values": ["1024x1024", "1536x1024"], "default": "1024x1024" } },
        "fileLimits": { "image": { "maxCount": 9, "maxSizeMb": 20 } },
        "maxOutputCount": 4
      }
    ]
  }
}
```

`POST /api/v1/generations` 请求体：

```json
{
  "requestId": "req_xxx",
  "modelId": "mdl_01",
  "capability": "image",
  "source": "canvas",
  "projectId": "prj_xxx",
  "projectName": "未命名画布",
  "nodeId": "node_xxx",
  "prompt": "用户原文提示词",
  "params": { "size": "1024x1024", "count": 1 },
  "fileIds": ["upl_xxx"]
}
```

- `source` 取值：`canvas`、`image_workbench`、`video_workbench`、`other`。
- `requestId` 由前端生成并在同一用户下唯一；重复提交返回同一任务，不重复创建任务、不重复计费。
- `capability` 取值：`text`、`image`、`video`、`audio`。
- 画布调用必须携带 `projectId` 与 `nodeId`；工作台调用允许 `projectId` 为空。

任务查询响应：

```json
{
  "data": {
    "id": "job_xxx",
    "status": "succeeded",
    "capability": "image",
    "createdAt": "...",
    "startedAt": "...",
    "finishedAt": "...",
    "result": { "files": [{ "url": "https://...", "mimeType": "image/png" }], "text": null },
    "errorCode": null
  }
}
```

### 6.3 管理接口

统一前缀 `/api/v1/admin`，全部校验 `admin` 角色。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/overview` | 用量与金额概览 |
| GET | `/admin/users` | 用户列表，支持邮箱搜索 |
| PATCH | `/admin/users/{id}/status` | 启用或停用 |
| GET | `/admin/users/{id}/projects` | 用户项目列表与累计 Token、金额 |
| GET | `/admin/usage` | 调用明细，支持用户、项目、模型、能力、状态、时间和 `usageSource` 筛选 |
| GET | `/admin/usage/export.csv` | 导出不含提示词正文的用量 CSV |
| GET | `/admin/prompts` | 提示词查看与关键词搜索，写入审计日志 |
| GET | `/admin/audit-logs` | 管理员操作与提示词查看审计 |
| GET/POST/PATCH/DELETE | `/admin/providers` | 渠道与密钥管理，响应只返回密钥掩码 |
| GET/POST/PATCH/DELETE | `/admin/models` | 模型、能力、参数范围、文件限制和并发 |
| GET/POST | `/admin/models/{id}/prices` | 价格规则与生效时间 |
| GET/PATCH | `/admin/settings` | 是否开放自助注册等 |

## 7. 任务状态与错误代码

### 7.1 任务状态

| 状态 | 含义 |
| --- | --- |
| `queued` | 已创建，等待执行；计入并发 |
| `running` | 正在调用供应商 |
| `succeeded` | 成功并完成结算 |
| `failed` | 失败，可能已结算也可能无费用 |
| `cancelled` | 用户取消，释放并发名额 |

第一阶段任务在 API 进程内异步执行，状态写入数据库，前端通过 `GET /api/v1/generations/{id}` 轮询，不引入队列中间件和 WebSocket。

### 7.2 错误代码

| 错误代码 | HTTP | 含义 |
| --- | ---: | --- |
| `VALIDATION_FAILED` | 400 | 请求参数不合法 |
| `AUTH_REQUIRED` | 401 | 未登录或会话过期 |
| `INVALID_CREDENTIALS` | 401 | 邮箱或密码错误 |
| `EMAIL_ALREADY_EXISTS` | 409 | 邮箱已注册 |
| `REGISTRATION_CLOSED` | 403 | 已关闭自助注册 |
| `ACCOUNT_DISABLED` | 403 | 账号已停用 |
| `FORBIDDEN` | 403 | 无权访问该资源或管理接口 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `DUPLICATE_REQUEST` | 409 | `requestId` 重复，返回已存在任务 |
| `JOB_NOT_CANCELABLE` | 409 | 任务已结束，无法取消 |
| `CONCURRENCY_LIMIT` | 429 | 用户同时运行任务过多 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `FILE_TOO_LARGE` | 413 | 文件超过大小限制，`details` 返回允许值 |
| `FILE_TYPE_NOT_ALLOWED` | 415 | 文件类型不支持 |
| `FILE_COUNT_EXCEEDED` | 400 | 文件数量超限 |
| `MODEL_UNAVAILABLE` | 409 | 模型停用或不可用 |
| `PROVIDER_ERROR` | 502 | 供应商返回错误，已转换为稳定代码 |
| `PROVIDER_TIMEOUT` | 504 | 供应商超时 |
| `SERVICE_BUSY` | 503 | 达到模型全局并发，稍后重试 |
| `INTERNAL_ERROR` | 500 | 未预期错误 |

前端按当前语言渲染中文或日语文案；供应商原始错误信息和密钥不下发给用户。

## 8. 环境变量清单

### server

| 变量 | 必填 | 示例 | 说明 |
| --- | :---: | --- | --- |
| `PORT` | 否 | `8787` | 服务监听端口 |
| `NODE_ENV` | 否 | `production` | 影响 Cookie `Secure` 和日志级别 |
| `DATABASE_URL` | 是 | `postgresql://ic:ic@db:5432/infinite_canvas` | PostgreSQL 连接串 |
| `SESSION_COOKIE_NAME` | 否 | `ic_session` | 会话 Cookie 名 |
| `SESSION_TTL_DAYS` | 否 | `30` | 会话有效期 |
| `SECRET_ENCRYPTION_KEY` | 是 | 32 字节 base64 | 渠道密钥 AES-256-GCM 主密钥 |
| `ADMIN_EMAIL` | 是 | `admin@example.com` | 初始管理员邮箱，seed 使用 |
| `ADMIN_PASSWORD` | 是 | - | 初始管理员密码，seed 后应立即修改 |
| `REGISTRATION_OPEN` | 否 | `true` | 自助注册初始值，之后以数据库设置为准 |
| `S3_ENDPOINT` | 是 | `http://minio:9000` | 对象存储地址 |
| `S3_REGION` | 是 | `us-east-1` | 区域 |
| `S3_BUCKET` | 是 | `infinite-canvas` | 存储桶 |
| `S3_ACCESS_KEY_ID` | 是 | - | 访问密钥 |
| `S3_SECRET_ACCESS_KEY` | 是 | - | 访问密钥 |
| `S3_FORCE_PATH_STYLE` | 否 | `true` | MinIO 需要开启 |
| `S3_PUBLIC_BASE_URL` | 否 | `https://cdn.example.com` | 生成对外可访问地址 |
| `UPLOAD_URL_TTL_SECONDS` | 否 | `300` | 预签名有效期 |
| `TEMP_FILE_TTL_HOURS` | 否 | `24` | 临时文件保留时间 |
| `USER_MAX_CONCURRENT_JOBS` | 否 | `2` | 用户并发上限默认值 |
| `USER_MAX_CONCURRENT_VIDEO_JOBS` | 否 | `1` | 用户视频并发上限 |
| `PROVIDER_TIMEOUT_MS` | 否 | `120000` | 供应商请求超时 |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |

### web

| 变量 | 必填 | 说明 |
| --- | :---: | --- |
| `VITE_API_BASE_URL` | 否 | 默认空，走同源 `/api`；跨域部署时填写完整地址 |

渠道 Base URL、API Key、API Version 和 Deployment Name 全部通过管理后台写入数据库，不再作为环境变量或前端配置存在。

## 9. 本地开发启动方式

1. 启动依赖服务：

```bash
docker compose -f docker-compose.dev.yml up -d
```

该文件只包含 `postgres` 和 `minio`，用于本地开发。

2. 初始化后台：

```bash
cd server && cp .env.example .env && bun install && bunx prisma migrate dev && bunx prisma db seed
```

3. 启动后台：

```bash
cd server && bun run dev
```

4. 启动前端（Vite 已将 `/api` 代理到 `http://localhost:8787`）：

```bash
cd web && bun run dev
```

按 AGENTS.md 约定，开发过程中不由 AI 执行构建和测试命令，上述命令供人工执行。

## 10. 分阶段落地顺序

与用户确认的阶段一致，本方案对应的编码顺序为：用户与管理员 → 渠道模型价格 → 画布项目登记 → 生成网关（文本、图片、音频、视频） → Token 与成本 → 文件与对象存储 → 前端完整接入 → 管理后台 → 清理与部署准备。

迁移期间前端保留浏览器直连供应商路径，直到后台对应能力可用后再逐项删除，确保 Azure OpenAI 支持和中日多语言不被破坏。

## 11. 待确认项

- [x] 登录方式采用邮箱 + 密码，不接入 SMTP 验证码。
- [x] 后台技术栈确认为 Node.js + TypeScript + Express 5 + Prisma + PostgreSQL。
- [x] 部署形态确认为 nginx 静态前端 + 独立 Node API 服务 + PostgreSQL + S3 兼容存储。
- [x] 生成任务第一阶段在 API 进程内异步执行并由前端轮询，不引入队列。
- [x] 初始管理员由 seed 脚本按环境变量创建，而非首个注册用户自动提权。
- [ ] 对象存储生产环境使用哪家 S3 兼容服务（S3 / R2 / 阿里云 OSS 兼容模式）；第七阶段前确认即可。

## 12. 实际落地进度

- 第二阶段：`server/` 目录结构、统一响应与错误代码、会话 Cookie 认证、`users` / `sessions` / `app_settings` 三表、`/api/v1/auth/*` 与 `/api/v1/admin/users` 接口。
- 第三阶段：`providers` / `models` / `model_prices` / `admin_audit_logs` 四表，渠道密钥 AES-256-GCM 加密，模型能力、参数范围、文件限制和并发配置，价格规则与生效时间，`/api/v1/admin/providers`、`/api/v1/admin/models`、`/api/v1/models` 接口。

- 第六阶段：`ai_usage_records` 表与 `UsageSource` 枚举，Token 归一化与 tokenizer 估算，价格快照与 `Decimal(18,8)` 金额结算，`/api/v1/admin/overview`、`/api/v1/admin/usage`（含 `export.csv`、`summary`）、`/api/v1/admin/users/{id}`、`/api/v1/admin/users/{id}/projects`、`/api/v1/admin/prompts` 接口。价格规则的 `unit_prices` 在原有字段基础上增加 `perImageByVariant`（按「尺寸」或「尺寸:质量」区分）和 `perVideoSecondByResolution`。

第四阶段起按第 10 节顺序继续补齐数据表和接口。

当前 `server/.env.example` 只包含已实现能力所需的变量：`SECRET_ENCRYPTION_KEY` 已随第三阶段补入，`S3_*` 等变量随第七阶段实现时再补。

部署和初始化步骤见 [云端版部署与初始化说明](../cloud-deploy.md)。
