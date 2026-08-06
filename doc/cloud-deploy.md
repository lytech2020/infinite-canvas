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

### 2.1 启动数据库

有 Docker 时：

```bash
docker compose -f docker-compose.dev.yml up -d
```

该文件只包含 PostgreSQL，账号密码库名均为 `infinite_canvas`，数据保存在 `db-data` 卷中。

没有 Docker 时（macOS + Homebrew），直接装本机 PostgreSQL：

```bash
brew install postgresql@16 && brew services start postgresql@16
```

再建角色和数据库，保持与默认 `DATABASE_URL` 一致。其中 `CREATEDB` 权限是 Prisma 迁移创建影子数据库所必需的，缺少会报 `P3014`：

```bash
/opt/homebrew/opt/postgresql@16/bin/psql -d postgres -c "CREATE ROLE infinite_canvas LOGIN PASSWORD 'infinite_canvas' CREATEDB;"
```

```bash
/opt/homebrew/opt/postgresql@16/bin/createdb -O infinite_canvas infinite_canvas
```

本地对象存储没有 Docker 时，用 Homebrew 起 MinIO：

```bash
brew install minio && mkdir -p /opt/homebrew/var/minio/infinite-canvas
```

```bash
MINIO_ROOT_USER=infinite_canvas MINIO_ROOT_PASSWORD=infinite_canvas /opt/homebrew/opt/minio/bin/minio server --address=:9000 --console-address=:9001 /opt/homebrew/var/minio
```

MinIO 单机模式下，数据目录里的一级目录就是 bucket，所以上面 `mkdir` 那一步等价于建好了 `infinite-canvas` 桶。

### 2.2 初始化后台

```bash
cd server && cp .env.example .env && bun install
```

编辑 `server/.env`，至少确认这几项：

- `DATABASE_URL`：默认指向上一步的本地库，通常无需修改。
- `SECRET_ENCRYPTION_KEY`：渠道 API Key 的加密主密钥，必须是 32 字节的 base64，用下面的命令生成后填入。
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`：初始管理员账号，登录后请立即修改密码。
- `S3_*`：对象存储连接信息，默认值对应上面的本地 MinIO。生产换成 S3 / R2 时通常要把 `S3_FORCE_PATH_STYLE` 改为 `false`。
- `AZURE_OPENAI_*`（可选）：填写后 seed 会自动创建初始渠道和模型，密钥加密写入数据库。部署名用逗号分隔并以 `部署名:能力` 指定能力，例如 `gpt-5.6-sol:text,gpt-image-2:image,sora-2:video`；省略能力时按 `text` 处理。渠道建好后即可在管理接口维护，不再依赖这些变量。

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2.3 建表并创建管理员

首次执行会在 `server/prisma/migrations/` 下生成迁移文件，之后要提交进 Git：

```bash
cd server && bunx prisma migrate dev --name init && bunx prisma db seed
```

后续修改 `server/prisma/schema.prisma` 后，同样用 `bunx prisma migrate dev --name <本次改动名>` 生成新迁移，不要手改已生成的迁移文件。

### 2.4 启动服务

```bash
cd server && bun run dev
```

```bash
cd web && bun run dev
```

前端开发服务器已把 `/api` 代理到 `http://127.0.0.1:8787`，浏览器访问 `http://localhost:3000` 即可。需要连别的后台时设置 `VITE_API_PROXY`。

### 2.5 验证

- 打开 `http://localhost:3000/login`，用 `ADMIN_EMAIL` 登录。
- 顶部用户菜单应出现「管理后台」入口，进入 `/admin/users` 能看到用户列表。
- `curl http://localhost:8787/api/v1/health` 返回 `{"data":{"ok":true}}`。

## 3. 服务器部署

### 3.1 使用 docker compose

`docker-compose.yml` 已包含 `app`（前端）、`server`（后台）和 `db` 三个服务。部署前必须修改：

- `server.environment` 中的 `ADMIN_EMAIL`、`ADMIN_PASSWORD`。
- `server.environment` 增加 `SECRET_ENCRYPTION_KEY`，值用 2.2 的命令生成。
- `db` 的 `POSTGRES_PASSWORD`，并同步修改 `DATABASE_URL`。

建议把这些值写进服务器上的 `.env` 文件，再在 compose 中用 `${VAR}` 引用，不要直接提交明文。

```bash
docker compose up -d --build
```

后台容器启动时会自动执行 `prisma migrate deploy`，所以 `server/prisma/migrations/` 必须已随代码提交。首次部署后手动执行一次 seed 创建管理员：

```bash
docker compose exec server npx prisma db seed
```

### 3.2 反向代理与 HTTPS

`nginx.conf` 中 `/api` 通过 Docker 内置 DNS 解析服务名 `server`，使用变量延迟解析，因此后台未启动时只影响 `/api`，不会导致前端容器起不来。

生产环境必须使用 HTTPS：会话 Cookie 在 `NODE_ENV=production` 下带 `Secure` 属性，纯 HTTP 访问会导致登录后立即掉线。如果外层还有一层网关，需要透传 `X-Forwarded-Proto`。

### 3.3 前后端分域部署

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
