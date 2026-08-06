# 云端版最小后台

状态：需求草案，待补充和确认

## 1. 背景

Infinite Canvas 将部署为可供外部用户使用的云端产品。当前浏览器保存 API Key、直接请求 AI 服务，不适合公开运营。

本需求先设计一个最小可用后台，负责用户身份、模型与密钥、AI 请求代理、调用记录、Token 统计、成本核算、文件限制、并发保护和管理员查询。

技术栈、目录结构、数据库表、认证方式、对象存储、API 路径、统一响应结构、错误代码、环境变量和本地开发方式见 [云端版后台技术方案与接口契约](cloud-backend-tech.md)。本文件继续维护需求范围和验收标准。

## 2. 目标

- 用户登录后才能使用 AI 生成功能。
- AI 服务密钥只保存在后台，任何接口都不得返回给浏览器。
- 后台记录每次 AI 调用使用的用户、画布项目、模型、Token、计费单位和金额。
- 后台可以汇总每个用户的总金额，以及每个画布项目内的 AI 使用明细和总金额。
- 图片、视频、音频等不按 Token 计费的模型也能记录真实计费依据和金额。
- 管理员可以按用户、项目、模型、能力和时间查看用量与成本。
- 第一阶段不做单次生成数量限制。

## 3. 用户与权限

### 3.1 角色

- `user`：普通用户，只能使用自己的账号、项目和生成任务。
- `admin`：管理员，可以管理用户、模型、渠道、价格规则，并查看用量和成本。

### 3.2 登录方式

建议第一阶段使用邮箱验证码登录：

1. 用户输入邮箱。
2. 后台发送一次性验证码。
3. 验证成功后创建或登录账号。
4. 前端获得短期访问凭证和可续期会话。

建议优先使用成熟的托管身份服务，不自行实现密码加密、找回密码和邮件安全机制。

### 3.3 注册范围

草案默认允许邮箱自助注册。后台保留关闭注册的开关，关闭后只有管理员创建或邀请的账号可以登录。

## 4. AI 用量与金额统计

### 4.1 每次调用必须记录

- 调用 ID 和防重复请求 ID。
- 用户 ID。
- 画布项目 ID；非画布工作台调用允许为空。
- 调用来源：画布、图片工作台、视频工作台或其他入口。
- 渠道、模型 ID、模型实际调用名称和展示名称。
- 能力类型：图片、视频、文本或音频。
- 任务状态和第三方请求 ID。
- 请求时间、开始时间、完成时间和耗时。
- 用户提交的提示词；用于管理员分析常用关键词和优化产品。
- 输入 Token、缓存 Token、输出 Token、推理 Token和总 Token。
- 图片张数、图片尺寸与质量。
- 视频数量、时长、分辨率与是否包含音频。
- 音频时长、格式和语音模型。
- 本次使用的价格规则快照。
- 本次美元金额。
- 失败代码和是否产生供应商费用。

参考文件和生成内容不写入用量表。提示词属于允许管理员查看的运营数据，但必须在隐私说明中提前告知用户，并限制为管理员权限。

### 4.2 Token 记录规则

- 文本模型优先读取供应商响应中的 `usage` 数据。
- 支持分别记录输入、缓存、输出、推理和总 Token。
- 供应商没有返回 Token 时，由后台按该模型对应的 tokenizer 估算；没有精确 tokenizer 时使用兼容模型的 tokenizer。
- 供应商原始数据记录为 `usage_source = provider`，估算数据记录为 `usage_source = estimated`，两者必须能够分别筛选和汇总。
- 估算记录同时保存估算方法、使用的 tokenizer 及版本，不能把估算值伪装成供应商真实数据。
- Token 估算只在后台进行，不能信任前端上报的 Token。
- 图片、视频和音频模型即使没有 Token，也必须记录其实际计费单位和金额。

### 4.3 金额计算规则

每个后台模型配置自己的价格规则。建议支持以下计费方式：

- 每百万输入 Token。
- 每百万缓存 Token。
- 每百万输出 Token。
- 每百万推理 Token。
- 每张图片，或按尺寸、质量区分图片价格。
- 每个视频，或按秒数、分辨率区分视频价格。
- 每分钟或每百万字符的音频价格。
- 固定每次调用价格。

金额计算要求：

1. 任务执行时复制一份价格规则快照，后续修改模型价格不能改变历史金额。
2. 金额使用数据库高精度小数，不能使用浮点数直接累计。
3. 模型单价、每次调用金额和所有汇总金额统一使用美元，不设计日元换算。
4. 供应商返回美元实际费用时优先保存实际费用；否则按价格规则和实际或估算用量计算。
5. 失败或取消任务是否产生费用，以供应商实际响应或对应价格规则为准。
6. 每条明细保存计算过程，管理员可以追溯金额来源。

### 4.4 用户总金额

管理员可以查看：

- 用户历史累计金额。
- 今日、本月和自定义时间范围金额。
- 各模型金额和 Token。
- 图片、视频、文本、音频各自金额。
- 成功、失败、取消任务的金额。

用户总金额以已完成结算的调用明细汇总，不在用户表中维护一个不可追溯的手工数字。为提高查询速度，可以增加可重新计算的统计汇总表。

### 4.5 画布项目明细

从无限画布发起的每次 AI 请求必须携带稳定的 `project_id`。

管理员查看路径建议为：

```text
用户
  -> 画布项目
    -> AI 调用明细
```

每个项目显示：

- 项目 ID 和项目名称快照。
- 创建时间和最近一次 AI 调用时间。
- 调用次数、成功次数和失败次数。
- 输入、缓存、输出、推理和总 Token。
- 图片、视频、文本、音频调用数量。
- 项目累计金额。
- 每次调用的模型、状态、Token、计费单位、金额和时间。

项目名称可能被用户修改，因此用量明细同时保存稳定项目 ID和调用时的项目名称快照。金额归属始终以项目 ID 为准。

### 4.6 非画布工作台调用

图片工作台和视频工作台当前不一定属于某个无限画布项目，第一阶段记录：

- `project_id = null`
- `source = image_workbench` 或 `video_workbench`

后台将这些调用归入用户级“独立工作台”分组。未来如果工作台也引入项目概念，再补充对应项目 ID。

## 5. 文件限制

文件限制用于保护上传服务和 AI 接口。

### 5.1 草案默认值

| 文件类型 | 单个文件上限 | 单次数量上限 |
| --- | ---: | ---: |
| 图片 | 20 MB | 9 个 |
| 视频 | 200 MB | 3 个 |
| 音频 | 20 MB | 3 个 |
| 单次请求总量 | 250 MB | - |

后台应按 MIME 类型、扩展名和实际文件内容做基础校验。模型存在更严格限制时，以模型限制为准。

### 5.2 上传方式

- 大文件不经过普通 JSON 请求传输。
- 前端向后台申请限时上传地址，直接上传到对象存储。
- 上传地址只能用于指定用户、指定文件类型和指定大小。
- 未被任务使用的临时上传文件自动过期清理。
- 第一阶段建议临时文件和生成结果保留 24 小时；画布长期云存储另行设计。

## 6. 并发保护

并发限制仅用于保护服务稳定性。

- 每个普通用户最多同时运行 2 个生成任务。
- 其中最多同时运行 1 个视频任务。
- 排队中的任务计入并发数量。
- 用户主动取消后释放并发名额。
- 后台可以为每个模型设置全局最大并发数。
- 达到全局并发时，第一阶段直接返回“服务繁忙”，不实现复杂排队系统。
- 同一请求携带唯一请求 ID，重复提交不能重复创建任务或重复记录金额。

## 7. 模型与渠道管理

### 7.1 后台保存

- 渠道名称和协议类型。
- Base URL、API Key、API Version、Deployment Name 等密钥配置。
- 模型实际调用名称和用户可见名称。
- 模型支持能力：图片、视频、文本、音频。
- 模型是否启用、是否为默认模型。
- 文件限制、并发限制和参数范围。
- Token、图片、视频、音频或固定调用价格规则。
- 价格生效时间和币种。

密钥存入后台密钥服务或加密存储，不记录到普通日志，不通过模型列表接口返回。

### 7.2 普通用户前端获得

- 模型 ID。
- 展示名称。
- 支持能力。
- 可调整参数和范围。
- 模型自身支持的生成数量和文件限制。

普通用户不能新增渠道、编辑 Base URL、查看 API Key、查看成本价格或上传模型调用脚本。

## 8. AI 请求流程

```text
用户登录
  -> 前端读取可用模型
  -> 前端上传参考文件
  -> 前端提交用户、项目和模型信息
  -> 后台检查身份、模型、文件和并发
  -> 后台创建调用明细并请求 AI 服务
  -> 后台读取 Token 或其他计费单位
  -> 后台按价格快照结算金额
  -> 前端轮询或订阅任务状态
  -> 后台返回生成结果
```

后台统一任务状态：

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

## 9. 管理后台

### 9.1 概览

- 用户总数和活跃用户数。
- 今日、本月和自定义时间范围的调用次数、Token 和金额。
- 成功、失败和取消任务数。
- 当前运行任务数。
- 按图片、视频、文本、音频分类的用量和金额。
- 按模型分类的 Token、计费单位和金额。

### 9.2 用户管理

- 按邮箱搜索用户。
- 查看角色、账号状态、累计金额、近期金额和最近活跃时间。
- 查看用户按模型和能力分类的用量。
- 查看该用户所有画布项目的调用次数、Token 和金额。
- 进入项目查看每次 AI 调用明细。
- 停用或恢复账号。

### 9.3 调用明细

- 按用户、项目、模型、能力、状态和时间筛选。
- 显示 Token 明细、其他计费单位、价格快照和金额计算过程。
- 显示用户提交的提示词，并支持按提示词关键词搜索。
- 区分供应商返回 Token 和后台估算 Token。
- 显示第三方请求 ID、耗时和错误摘要。
- 支持导出不包含提示词正文的用量与金额 CSV，方便后续核对供应商账单。

所有管理员都可以查看用户提示词，用于分析常用关键词和优化产品，不再设置独立的“内容分析”权限。参考文件和生成内容默认不能查看。第一阶段不提供提示词批量导出；每次查看提示词都必须记录管理员、时间和查看范围。

### 9.4 系统设置

- 开放或关闭自助注册。
- 管理渠道和密钥。
- 管理模型、能力、参数范围和并发保护。
- 管理以美元计价的模型价格规则和生效时间。

## 10. 错误提示

后台返回稳定错误代码，前端根据当前语言显示中文或日语，不直接判断错误字符串。

| 错误代码 | 用户提示含义 |
| --- | --- |
| `AUTH_REQUIRED` | 请先登录后再使用生成功能 |
| `ACCOUNT_DISABLED` | 当前账号已停用，请联系管理员 |
| `CONCURRENCY_LIMIT` | 当前运行任务过多，请等待任务完成 |
| `FILE_TOO_LARGE` | 文件超过大小限制，并显示允许值 |
| `FILE_TYPE_NOT_ALLOWED` | 当前文件类型不支持 |
| `MODEL_UNAVAILABLE` | 模型已停用或当前不可用 |
| `SERVICE_BUSY` | 服务当前繁忙，请稍后重试 |

## 11. 最小数据结构

### `users`

- `id`
- `email`
- `role`
- `status`
- `concurrency_limit`
- `created_at`
- `last_active_at`

### `projects`

- `id`
- `user_id`
- `name`
- `created_at`
- `updated_at`

第一阶段即使画布正文仍保存在浏览器，后台也需要保存最小项目记录，用于关联 AI 调用。

### `providers`

- `id`
- `name`
- `api_format`
- 加密后的渠道配置
- `enabled`

### `models`

- `id`
- `provider_id`
- `display_name`
- `remote_name`
- `capabilities`
- 参数与文件限制
- `enabled`

### `model_prices`

- `id`
- `model_id`
- `currency`，第一阶段固定为 `USD`
- `pricing_type`
- 各类 Token 或媒体计费单价
- `effective_from`
- `effective_to`

### `generation_jobs`

- `id`
- `request_id`
- `provider_request_id`
- `user_id`
- `project_id`
- `project_name_snapshot`
- `source`
- `model_id`
- `capability`
- `prompt_text`
- `status`
- `error_code`
- `created_at`
- `started_at`
- `finished_at`

### `ai_usage_records`

- `id`
- `job_id`
- `user_id`
- `project_id`
- `model_id`
- `price_snapshot`
- `input_tokens`
- `cached_tokens`
- `output_tokens`
- `reasoning_tokens`
- `total_tokens`
- 图片、视频和音频计费单位
- `usage_source`
- `usage_estimation_method`
- `tokenizer_name`
- `tokenizer_version`
- `amount_usd`
- `original_currency`
- `original_amount`
- `reporting_currency`
- `reporting_amount`
- `calculation_detail`
- `created_at`

### `uploads`

- `id`
- `user_id`
- `storage_key`
- `mime_type`
- `size`
- `expires_at`
- `created_at`

## 12. 最小接口范围

### 用户接口

- 登录、退出和刷新会话。
- 获取当前用户。
- 获取可用模型与参数限制。
- 创建或登记画布项目。
- 申请文件上传地址。
- 创建生成任务，并提交 `project_id` 和调用来源。
- 查询或取消生成任务。

### 管理接口

- 获取后台用量和金额概览。
- 查询、停用和恢复用户。
- 查询用户、项目和调用明细。
- 按模型、能力和时间汇总 Token 与金额。
- 管理渠道、密钥、模型和价格规则。
- 导出调用明细 CSV。

## 13. 安全与准确性要求

- 所有 AI 请求必须经过后台，前端不得获得渠道密钥。
- 所有用户和管理接口必须校验身份；管理接口和提示词接口必须校验 `admin` 角色。
- API Key、邮箱验证码和访问凭证不得写入普通日志。
- 金额使用高精度小数，价格规则必须保存历史快照。
- 同一 `request_id` 只能创建一个任务和一条结算记录。
- 后台不能信任前端提交的 Token、价格或金额。
- 管理员修改模型价格必须记录操作日志。
- 管理员查看用户提示词必须记录审计日志；第一阶段禁止批量导出提示词。
- 用户提示词可能包含隐私或敏感信息，前端隐私说明必须明确其会被保存并供管理员用于产品优化。
- 管理员用量页面不得展示参考文件和生成内容。
- 提示词与成本结算记录长期保存，不设置自动到期时间；如未来调整，应先更新隐私政策和数据清理规则。

## 14. 暂不处理

- 单次生成数量的产品级限制；只遵循模型或供应商自身限制。
- 按供应商正式账单自动对账。
- 提示词自动内容审核和关键词自动分类。
- 参考文件和生成内容的后台查看与审核。
- 画布、素材和历史记录的完整云端同步。
- 复杂任务队列、优先级和自动扩缩容。

## 15. 待确认项

- [ ] 使用邮箱验证码登录，还是邮箱密码登录。技术方案默认邮箱密码登录，避免依赖 SMTP。
- [ ] 是否开放用户自助注册。技术方案默认开放，并保留后台开关。
- [ ] 图片、视频和音频的价格规则由管理员手动录入，还是同步供应商价格。
- [ ] 图片和视频工作台调用是否保持“独立工作台”分组。
- [ ] 临时上传文件和生成结果保留 24 小时是否合适。
- [ ] 第一阶段画布和素材继续保存在浏览器，还是同步纳入云端存储改造。

## 16. 实施记录

### 第一阶段：后台方案和接口契约

- 新增 [云端版后台技术方案与接口契约](cloud-backend-tech.md)，确定技术栈、仓库结构、部署拓扑、数据库表、认证方式、对象存储流程、API 路径、统一响应结构、任务状态、错误代码、环境变量清单和本地开发启动方式。
- 选型结论：Node.js 20 + TypeScript + Express 5 + zod + Prisma + PostgreSQL 16；邮箱密码登录配服务端会话 Cookie；S3 兼容对象存储；nginx 静态前端反向代理独立 Node API 服务。
- 统一响应结构为成功 `{ "data": ... }`、失败 `{ "error": { "code", "message", "details" } }`，前端只依据稳定 `code` 选择中日文案。
- 任务状态统一为 `queued`、`running`、`succeeded`、`failed`、`cancelled`，第一阶段在 API 进程内异步执行并由前端轮询。
- 本阶段只更新文档，未新增后台代码，未改动前端和现有 Azure OpenAI 能力。
- 涉及文件：`doc/tasks/cloud-backend-tech.md`（新增）、`doc/tasks/cloud-backend.md`、`doc/README.md`。
- 数据库与接口变化：暂无实际变更，仅确定设计；实际建表随第二阶段的 Prisma 迁移落地。

### 第二阶段：用户和管理员

- 新增 `server/` 后台服务：Express 5 + zod + Prisma + PostgreSQL，统一响应结构和稳定错误代码已落地。
- 数据库新增 `users`、`sessions`、`app_settings` 三张表（Prisma schema，迁移随首次 `prisma migrate dev` 生成）。
- 实现注册、登录、退出、当前用户、注册开关查询接口，会话使用 HttpOnly Cookie + 数据库令牌哈希，支持滑动续期。
- 实现管理员用户列表（邮箱搜索、分页）和启用/停用；停用时同步撤销该用户全部会话，且禁止停用当前登录的管理员账号。
- 管理接口统一经过 `requireUser` + `requireAdmin` 校验。
- 初始管理员由 `prisma/seed.ts` 按 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 创建。
- 新增接口：`POST /api/v1/auth/register`、`POST /api/v1/auth/login`、`POST /api/v1/auth/logout`、`GET /api/v1/auth/me`、`GET /api/v1/auth/registration`、`GET /api/v1/admin/users`、`PATCH /api/v1/admin/users/{id}/status`、`GET /api/v1/health`。
- 部署改动：`nginx.conf` 增加 `/api` 反向代理（变量 + Docker DNS 延迟解析，后台缺失时不影响前端容器启动），`docker-compose.yml` 增加 `server` 与 `db` 服务，新增 `docker-compose.dev.yml` 提供本地 PostgreSQL。
- 涉及文件：`server/**`（新增）、`docker-compose.yml`、`docker-compose.dev.yml`、`nginx.conf`。

### 第三阶段：渠道、模型和价格

- 数据库新增 `providers`、`models`、`model_prices`、`admin_audit_logs` 四张表，并新增 `ApiFormat`、`ModelCapability`、`PricingType` 枚举。
- 渠道 API Key 使用 AES-256-GCM 加密落库，主密钥来自新增环境变量 `SECRET_ENCRYPTION_KEY`；管理接口只返回末 4 位掩码，更新时不提交 API Key 即保留原值。
- 模型支持能力分类、用户可调参数定义、文件限制、单次生成数量、全局并发上限、启用状态、默认模型和排序；同一能力下只保留一个默认模型。
- 价格规则按生效时间保存，单价统一用字符串保存以保持精度，币种固定 USD；改价一律新增记录，已生效规则不可删除，保证历史金额可追溯。
- 渠道、模型和价格的新增、修改、删除全部写入 `admin_audit_logs`。
- 仍有模型引用的渠道不允许删除，避免历史用量失去关联。
- 新增普通用户接口 `GET /api/v1/models`，只返回启用且所属渠道也启用的模型，字段限于模型 ID、展示名称、能力、默认标记、可调参数、文件限制和生成数量上限，不含渠道、Base URL、API Key、实际调用名称、并发上限和价格。
- 新增接口：`GET/POST/PATCH/DELETE /api/v1/admin/providers`、`GET/POST/PATCH/DELETE /api/v1/admin/models`、`GET/POST /api/v1/admin/models/{id}/prices`、`DELETE /api/v1/admin/models/{modelId}/prices/{priceId}`、`GET /api/v1/models`。
- 本阶段只做后台接口，未新增管理界面，管理界面在第九阶段实现；前端 AI 请求仍走浏览器本地渠道配置，未改动。
- 涉及文件：`server/prisma/schema.prisma`、`server/src/lib/crypto.ts`、`server/src/modules/audit.ts`、`server/src/modules/catalog/*`、`server/src/http/routes/admin/providers.ts`、`server/src/http/routes/admin/models.ts`、`server/src/http/routes/models.ts`、`server/src/index.ts`、`server/src/env.ts`、`server/.env.example`。

### 第四阶段：画布项目登记

- 数据库新增 `projects` 表：`id` 直接沿用前端生成的画布 ID，含 `user_id`、`name`、`deleted_at` 软删除标记，画布正文仍保存在浏览器。
- 新增接口：`POST /api/v1/projects`（按 ID 幂等 upsert，创建、导入和打开画布都调用）、`GET /api/v1/projects/{id}`、`PATCH /api/v1/projects/{id}`（重命名）、`DELETE /api/v1/projects/{id}`（软删除）。
- 所有项目接口校验归属，访问他人项目返回 `NOT_FOUND`，登记他人已占用的 ID 返回 `FORBIDDEN`。
- 删除画布只写 `deleted_at`，项目名称快照和后续用量关联全部保留。
- 前端在画布创建、导入、打开、重命名和删除时自动同步后台，失败只忽略不打断本地操作，下次打开该画布会重新登记。
- 未登录时跳过登记；刷新后画布可能早于会话恢复完成，登记前会先等待一次会话恢复，避免漏登记。
- 实测：创建画布自动落库、重命名同步、删除后名称快照保留且标记软删除。
- 涉及文件：`server/prisma/schema.prisma`、`server/src/http/routes/projects.ts`、`server/src/index.ts`、`web/src/services/api/projects.ts`、`web/src/stores/canvas/use-canvas-store.ts`。
- 说明：画布 AI 请求携带 `project_id` 和 `node_id` 需要等生成网关就绪，随第五、第八阶段落地；画布节点 ID 当前已稳定持久化，可直接使用。

### 第五阶段（进行中）：AI 生成网关 — 文本

- 数据库新增 `generation_jobs` 表和 `JobStatus`、`JobSource` 枚举；`(user_id, request_id)` 唯一约束在数据库层保证防重复，同一 `request_id` 重复提交返回已存在任务。
- 新增接口：`POST /api/v1/generations`、`GET /api/v1/generations/{id}`、`POST /api/v1/generations/{id}/cancel`。
- 统一任务编排：并发保护（用户 2 个、视频额外限 1 个、模型级 `maxConcurrency` 返回 `SERVICE_BUSY`，排队任务计入名额）、取消（中断供应商请求且不被后到的结果覆盖）、超时（默认 120 秒转 `PROVIDER_TIMEOUT`）、供应商错误转稳定代码（原文只写入 `error_detail` 供管理员排查）。
- 重试边界：不做自动重试。生成请求不可安全重放，重试可能产生重复费用，失败一律回传错误代码由用户决定是否重发。
- 服务重启兜底：启动时把残留的 `queued` / `running` 任务标记为失败，避免并发名额永久泄漏。
- Azure OpenAI 适配与前端 `buildModelApiUrl` 保持一致：`{endpoint}/openai/v1{path}?api-version=`，请求头使用 `api-key`，文本走 Responses 接口；OpenAI 兼容渠道使用 `{base}/v1{path}` 与 Bearer。
- 画布调用强制携带 `projectId`，任务同时保存 `node_id`、`project_name_snapshot` 和提示词原文。
- 尚未接入的图片、音频、视频能力会创建任务但立即以 `MODEL_UNAVAILABLE` 结束，不会静默挂起。
- seed 支持按环境变量引导初始渠道：`AZURE_OPENAI_ENDPOINT`、`AZURE_OPENAI_API_KEY`、`AZURE_OPENAI_DEPLOYMENT`（逗号分隔，格式 `部署名:能力`）、`AZURE_OPENAI_API_VERSION`；密钥加密后写入数据库，重复执行只更新不重复创建。
- 修复：删除已有调用记录的模型改为返回 `VALIDATION_FAILED` 并提示改用停用，不再抛出外键错误的 `INTERNAL_ERROR`。
- 实测（真实 Azure OpenAI 渠道）：文本生成成功返回、重复 `requestId` 幂等、取消后状态不被覆盖、重复取消返回 `JOB_NOT_CANCELABLE`、未接入能力返回 `MODEL_UNAVAILABLE`、模型列表不泄漏 Base URL 与部署名、渠道接口只返回密钥掩码。
- 待办：音频生成、视频生成与任务轮询；Token 与金额记录属于第六阶段。

### 第七阶段（提前实施）：文件与对象存储

图片生成的结果本身就是二进制，若不先接对象存储只能把 base64 写进数据库，与需求冲突，因此把第七阶段提前到图片能力之前实施。

- 数据库新增 `uploads` 表和 `UploadStatus` 枚举，只存元数据，文件本体在对象存储。
- 新增接口：`GET /api/v1/uploads/limits`、`POST /api/v1/uploads/presign`、`POST /api/v1/uploads/{id}/complete`。
- 上传流程：后台按类型和大小校验后签发 5 分钟限时 `PUT` 地址，浏览器直传对象存储，完成后由后台按对象存储中的**真实**大小和类型复核，不信任前端声明。
- 文件限制默认值：图片 20 MB / 9 个，视频 200 MB / 3 个，音频 20 MB / 3 个；类型按 MIME 前缀判定，其余一律 `FILE_TYPE_NOT_ALLOWED`。
- 生成请求只提交 `fileIds`，后台校验归属、状态与数量后才执行。
- 生成结果写入对象存储，任务表只保存 `storageKey`；每次查询任务时重新签发限时下载地址，避免地址过期后拿不到结果。
- 新增 `cleanupExpiredUploads`，清理超时仍未完成上传的临时记录。
- 环境变量新增 `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_FORCE_PATH_STYLE`、`UPLOAD_URL_TTL_SECONDS`、`DOWNLOAD_URL_TTL_SECONDS`、`TEMP_FILE_TTL_HOURS`。
- 涉及文件：`server/src/modules/storage/s3.ts`、`server/src/modules/storage/uploads.ts`、`server/src/http/routes/uploads.ts`。

### 第五阶段（进行中）：AI 生成网关 — 图片

- 实现文生图与图片编辑：请求带 `fileIds` 时走 `/images/edits`（multipart，单图用 `image`、多图用 `image[]`），否则走 `/images/generations`。
- 供应商返回 base64 或临时 URL 都统一取成二进制后写入对象存储，前端只拿到限时下载地址。
- 参考文件目前只对图片能力开放，其他能力提交 `fileIds` 返回 `VALIDATION_FAILED`。
- 实测（真实 Azure OpenAI）：文生图返回 1024×1024 PNG 并正确落入对象存储；浏览器直传参考图后做图片编辑，成功返回保持原场景且按提示词修改的结果；超大文件返回 `FILE_TOO_LARGE`、非图音视频类型返回 `FILE_TYPE_NOT_ALLOWED`。
- 涉及文件：`server/prisma/schema.prisma`、`server/src/modules/generation/service.ts`、`server/src/modules/generation/providers/openai.ts`、`server/src/http/routes/generations.ts`、`server/src/http/routes/admin/models.ts`、`server/src/index.ts`、`server/src/env.ts`、`server/prisma/seed.ts`、`server/.env.example`。

### 第六阶段：用量、金额与管理查询

- 数据库新增 `ai_usage_records` 表和 `UsageSource` 枚举（`provider` / `estimated` / `none`）；`job_id` 唯一，重复结算直接返回既有记录，同一任务不会重复计费。
- Token 归一化同时兼容 Responses 接口的 `input_tokens` / `output_tokens` 和 Chat Completions 的 `prompt_tokens` / `completion_tokens`，并分别读取缓存 Token 与推理 Token。
- 供应商没有返回用量时由后台用 tokenizer 估算（`js-tiktoken`，模型无精确对应关系时退回 `o200k_base`），记录 `usage_source = estimated`、估算方法、tokenizer 名称和版本，不伪装成供应商数据；估算只在后台进行，不接受前端上报。
- 金额全程使用数据库高精度小数（`Decimal(18,8)`）和 Decimal 运算，不用浮点数累计；金额一律以字符串下发，避免 JSON 浮点丢精度。
- 计费方式：每百万输入 / 缓存 / 输出 / 推理 Token、每张图片（支持按「尺寸」或「尺寸:质量」区分单价）、每个视频与每秒（支持按分辨率区分）、每分钟或每百万字符音频、固定每次调用费。缓存 Token 属于输入 Token 的一部分、推理 Token 属于输出 Token 的一部分：配置了对应单价才拆分计价，未配置时并入原价，既不漏算也不重复计费。
- 结算时把生效中的价格规则整体快照进记录，并保存逐项的单价、数量和小计；实测改价后历史金额不变。
- 失败和取消的任务同样写入金额为 0、`usage_source = none` 的记录并注明原因，管理员按状态汇总不会漏掉任何一次调用；服务重启清理残留任务时同样补记。
- 新增管理接口：`GET /api/v1/admin/overview`（用户规模、当前运行任务、今日 / 本月 / 自定义区间用量，以及按能力、状态、模型的分组汇总）、`GET /api/v1/admin/usage`（按用户、项目、模型、能力、状态、来源、`usageSource` 和时间筛选的调用明细，附当前筛选条件的合计）、`GET /api/v1/admin/usage/export.csv`、`GET /api/v1/admin/usage/summary`、`GET /api/v1/admin/users/{id}`（单用户用量画像）、`GET /api/v1/admin/users/{id}/projects`（用户 -> 画布项目一层）、`GET /api/v1/admin/prompts`（提示词查看与关键词搜索）。
- 用户列表新增累计金额、近 30 天金额和调用次数；金额只对当前页用户聚合，避免全表汇总拖慢列表。
- 提示词只在 `/admin/prompts` 分页返回，每次查看写入 `prompt.view` 审计日志（管理员、时间、关键词、筛选范围和本次可见的任务 ID）；调用明细与 CSV 导出都不含提示词正文，第一阶段不支持批量导出。
- 用户与项目的累计金额一律由 `ai_usage_records` 聚合得出，不在用户表维护无法追溯的手工数字；`project_id` 为空的调用归入「独立工作台」分组。
- 顺带修复：`req.params` 在 Express 5 类型下为 `string | string[]`，此前 `npm run build` 无法通过（Docker 镜像构建会失败），统一改用 `param(req, name)` 读取，现在 `npm run typecheck` 全绿。
- 实测（真实 Azure OpenAI 渠道）：文本调用按 Token 结算（15 输入 + 38 输出 = $0.00039875，与手算一致）；图片调用记录 `{ images, imageSize, imageQuality }` 并按张计费，变体单价缺失时回退统一单价；供应商未返回 usage 时走 tokenizer 估算并标记来源；重复结算只产生一条记录；改价后历史金额不变；超时失败与用户取消都留下金额为 0 的记录；项目维度汇总、用户列表金额、概览、CSV 导出和提示词搜索及审计日志均验证通过。
- 涉及文件：`server/prisma/schema.prisma`、`server/prisma/migrations/*_ai_usage_records/`、`server/src/modules/usage/{tokens,pricing,service,query}.ts`、`server/src/http/routes/admin/{overview,usage,prompts,users}.ts`、`server/src/modules/generation/service.ts`、`server/src/modules/catalog/schemas.ts`、`server/src/http/response.ts`、`server/src/index.ts`、`server/package.json`。
- 待办：视频与音频的计费单位需要等第五阶段接入对应能力后，在执行结果里补齐 `videoSeconds`、`audioSeconds` 等字段，价格规则和结算逻辑已就绪。

## 17. 拟实施清单

### 后台基础

- [x] 确定后台技术栈、数据库、身份服务和对象存储。
- [x] 建立用户、角色、会话和管理员鉴权。
- [x] 建立最小画布项目记录。
- [x] 建立渠道、模型、密钥和价格规则管理。

### 生成网关

- [ ] 将图片、视频、文本和音频请求迁移到后台代理。（文本已完成，图片、音频、视频待做）
- [x] 建立生成任务、状态查询和取消接口。
- [x] 建立临时文件上传和清理流程。

### 用量与成本

- [x] 读取并标准化不同供应商的 Token 和媒体计费数据。（视频、音频的媒体单位随对应能力接入补齐）
- [x] 供应商不返回 Token 时，按模型 tokenizer 在后台估算并记录估算来源。
- [x] 实现价格快照和高精度金额计算。
- [x] 实现用户、项目、模型和能力维度的汇总查询。
- [x] 实现调用明细筛选和 CSV 导出。

### 管理后台

- [x] 实现用量与金额概览。（后台接口已完成，管理界面在第九阶段）
- [x] 实现用户列表和账号状态管理。
- [x] 实现用户项目列表和项目调用明细。
- [x] 实现管理员提示词查看、关键词搜索及查看审计。
- [x] 提示词长期保存，且不支持批量导出。
- [x] 实现渠道、模型、价格和并发配置。（后台接口已完成，管理界面在第九阶段）

### 云端前端

- [x] 接入登录和当前用户信息。
- [ ] 接入后台模型列表和生成任务接口。
- [ ] 所有画布 AI 请求携带稳定 `project_id`。
- [ ] 接入稳定错误代码的中日文提示。
- [ ] 按 `cloud-frontend.md` 完成云端界面精简。

## 18. 验收标准

- 未登录用户不能提交 AI 生成任务。
- 普通用户无法从任何接口或浏览器资源中获得 API Key。
- 每次 AI 调用都能关联用户、模型、能力、状态和金额。
- 画布内调用能够关联稳定项目 ID，并按项目汇总 Token 和金额。
- 文本模型返回 Token 时能够正确记录输入、缓存、输出、推理和总 Token。
- 文本模型不返回 Token 时能够生成可追溯、明确标记的估算值。
- 图片、视频或音频不返回 Token 时仍能按实际计费单位计算金额。
- 修改模型价格后不会改变历史调用金额。
- 用户累计金额等于其已结算调用明细之和。
- 管理员可以从用户进入项目，再查看每次 AI 调用明细。
- 管理员可以按模型、能力和时间汇总 Token 与金额并导出 CSV。
- 所有管理员可以查看并按关键词搜索用户提示词，所有查看行为都有审计记录，且不能批量导出提示词。
- 管理员默认看不到参考文件和生成内容。

## 19. 下次继续（截至第六阶段）

### 当前进度一句话

后台已经能独立完成「登录 → 选模型 → 上传参考文件 → 创建生成任务 → 调用 Azure OpenAI → 结算金额 → 管理员查询」的完整链路，文本和图片两种能力已用真实渠道跑通；**前端仍在用浏览器本地渠道配置直连 AI 服务，没有走后台**。

### 待办按优先级

1. **前端切到后台生成网关**（`cloud-frontend.md` 的「AI 服务」一节）。这是当前最大的缺口：不做完，「普通用户无法获得 API Key」和「每次调用都能关联金额」两条验收标准都不成立，而且用户在前端的每一次生成目前都不产生计费记录。落地要点：
   - 模型下拉改读 `GET /api/v1/models`，删除前端渠道与密钥配置界面，关闭 `/config` 路由。
   - 生成改为 `POST /api/v1/generations` + 轮询 `GET /api/v1/generations/{id}`，画布调用必须携带 `projectId`、`nodeId` 和稳定 `requestId`（重复提交靠它幂等）。
   - 参考文件改走 `POST /api/v1/uploads/presign` → 直传对象存储 → `complete` → 提交 `fileIds`。
   - 错误提示按后台稳定错误代码映射中日文案，不判断错误字符串。
2. **第五阶段剩下的视频与音频能力**。价格规则和结算逻辑已就绪，只需在执行结果里补 `videoSeconds`、`videoResolution`、`audioSeconds` 等媒体计费单位，传给 `settleJob` 的 `media` 参数即可。
3. **第九阶段管理界面**。概览、用户与项目、调用明细、提示词搜索、渠道模型价格的后台接口都已完成，纯前端工作。

### 环境提醒

- 本地开发依赖 PostgreSQL（`docker-compose.dev.yml`）和 S3 兼容存储（MinIO）；`server/.env` 不入库，新环境从 `server/.env.example` 复制后补 `SECRET_ENCRYPTION_KEY` 和渠道信息，再执行 `npm run migrate:dev` 和 `npm run seed`。
- 模型没有生效中的价格规则时，调用仍会成功，但金额记为 0 并在日志告警；上线前必须先为每个模型录入价格。
