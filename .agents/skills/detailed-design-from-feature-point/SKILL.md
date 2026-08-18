---
name: detailed-design-from-feature-point
description: Generate an HTML detailed design document from a developer-provided feature point input template for additive development on top of an existing hosted/customized system. Use when Codex must convert a function point into implementation-ready HTML detailed design covering existing impact analysis, minimal-change strategy, complete diagrams, database additions/changes, API additions/changes, screen items, screen transitions, validation, permissions, logs, migration, tests, release, rollback, and development tasks.
---

# Detailed Design From Feature Point

## Core Rule

The input unit is one `Feature Point`.

Design for additive development on an existing hosted/customized system:

- Prefer new tables, new fields, new APIs, new screens, extension points, or wrapper logic.
- Minimize changes to existing business logic.
- Do not change existing behavior unless the input explicitly requires it.
- Any existing logic modification must be listed in `既存影响与修改理由`.
- Any inferred business rule must be marked as `推定` or `未決`.

## Input Contract

When the developer provides a feature point, normalize it using `references/feature-point-input-template.md`.

Minimum required fields:

- Feature Point ID
- Feature Point Name
- Target System / Package
- Business Purpose
- Existing Function / Screen / API affected
- New Behavior
- Data Objects
- Screen Impact
- API Impact
- Permission Impact
- Expected Minimal-Change Strategy
- Status: `确认済`, `推定`, or `未決`

If these are missing, create a draft feature point input sheet first and mark missing fields as `未決`.

## Workflow

1. Normalize Feature Point
   - Convert developer notes into the standard feature point input template.
   - Separate confirmed facts, assumptions, and unresolved items.

2. Analyze existing impact
   - Identify affected existing screens, APIs, services, tables, jobs, permissions, logs, and external interfaces.
   - Classify each as `追加`, `変更`, `流用`, `无影响`, or `未确认`.

3. Choose minimal-change strategy
   - Prefer configuration, extension, wrapper, or addition.
   - Avoid modifying core existing logic unless required.
   - For each modification, explain why addition alone is insufficient.

4. Generate HTML detailed design
   - Use `references/html-detailed-design-template.md` as the default output format.
   - Use `references/detailed-design-template.md` only when the user explicitly asks for Markdown.
   - Cover screen design, screen items, transitions, API contracts, DB design, validation, permissions, logs, errors, migration, tests, release, rollback, and implementation tasks.

5. Build traceability
   - Link every design item to Feature Point ID and, if available, Requirement ID / Basic Design ID.
   - Design items without a source must be marked `推定` or `未決`.

6. Prepare development handoff
   - Output coding tasks, affected files/modules candidates, implementation order, review checklist, test checklist, and release notes.

7. Run quality gate
   - Check that the design is implementation-ready and does not silently expand scope.

## Required Output

Default output is one self-contained `.html` file.

At minimum, return these sections:

1. 文档信息
2. 功能点输入整理
3. 既存影响分析
4. 最小修改方针
5. 处理流程详细设计
6. 画面详细设计
7. 画面项目定义
8. 画面迁移设计
9. API 详细设计
10. 数据库详细设计
11. 权限 / 角色 / 数据范围设计
12. 校验 / 错误处理设计
13. 日志 / 监查 / 运用设计
14. 外部接口 / 文件 / 批处理 / 通知
15. 数据迁移 / 初期数据 / 兼容性
16. 测试设计观点
17. 发布 / 回滚 / 影响确认
18. 开发任务拆分
19. 未决事项与风险
20. 追踪矩阵

## HTML Output Rules

When creating a detailed design document, generate HTML rather than raw Markdown.

The HTML must include:

- `<!doctype html>`, `<html lang="zh-CN">`, `<head>`, `<body>`.
- Responsive CSS embedded in `<style>`.
- A left or top table of contents with anchor links to every major section.
- Tables rendered as HTML `<table>`, not Markdown table text.
- Mermaid diagrams rendered from `<pre class="mermaid">`.
- A clear status badge style for `确认済`, `推定`, `未決`, `追加`, `変更`, `流用`, `拡張`, `无影响`, `未确认`.
- Code/API examples inside `<pre><code>`.
- Print-friendly CSS with readable tables and no clipped content.

Use Chinese section titles unless the user requests Japanese.

## Required Diagrams

Include diagrams whenever relevant. If the input lacks enough detail, still include a draft diagram and mark unknown nodes as `未決`.

Required diagrams:

| Diagram | Mermaid Type | Purpose |
|---|---|---|
| Overall processing flow | `flowchart TD` | Show user action, validation, backend processing, DB/external processing, logs, and completion. |
| Existing impact map | `flowchart LR` | Show existing screen/API/DB/job/interface and whether each is added, reused, extended, or changed. |
| Screen transition | `stateDiagram-v2` or `flowchart LR` | Show screen-to-screen movement, actions, parameters, and error return. |
| API sequence | `sequenceDiagram` | Show screen, wrapper API, existing API, DB, external service, and error handling. |
| Data model / ER | `erDiagram` | Show new/changed tables or datastores and relationships. |
| Permission control flow | `flowchart TD` | Show role check, screen access, API permission, data range, and denial handling. |
| Release / rollback flow | `flowchart TD` | Show deploy, migration, smoke test, release decision, rollback branch. |

Diagram quality rules:

- Use actual Feature Point IDs, Screen IDs, API IDs, DB IDs, and Permission IDs in node labels where practical.
- Do not leave diagrams as generic examples when the input provides concrete objects.
- Mermaid node labels must be short enough for HTML rendering.
- Every diagram must be followed by a short explanation table or notes.
- Diagrams must not contradict the tables.

## ID Rules

Use Feature Point traceable IDs:

| Artifact | ID Pattern | Example |
|---|---|---|
| Feature Point | `FP-xxx` | `FP-INV-001` |
| Detailed Design | `DD-<fp>-xxx` | `DD-FP-INV-001-001` |
| Screen | `SCR-<fp>-xxx` | `SCR-FP-INV-001-001` |
| Screen Item | `ITEM-<fp>-xxx` | `ITEM-FP-INV-001-001` |
| API | `API-<fp>-xxx` | `API-FP-INV-001-001` |
| DB | `DB-<fp>-xxx` | `DB-FP-INV-001-001` |
| Permission | `PERM-<fp>-xxx` | `PERM-FP-INV-001-001` |
| Validation | `VAL-<fp>-xxx` | `VAL-FP-INV-001-001` |
| Test | `TEST-<fp>-xxx` | `TEST-FP-INV-001-001` |
| Task | `TASK-<fp>-xxx` | `TASK-FP-INV-001-001` |
| Open Item | `OPEN-<fp>-xxx` | `OPEN-FP-INV-001-001` |

## Existing Change Classification

Use these classifications:

| Classification | Meaning |
|---|---|
| `追加` | New object or behavior, no existing behavior change. |
| `変更` | Existing object or behavior must be modified. Requires reason and impact. |
| `流用` | Reuse existing logic without modification. |
| `拡張` | Use existing extension point, hook, setting, or wrapper. |
| `无影响` | Confirmed no impact. |
| `未确认` | Needs code/document investigation. |

## Minimal-Change Priority

Apply this order unless the user says otherwise:

1. Configuration / hosted framework setting
2. New screen item or new screen
3. New API or wrapper API
4. New table / new field / new relation
5. Extension point / hook
6. Small isolated change to existing logic
7. Core logic change

For levels 6 and 7, explicitly document:

- Why lower-impact options are insufficient
- Existing behavior affected
- Regression test range
- Rollback approach

## Hosted / Custom Framework Notes

When working on a hosted or customizable platform:

- Mark whether each item is implemented by platform setting, extension code, wrapper API, custom table, or existing logic change.
- Do not assume direct DB access is allowed unless stated.
- Include tenant/company-specific configuration when relevant.
- Include environment differences: dev, staging, production.
- Include migration and compatibility with existing data.

## Quality Gate

Before finalizing, verify:

- Output is HTML by default and not raw Markdown.
- Required diagrams are present and complete enough to explain the design.
- Every design item is linked to the Feature Point ID.
- Existing modifications are explicitly justified.
- New behavior is separated from existing behavior.
- Screen items map to data/API/validation.
- APIs map to screen operations or backend events.
- DB changes map to API and business need.
- Permissions cover screen, API, and data range.
- Tests cover normal, exception, permission, migration, and regression.
- Release and rollback steps are concrete enough for implementation.

## Short Prompt Pattern

```text
请使用 detailed-design-from-feature-point Skill。
我会提供一个功能点，请先整理功能点输入表，再生成详细设计文档。
要求基于既存寄存功能做追加开发，尽可能少修改原有逻辑。
```
