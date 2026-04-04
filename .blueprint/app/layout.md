## 職責契約
此模組是 App Router 的根文件殼層，負責建立全站 HTML/Body 骨架、註冊全域字體與 metadata，並把子頁面掛入統一外框。它不負責任何頁面特定互動、抓取任務控制、API 請求或任務資料編排。

## 接口摘要
- `metadata: Metadata`
  - **輸入**：靜態標題與描述字串。
  - **輸出**：供 Next.js 生成文件層 metadata。
  - **副作用**：影響首頁與其他頁面的預設文件資訊。
- `RootLayout({ children })`
  - **輸入**：`children: React.ReactNode`。
  - **輸出**：包裹 `<html>` 與 `<body>` 的根層 React 樹。
  - **副作用**：載入 `globals.css`、註冊 `Geist` / `Geist_Mono` 字體變數、設定 `lang` 與全頁高度/抗鋸齒樣式。
  - **限制**：應維持殼層純度，不夾帶首頁業務狀態或資料抓取流程。

## 依賴拓撲
`next.config.ts`（框架設定）
→ `app/layout.tsx`（文件殼層）
→ `app/page.tsx`（首頁互動控制台）

補充依賴：
- `next-env.d.ts` 為本模組提供 Next/TypeScript 型別基底。
- `app/layout.tsx` 是本 bundle 的承上啟下節點：上接框架級設定，下包所有頁面內容，而 `app/page.tsx` 是其直接掛載的首頁入口。
