# app/api/map/route.ts

## 職責契約
- 此模組是 Firecrawl Map 的 HTTP 代理入口：驗證目標網域與 API Key、組裝 Map 請求、轉呼叫上游服務，並把回傳的 links 正規化為純 URL 陣列。
- 它負責把 Firecrawl 特定錯誤（特別是額度與速率限制）轉為前端可理解的 API 錯誤訊息。
- 它**不負責**建立任務、寫入 R2、執行單頁抓取或內容清理；其產物僅是「可供後續 review / crawl 的網址集合」。

## 接口摘要
- `POST(req)`
  - **Input**：JSON 物件，至少包含 `url: string`；可選 `search`、`limit`、`includeSubdomains`、`firecrawlKey`。
  - **主要流程約束**：
    - `url` 缺失或型別錯誤時回傳 `400`。
    - API Key 優先採用前端傳入 `firecrawlKey`，否則退回環境設定；若仍缺失回傳 `400`。
    - 請求 payload 固定啟用 `ignoreQueryParameters: true`，`limit` 預設為 `5000`，`includeSubdomains` 預設為 `true`。
  - **Side Effect**：向 Firecrawl `/v2/map` 發出一次外部 HTTP POST。
  - **Output**：成功時回傳 `{ success: true, urls, count }`；若上游失敗，盡量保留對應 HTTP 狀態並輸出語意化錯誤；內部例外回傳 `500`。

## 依賴拓撲
- 使用者輸入網域 -> **`/api/map`** -> Firecrawl Map API -> `urls[]` -> 前端手動清單 / review 流程
- 前端通常會把 `urls[]` 再送往 **`/api/crawl`**，形成「網址發現 -> 任務排入佇列」兩段式入口。
- 同 bundle 關係：
  - `/api/map` 是 bundle 內最前段的 discovery 端點，只產出網址，不落地任何任務狀態。
  - `/api/crawl` 接手多網址批次任務化。
  - `/api/scrape` 則是平行的單頁抓取入口，直接產出內容而非 URL 名單。
