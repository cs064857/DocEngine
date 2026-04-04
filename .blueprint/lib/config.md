# lib/config.ts

## 職責契約
此模組是專案的執行期設定匯流點，將環境變數整理為結構化 `config` 物件，供外部整合、R2 儲存與專案級限制統一取用。它只負責讀取與預設值回填；嚴禁承擔設定驗證、祕密輪替、動態熱更新、外部連線建立或業務流程決策。

## 接口摘要
### `config`
- **`firecrawl`**：`apiKey`、`apiUrl`；供抓取與映射服務使用。
- **`llm.urlExtractor`**：`baseUrl`、`apiKey`、`model`；供網址抽取流程使用。
- **`llm.contentCleaner`**：`baseUrl`、`apiKey`、`model`；供內容清洗流程使用。
- **`r2`**：`accountId`、`accessKeyId`、`secretAccessKey`、`bucketName`；作為儲存層預設憑證與 Bucket 來源。
- **`project`**：`maxUrlsLimit`、`retryAttempts`；作為任務建立與重試策略的全域預設值。
- **副作用**：模組載入時讀取 `process.env`，並將部分字串型設定轉成數值。
- **約束**：部分第三方服務金鑰以非空斷言表示部署時必須提供；R2 欄位允許空字串，將缺值判斷延後到真正使用 `lib/r2.ts` 時處理。

## 依賴拓撲
`process.env` → `lib/config.ts` →
- `lib/r2.ts`：解析預設 R2 憑證與 bucket。
- `app/api/crawl/route.ts`、`app/api/queues/process-url/route.ts`：讀取 URL 上限與重試次數。
- `app/api/map/route.ts`、`lib/services/crawler.ts`、`lib/processors/*`：讀取 Firecrawl 與 LLM 服務設定。

- 在本 bundle 內，`lib/config.ts` 是 `lib/r2.ts` 的上游設定根節點。
- `app/api/files/route.ts` 不直接依賴它，而是透過 `lib/r2.ts` 間接繼承其 R2 預設值。
