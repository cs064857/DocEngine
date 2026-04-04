## 職責契約
此模組是專案的 Next.js 框架級設定入口，目前唯一明確職責是調整 Server Actions 的請求體大小上限，讓框架層可以接受較大的提交內容。它不負責頁面佈局、資料抓取、任務狀態管理或任何 DocEngine 業務流程。

## 接口摘要
- `nextConfig: NextConfig`
  - **輸入**：無；由模組內靜態宣告。
  - **輸出**：Next.js 可讀取的全域設定物件。
  - **關鍵設定**：`experimental.serverActions.bodySizeLimit = "4mb"`。
  - **副作用**：改變整個應用在 Server Actions 場景下可接受的 request body 上限。
- `export default nextConfig`
  - **輸入**：由 Next 啟動與建置流程載入。
  - **輸出**：成為 App Router 的框架執行邊界之一。

## 依賴拓撲
`Next CLI / Build Runtime` → `next.config.ts` → `App Router`
                                              ↘ `app/layout.tsx`
                                              ↘ `app/page.tsx`

在本 bundle 中，它不是被 `layout.tsx` 或 `page.tsx` 直接 import 的模組，而是先於兩者生效的框架設定層；其影響以全域執行規則形式下沉到頁面殼層與首頁入口。
