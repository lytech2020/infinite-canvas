# 功能点输入模板

开发者填写这个模板后，AI 才生成详细设计文档。

## 1. 基本信息

| 项目 | 内容 |
|---|---|
| Feature Point ID | FP- |
| Feature Point Name |  |
| Product / System |  |
| Package / Module |  |
| Target Environment | Dev / Staging / Production |
| Request Source | 要件定义 / 基本设计 / 客户指摘 / 障害 / 改善 |
| Priority | Must / Should / Could |
| Status | 确认済 / 推定 / 未決 |

## 2. 功能目的

| 项目 | 内容 |
|---|---|
| Business Purpose |  |
| User Value |  |
| Current Problem |  |
| Expected Result |  |

## 3. 既存功能与影响范围

| 对象 | 名称 / ID / 路径 | 当前行为 | 影响分类 | 备注 |
|---|---|---|---|---|
| 既存画面 |  |  | 追加 / 変更 / 流用 / 无影响 / 未确认 |  |
| 既存 API |  |  | 追加 / 変更 / 流用 / 无影响 / 未确认 |  |
| 既存 DB / Datastore |  |  | 追加 / 変更 / 流用 / 无影响 / 未确认 |  |
| 既存权限 |  |  | 追加 / 変更 / 流用 / 无影响 / 未确认 |  |
| 既存批处理 / Job |  |  | 追加 / 変更 / 流用 / 无影响 / 未确认 |  |
| 外部接口 / 文件 |  |  | 追加 / 変更 / 流用 / 无影响 / 未确认 |  |

## 4. 新增 / 修改内容

| 分类 | 内容 |
|---|---|
| New Behavior |  |
| Changed Behavior |  |
| Out of Scope |  |
| Compatibility Requirement |  |

## 5. 画面需求

| 项目 | 内容 |
|---|---|
| New Screen |  |
| Existing Screen Change |  |
| Screen Items |  |
| Buttons / Actions |  |
| Screen Transition |  |
| Display Conditions |  |
| Input Validation |  |

## 6. API / 后端需求

| 项目 | 内容 |
|---|---|
| New API |  |
| Existing API Change |  |
| Wrapper API Needed | Yes / No / 未決 |
| Request Data |  |
| Response Data |  |
| Backend Processing |  |
| Error Cases |  |

## 7. 数据库 / 数据需求

| 项目 | 内容 |
|---|---|
| New Table / Datastore |  |
| Existing Table Change |  |
| New Fields |  |
| Data Relation |  |
| Status / State |  |
| Initial Data |  |
| Migration Needed | Yes / No / 未決 |
| Retention / Audit |  |

## 8. 权限 / 安全需求

| 项目 | 内容 |
|---|---|
| Roles |  |
| Screen Permission |  |
| API Permission |  |
| Data Range |  |
| Audit Requirement |  |

## 9. 非功能 / 运用需求

| 项目 | 内容 |
|---|---|
| Performance |  |
| Availability |  |
| Logging |  |
| Monitoring |  |
| Backup / Restore |  |
| Operation Notes |  |

## 10. 最小修改方针

| 项目 | 内容 |
|---|---|
| Preferred Strategy | 配置 / 新增 / 拡張 / Wrapper / 既存変更 |
| Existing Logic Change Allowed | Yes / No / 未決 |
| Reason if Existing Logic Changes |  |
| Regression Scope |  |

## 11. 确认事项

| No | 确认内容 | 影响 | 确认对象 | 状态 |
|---|---|---|---|---|
| OPEN-FP-001-001 |  | 范围 / 设计 / 测试 / 发布 | 客户 / PM / 架构 / 开发 | 未決 |

## 填写例

```text
Feature Point ID：FP-ORD-001
Feature Point Name：订单详情画面追加备注字段
Product / System：寄存业务系统
Package / Module：订单管理
Business Purpose：业务人员可以在订单详情中记录内部处理备注。
Existing Screen Change：订单详情画面增加“内部备注”输入框
Existing API Change：订单更新 API 追加 internal_note 字段
Existing Table Change：orders 表追加 internal_note 字段
Preferred Strategy：新增字段 + 既存更新 API 最小修改
Existing Logic Change Allowed：No
Regression Scope：订单详情显示、订单更新、权限、既存订单保存
```
