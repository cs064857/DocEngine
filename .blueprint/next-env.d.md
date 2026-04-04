## 職責契約
此檔是 Next.js 產生的 TypeScript 型別橋接層，只負責把 `next`、`next/image` 與建置後的 typed routes 宣告注入專案編譯上下文。它不承載任何執行期邏輯、頁面行為或框架設定，且不應被當成手動維護的業務模組。

## 接口摘要
- `/// <reference types="next" />`
  - **輸入**：Next 官方型別套件。
  - **輸出**：啟用專案層級的 Next 核心型別。
  - **副作用**：影響整個 App Router 專案的編譯期型別解析。
- `/// <reference types="next/image-types/global" />`
  - **輸入**：Next Image 全域型別宣告。
  - **輸出**：補齊圖片相關型別能力。
- `import "./.next/types/routes.d.ts"`
  - **輸入**：建置產生的路由型別檔。
  - **輸出**：把 typed routes 併入目前專案的型別上下文。
  - **限制**：依賴 `.next` 產物存在；僅服務開發期與建置期。

## 依賴拓撲
`Next 編譯器 / TypeScript` → `next-env.d.ts` → `next` 官方型別、`.next/types/routes.d.ts`

在本 bundle 中，它位於最上游的型別層，為 `next.config.ts`、`app/layout.tsx`、`app/page.tsx` 提供共同的語意基底，但不直接參與任何執行期資料流。
