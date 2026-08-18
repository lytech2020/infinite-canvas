# HTML 详细设计文档模板

Use this template as the default output format. Generate one self-contained HTML file.

## Required HTML Skeleton

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>详细设计文档 - FP-xxx</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    :root {
      --ink: #172033;
      --muted: #5f6b7a;
      --line: #d9e1ec;
      --bg: #f6f8fb;
      --panel: #ffffff;
      --blue: #1f5f99;
      --green: #19735a;
      --amber: #9a5b00;
      --red: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      color: var(--ink);
      background: var(--bg);
      line-height: 1.65;
    }
    header {
      padding: 32px 40px;
      background: #10243d;
      color: #fff;
    }
    header h1 { margin: 0 0 8px; font-size: 30px; }
    header p { margin: 0; color: #d8e3f2; }
    .layout {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      gap: 24px;
      padding: 24px;
    }
    nav {
      position: sticky;
      top: 16px;
      align-self: start;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }
    nav a {
      display: block;
      padding: 7px 8px;
      color: var(--blue);
      text-decoration: none;
      border-radius: 6px;
      font-size: 14px;
    }
    nav a:hover { background: #eef5ff; }
    main {
      min-width: 0;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 28px;
    }
    section { margin-bottom: 36px; }
    h2 {
      margin: 0 0 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid var(--line);
      font-size: 24px;
    }
    h3 { margin: 20px 0 10px; font-size: 18px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0 18px;
      font-size: 14px;
      background: #fff;
    }
    th, td {
      border: 1px solid var(--line);
      padding: 9px 10px;
      vertical-align: top;
      word-break: break-word;
    }
    th { background: #eef3f8; text-align: left; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .ok { background: #e8f5ef; color: var(--green); }
    .assume { background: #fff3d8; color: var(--amber); }
    .open { background: #fdecec; color: var(--red); }
    .add { background: #e8f2ff; color: var(--blue); }
    .change { background: #fff0e6; color: #9a4b00; }
    .reuse { background: #edf7ed; color: #27632a; }
    .extend { background: #f0edff; color: #5b3eb1; }
    .none { background: #eef1f4; color: #53606d; }
    .diagram {
      margin: 14px 0;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfdff;
      overflow-x: auto;
    }
    pre {
      margin: 12px 0;
      padding: 14px;
      border-radius: 8px;
      background: #0f1722;
      color: #e6edf5;
      overflow-x: auto;
    }
    .note {
      border-left: 4px solid var(--blue);
      background: #f0f6ff;
      padding: 10px 12px;
      margin: 12px 0;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; padding: 12px; }
      nav { position: static; }
      main { padding: 18px; }
      header { padding: 24px 20px; }
    }
    @media print {
      body { background: #fff; }
      nav { display: none; }
      .layout { display: block; padding: 0; }
      main { border: 0; padding: 0; }
      section { break-inside: avoid; }
      table { font-size: 11px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>详细设计文档</h1>
    <p>Feature Point: FP-xxx / additive development on existing hosted system</p>
  </header>
  <div class="layout">
    <nav aria-label="目录">
      <a href="#doc-info">1. 文档信息</a>
      <a href="#feature-input">2. 功能点输入整理</a>
      <a href="#impact">3. 既存影响分析</a>
      <a href="#strategy">4. 最小修改方针</a>
      <a href="#process">5. 处理流程详细设计</a>
      <a href="#screens">6. 画面详细设计</a>
      <a href="#items">7. 画面项目定义</a>
      <a href="#transition">8. 画面迁移设计</a>
      <a href="#api">9. API 详细设计</a>
      <a href="#db">10. 数据库详细设计</a>
      <a href="#permission">11. 权限设计</a>
      <a href="#validation">12. 校验 / 错误处理</a>
      <a href="#logs">13. 日志 / 运用</a>
      <a href="#external">14. 外部接口 / 批处理</a>
      <a href="#migration">15. 数据迁移 / 兼容性</a>
      <a href="#test">16. 测试观点</a>
      <a href="#release">17. 发布 / 回滚</a>
      <a href="#tasks">18. 开发任务拆分</a>
      <a href="#open">19. 未决事项与风险</a>
      <a href="#trace">20. 追踪矩阵</a>
    </nav>
    <main>
      <!-- Sections go here. Use the same 20-section order as detailed-design-template.md. -->
    </main>
  </div>
  <script>
    mermaid.initialize({ startOnLoad: true, theme: "default", securityLevel: "loose" });
  </script>
</body>
</html>
```

## Required Diagram Blocks

Place these diagrams in the relevant sections and replace generic names with actual objects.

### Existing Impact Map

```html
<div class="diagram">
  <pre class="mermaid">
flowchart LR
    FP["FP-xxx 功能点"] --> SCR["既存/新增画面"]
    FP --> API["既存/新增 API"]
    FP --> DB["既存/新增 DB"]
    FP --> PERM["权限"]
    FP --> JOB["Job / Batch"]
    FP --> EXT["外部接口 / 文件"]
    SCR -->|追加/変更/流用| IMP1["影响说明"]
    API -->|追加/変更/Wrapper| IMP2["影响说明"]
    DB -->|新增字段/新增表| IMP3["影响说明"]
  </pre>
</div>
```

### Processing Flow

```html
<div class="diagram">
  <pre class="mermaid">
flowchart TD
    A["开始"] --> B["用户画面操作"]
    B --> C["前端校验"]
    C --> D{"校验通过"}
    D -- "否" --> E["显示错误"]
    D -- "是" --> F["调用 API"]
    F --> G["权限检查"]
    G --> H{"权限 OK"}
    H -- "否" --> I["返回 403"]
    H -- "是" --> J["业务处理"]
    J --> K["DB 更新 / 外部处理"]
    K --> L["日志记录"]
    L --> M["返回结果"]
    M --> N["结束"]
  </pre>
</div>
```

### Screen Transition

```html
<div class="diagram">
  <pre class="mermaid">
stateDiagram-v2
    [*] --> ListScreen: 菜单打开
    ListScreen --> DetailScreen: 明细
    DetailScreen --> EditScreen: 编辑
    EditScreen --> DetailScreen: 保存成功
    EditScreen --> EditScreen: 校验错误
    DetailScreen --> ListScreen: 返回
  </pre>
</div>
```

### API Sequence

```html
<div class="diagram">
  <pre class="mermaid">
sequenceDiagram
    actor User as 用户
    participant Screen as 画面
    participant API as Wrapper/API
    participant Service as 既存/新增服务
    participant DB as DB/Datastore
    User->>Screen: 操作
    Screen->>API: Request
    API->>API: 参数校验/权限检查
    API->>Service: 业务处理
    Service->>DB: 查询/更新
    DB-->>Service: Result
    Service-->>API: Result
    API-->>Screen: Response
    Screen-->>User: 结果显示
  </pre>
</div>
```

### ER Diagram

```html
<div class="diagram">
  <pre class="mermaid">
erDiagram
    EXISTING_TABLE ||--o{ NEW_TABLE : references
    EXISTING_TABLE {
      string id PK
      string existing_field
    }
    NEW_TABLE {
      string id PK
      string existing_id FK
      string new_field
      datetime created_at
      datetime updated_at
    }
  </pre>
</div>
```

### Permission Flow

```html
<div class="diagram">
  <pre class="mermaid">
flowchart TD
    A["用户访问"] --> B["角色判定"]
    B --> C{"画面权限"}
    C -- "NG" --> X["拒绝访问"]
    C -- "OK" --> D["画面显示"]
    D --> E["API 调用"]
    E --> F{"API 权限"}
    F -- "NG" --> Y["403 返回"]
    F -- "OK" --> G["数据范围过滤"]
    G --> H["处理执行"]
  </pre>
</div>
```

### Release / Rollback Flow

```html
<div class="diagram">
  <pre class="mermaid">
flowchart TD
    A["发布开始"] --> B["备份/导出配置"]
    B --> C["部署代码/配置"]
    C --> D["执行迁移/初期数据"]
    D --> E["Smoke Test"]
    E --> F{"发布判定"}
    F -- "OK" --> G["发布完成"]
    F -- "NG" --> H["回滚代码/配置"]
    H --> I["回滚数据/恢复备份"]
    I --> J["回滚确认"]
  </pre>
</div>
```
