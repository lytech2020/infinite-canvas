# 无限画布文档

`docs/` 是本项目唯一的文档目录，同时包含 Fumadocs 文档站和项目文档内容。

## 内容分类

- `content/docs/v1/`：当前已有的 V1 文档。
- `content/docs/v2/`：后续新增的 V2 需求、方案和验收清单。
- `content/docs/v1/overview/`：项目介绍、功能说明和面向用户的部署指南。
- `content/docs/v1/canvas/`：画布操作手册。
- `content/docs/v1/development/`：本地开发、云端部署、数据结构和集成测试说明。
- `content/docs/v1/progress/`：TODO、待测试事项、实施方案和任务清单。
- `content/docs/v1/business/`：协议与商务合作。
- `content/docs/v1/support/`：安全与赞助支持。
- `index.md`：供 AI 和维护者快速检索的完整文档索引。

项目不再使用根目录下的 `doc/`。V1 内容保持在 `v1/`，后续需求写入 `v2/`，并同步更新对应的 `meta.json` 和 `index.md`。

## 本地运行

```bash
cd docs
bun install
bun run dev
```

生产构建和 Docker 运行方式见[云端部署与初始化](content/docs/v1/development/cloud-deploy.mdx)。
