# app/api/scrape/route.ts

## 職責契約
- 此模組是「單頁即時抓取」入口：接收單一 URL 與進階抓取參數，呼叫 Firecrawl 取得 Markdown/metadata，並依請求選項串接內容清理與 R2 落盤。
- 它負責在同一次請求中編排三段可選流程：抓取、LLM 清理、R2 儲存，讓前端能立即取得可預覽結果。
- 它**不負責**網址探索、批次任務排程、queue 分發或任務狀態管理；這些屬於 `/api/map` 與 `/api/crawl` 的責任範圍。

## 接口摘要
- `POST(req)`
  - **Input**：JSON 物件，至少包含 `url: string`；可選 `firecrawlKey`、進階抓取參數（`waitFor`、`timeout`、`onlyMainContent`、`mobile`、`includeTags`、`excludeTags`）、後處理開關（`enableClean`、`saveToR2`）、LLM Cleaner 覆蓋欄位，以及 R2 覆蓋認證。
  - **主要流程約束**：
    - `url` 缺失或非字串時回傳 `400`。
    - `includeTags` / `excludeTags` 以逗號分隔字串解析為陣列；`waitFor` / `timeout` 轉成數值。
    - 先執行 `scrapeUrlAdvanced()`；只有在 `enableClean` 且抓取結果非空時才呼叫 `cleanContent()`；只有在 `saveToR2` 時才寫入 R2。
  - **Side Effect**：
    - 呼叫 Firecrawl 單頁抓取。
    - 可選呼叫 LLM Content Cleaner。
    - 可選以 `buildR2Key()` 生成 raw/cleaned 路徑並透過 `putObject()` 寫入 R2。
  - **Output**：成功時回傳 `{ success, markdown, cleanedMarkdown, metadata, charCount, cleanedCharCount, r2 }`；例外時回傳 `500` JSON 錯誤。

## 依賴拓撲
- 使用者單頁 URL -> **`/api/scrape`** -> `scrapeUrlAdvanced()` -> Firecrawl Scrape -> Markdown / metadata
- 可選支線：**`/api/scrape`** -> `cleanContent()` -> LLM 清理結果
- 可選支線：**`/api/scrape`** -> `buildR2Key()` + `putObject()` -> R2 raw / cleaned 物件
- 同 bundle 關係：
  - `/api/scrape` 與 `/api/map`、`/api/crawl` 同層，但目標不同：它直接產出內容，不先產出 URL 清單。
  - `/api/map` + `/api/crawl` 組成「發現多網址並排入背景處理」路徑；`/api/scrape` 則是「單頁同步預覽/保存」捷徑。
  - 三者共同構成抓取入口層：`map` 偏 discovery、`crawl` 偏 orchestration、`scrape` 偏 immediate content retrieval。
