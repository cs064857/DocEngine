# app/api/crawl/route.ts

## 職責契約

- 此模組是 **DocEngine** 「多網址抓取任務」的同步入口：接收使用者輸入文字或網址清單，抽取可處理 URL、套用數量上限、建立任務追蹤狀態，並把每個 URL 轉成佇列訊息。
- 它負責把前端 `engineSettings` 中與 URL 抽取、R2 覆蓋、任務限制相關的資訊整理後往下游傳遞。
- 它**不負責**實際抓取頁面內容、清理 Markdown、輪詢任務進度，也**不直接執行**爬蟲工作；真正處理由 queue worker 與 bundle 外服務承接。

## 接口摘要

- `POST(req)`
  - **Input**：JSON 物件，至少包含 `input: string`；可選 `engineSettings`，其中會讀取 URL Extractor 覆蓋欄位、`maxUrls`，以及 R2 覆蓋認證，並原樣隨佇列訊息下傳。
  - **主要流程約束**：
    - `input` 缺失或非字串時回傳 `400`。
    - 先透過 `extractUrls()` 將輸入正規化為 URL 陣列；若結果為空回傳 `400`。
    - 依 `engineSettings.maxUrls` 或專案預設上限裁切 URL 數量。
  - **Side Effect**：
    - 生成 `taskId` 與日期字串。
    - 透過 `putTaskStatus()` 在 R2 寫入初始任務狀態 `tasks/{taskId}.json`。
    - 對每個 URL 呼叫 `send('crawl-urls', ...)` 建立佇列訊息。
  - **Output**：成功時回傳 `{ taskId, urlCount, message, urls }`；失敗時回傳 `400` 或 `500` JSON 錯誤。

## 依賴拓撲

- 使用者輸入 / UI 手動網址 / `/api/map` 回填結果 -> **`/api/crawl`** -> `extractUrls()` -> URL 集合
- **`/api/crawl`** -> `putTaskStatus()` -> R2 任務狀態檔
- **`/api/crawl`** -> `@vercel/queue send('crawl-urls')` -> queue worker（bundle 外）
