# app/api/files/route.ts

## 職責契約
此模組是檔案存取的 HTTP 讀取入口，負責把查詢參數轉譯為 R2 單檔讀取或物件列舉操作，並回傳符合 App Router 慣例的 HTTP 響應。它僅處理讀取語意與回應封裝；嚴禁承擔 R2 連線建立、Bucket/憑證解析、物件鍵命名策略、任務狀態業務語意或任何寫入行為，這些應分別交由 `lib/r2.ts` 與上游流程處理。

## 接口摘要
### `GET(request: NextRequest)`
- **輸入**：Query string；`key?` 指定時讀取單一物件，否則使用 `prefix?` 與 `limit?` 進行列舉。
- **輸出**：
  - `key` 模式：回傳物件原始字串內容；`.json` 以 `application/json`，其餘預設 `text/markdown`。
  - 列舉模式：`{ files: [{ key, size, lastModified }] }`。
  - 失敗：`{ error }` 與 HTTP 500。
- **副作用**：呼叫 `lib/r2.ts` 的讀取/列舉能力；寫入伺服器錯誤日誌；單檔讀取回應附帶快取標頭。
- **約束**：不接受 R2 覆蓋參數，也不暴露寫入/刪除能力；底層儲存錯誤直接轉為 API 錯誤回應。

## 依賴拓撲
`Client / Internal UI` → `app/api/files/route.ts` → (`getObject` / `listObjects`) in `lib/r2.ts` → `resolveR2` / `config.r2`

- 在本 bundle 內，它是唯一直接對外提供「檔案讀取視角」的 HTTP façade。
- `lib/r2.ts` 提供實際儲存存取與憑證解析，`lib/config.ts` 提供預設 R2 設定來源。
- `lib/utils/helpers.ts` 雖未被本路由直接呼叫，但其生成的 key 命名規則決定了本路由最終能列出與讀回哪些物件。
