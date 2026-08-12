# 云端版部署与初始化说明

本文件说明如何在本地和服务器上把云端版跑起来。前端在 `web/`，后台在 `server/`，两者通过同源 `/api` 通信。

配置项的完整解释见 [云端版后台技术方案与接口契约](tasks/cloud-backend-tech.md)。

## 1. 组成部分

| 组件 | 作用 | 端口 |
| --- | --- | ---: |
| `web` | nginx 提供前端静态产物，并把 `/api` 反向代理到后台 | 3000 |
| `server` | Node/Express 后台 API | 8787 |
| `db` | PostgreSQL 16 | 5432 |
| 对象存储 | S3 兼容服务，存参考文件和生成结果 | - |

对象存储用于参考文件和生成结果，图片能力起必须配置，后台启动时会校验相关环境变量。

## 2. 本地开发

本地统一使用 Docker Compose 启动前端、后台、PostgreSQL 和 MinIO。首次使用先复制配置，并把示例密码和密钥改为仅本机使用的值：

```bash
cp .env.example .env
```

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

`docker-compose.local.yml` 会启动 MinIO、等待其健康并自动创建 `infinite-canvas` bucket；后台容器启动时自动执行 `prisma migrate deploy`。首次启动后执行一次 seed 创建管理员和可选初始 Azure OpenAI 渠道：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml exec server node dist/prisma/seed.js
```

本地配置统一放在根目录 `.env`：`DATABASE_URL` 使用服务名 `db`，`S3_ENDPOINT` 使用服务名 `minio`，每日与每月账户限额按 `QUOTA_TIMEZONE` 重置。`.env` 不提交到 Git。

停止服务但保留数据库和对象存储数据：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

### 2.1 验证

- 打开 `http://localhost:3000/login`，用 `ADMIN_EMAIL` 登录。
- 顶部用户菜单应出现「管理后台」入口，进入 `/admin` 能看到数据总览；账号菜单中的「修改密码」可替换初始密码。
- `curl http://localhost:8787/api/v1/health` 返回 `{"data":{"ok":true}}`。
- MinIO 控制台位于 `http://localhost:9001`。

## 3. 服务器部署

### 3.1 使用 docker compose

`docker-compose.yml` 已包含 `app`（前端）、`server`（后台）和 `db` 三个服务，前后端都会从当前代码构建，不再引用远端 `latest` 镜像。对象存储使用外部 S3 兼容服务。部署前先执行 `cp .env.example .env`，然后至少修改 `POSTGRES_PASSWORD`、`DATABASE_URL`、`SECRET_ENCRYPTION_KEY`、`ADMIN_EMAIL`、`ADMIN_PASSWORD` 和全部 `S3_*`。

`POSTGRES_PASSWORD` 与 `DATABASE_URL` 中的密码必须一致；密码包含特殊字符时要在 URL 中进行百分号编码。`.env` 已被 Git 忽略，不要提交真实值。

```bash
docker compose up -d --build
```

后台容器启动时会自动执行 `prisma migrate deploy`，所以 `server/prisma/migrations/` 必须已随代码提交。首次部署后执行一次 seed 创建管理员和可选初始 Azure OpenAI 渠道：

```bash
docker compose exec server node dist/prisma/seed.js
```

随后登录并从账号菜单修改初始密码。修改成功后，当前浏览器保持登录，其他设备上的旧会话会立即失效。

### 3.2 对象存储 CORS

浏览器会使用后台签发的限时地址直接上传参考文件，因此 bucket 必须允许站点域名跨域执行 `PUT`、`GET` 和 `HEAD`。以下为通用示例，部署时把域名替换为实际 HTTPS 域名：

```json
[
  {
    "AllowedOrigins": ["https://canvas.example.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

同时需要提前创建 `S3_BUCKET` 指定的 bucket；bucket 不应开放公共读取，生成结果统一使用后台签发的限时下载地址。

### 3.3 反向代理与 HTTPS

`nginx.conf` 中 `/api` 通过 Docker 内置 DNS 解析服务名 `server`，使用变量延迟解析，因此后台未启动时只影响 `/api`，不会导致前端容器起不来。

生产环境必须使用 HTTPS：会话 Cookie 在 `NODE_ENV=production` 下带 `Secure` 属性，纯 HTTP 访问会导致登录后立即掉线。如果外层还有一层网关，需要透传 `X-Forwarded-Proto`。

当前前端产物按站点根路径 `/` 构建，生产建议使用独立域名或根路径部署，不要直接挂载到 `/canvas-app/` 等子目录。

### 3.4 前后端分域部署

默认前后端同源，无需 CORS。若必须分域：

- 前端构建时设置 `VITE_API_BASE_URL` 指向后台完整地址。
- 后台需要额外开启 CORS 并允许携带 Cookie，同时 Cookie 需改为 `SameSite=None; Secure`。

当前代码未实现分域所需的 CORS 配置，建议优先保持同源部署。

## 4. 环境变量

后台变量清单见 [技术方案第 8 节](tasks/cloud-backend-tech.md#8-环境变量清单)，`server/.env.example` 只保留已实现能力所需的变量，随阶段推进补充。

前端只有一个可选变量 `VITE_API_BASE_URL`，留空表示同源。前端产物中不包含任何供应商密钥，渠道密钥只存在于后台数据库。

## 5. 数据与备份

- 所有业务数据在 PostgreSQL 中，备份 `db-data` 卷或使用 `pg_dump` 即可。
- 渠道 API Key 以 AES-256-GCM 密文保存，`SECRET_ENCRYPTION_KEY` 丢失后无法解密，必须与数据库备份分开妥善保管。
- 提示词和成本结算记录长期保存，不设置自动过期。
- 临时上传在创建 24 小时后由后台每小时清理一次，对象存储文件与数据库记录同步删除；生成结果暂不自动删除。

## 6. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `/api` 返回 502 | 后台容器未启动或崩溃，查看 `docker compose logs server` |
| 登录后刷新即掉线 | 生产环境未启用 HTTPS，`Secure` Cookie 无法写入 |
| 启动报缺少必填环境变量 | 按提示补齐 `.env`，`DATABASE_URL` 和 `SECRET_ENCRYPTION_KEY` 为必填 |
| `migrate deploy` 报没有迁移 | `server/prisma/migrations/` 未提交，先在本地执行 `prisma migrate dev` |
| 渠道 API Key 解密失败 | `SECRET_ENCRYPTION_KEY` 与写入时不一致，需要恢复原密钥或重新录入渠道 |
| `prisma migrate dev` 报 P3014 | 数据库角色缺少 `CREATEDB` 权限，执行 `ALTER ROLE infinite_canvas CREATEDB;` |
| 浏览器控制台出现 `/auth/me` 的 401 | 未登录时恢复会话的正常结果，不是故障 |
| 迁移后接口报 `INTERNAL_ERROR`，日志显示某个模型 undefined | `prisma migrate` 会重新生成 Prisma Client，需要重启后台进程才会加载 |
| 删除模型报「该模型已有调用记录」 | 有历史用量的模型不能删除，改为停用即可从用户模型列表隐藏 |
| 图片生成失败且日志提示 NoSuchBucket | 对象存储里没有建桶，MinIO 下 `mkdir` 数据目录的一级目录即可 |
| 生成结果地址访问 403 | 下载地址是限时签名，过期后重新查询任务接口会拿到新地址 |
