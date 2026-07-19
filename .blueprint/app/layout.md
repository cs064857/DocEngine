# app/layout.tsx

## 職責契約 (Responsibility Contract)

本模組是 DocEngine 的 **根 HTML 殼層**。它只負責：全域 metadata、字體 CSS 變數、根 `<html>/<body>` 結構，以及引入 `globals.css`。

**嚴禁**：任何業務狀態、API 呼叫、localStorage、爬取/Skill 邏輯（那些全在 `page.tsx`）。

## 接口摘要 (Interface Summary)

`RootLayout({ children })`

| 項目 | 說明 |
|------|------|
| **Input** | `children: React.ReactNode`（App Router 子頁） |
| **Output** | 完整 HTML 文件樹 |
| **Side Effect** | 注入 Geist / Geist_Mono 字體 CSS 變數；套用 `h-full` / `min-h-full flex flex-col` 佈局骨架 |
| **Export** | `metadata: Metadata` — `title: "DocEngine"`，描述為 RAG 導向的 AI 爬取與清理引擎 |

## 依賴拓撲 (Dependency Topology)

```
next.config.ts（框架殼）
        │
        ▼
  app/layout.tsx  ← 本模組（全域外殼）
        │
        ├── next/font/google → Geist, Geist_Mono
        ├── ./globals.css
        └── children → app/page.tsx（唯一首頁客戶端應用）
```

與本 bundle：位於 `next.config` 之下、`page` 之上；不依賴 `lib/config`（純 UI 殼，無 env）。
