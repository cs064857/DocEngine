# Crawl API：從原始輸入建立批次任務

本頁只追蹤 `/api/crawl` 這條「把使用者輸入變成正式 batch task」的建立鏈：前端如何送出 `input` 與 `engineSettings`、後端如何把原始文字解析成 URL 清單、如何在 `tasks/{taskId}.json` 建立初始任務，以及如何決定走 Vercel Queue、inline fallback，或兩者混合的 dispatch 模式；至於 Crawl Job 預探索與單 URL 執行細節，分別屬於後續頁 11 與 12–13 的範圍。  
Sources: [page.tsx](../../../app/page.tsx#L566-L615), [crawl route.ts](../../../app/api/crawl/route.ts#L10-L98), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L78-L114), [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L1-L14)

## 核心流程總覽

```mermaid
flowchart TD
  A[Create 頁 handleSubmit] --> B[POST /api/crawl]
  B --> C[extractUrls(input, overrides)]
  C --> D{URL 數量 > hardLimit?}
  D -->|是| E[truncate]
  D -->|否| F[保留原列表]
  E --> G[generateTaskId + formatDate]
  F --> G
  G --> H[putTaskStatus tasks/{taskId}.json\nstatus=processing\nurls[]=pending]
  H --> I[dispatchCrawlJobs]
  I -->|queue| J[@vercel/queue crawl-urls]
  I -->|inline| K[processCrawlJobsInline]
  I -->|mixed| L[部分 queue + 剩餘 inline]
  J --> M[/api/queues/process-url]
  K --> N[processCrawlJob]
  L --> M
  L --> N
```

`/api/crawl` 本身不做實際抓取，它的責任是把輸入正規化成 URL 陣列、建立 `processing` 任務 JSON、再把每個 URL 打包成 `CrawlJobPayload` 交給 `dispatchCrawlJobs()`；真正的單 URL 抓取、清洗、寫回 raw/cleaned 與狀態更新，是 queue callback 或 inline fallback 共用的 `processCrawlJob()` 來處理。  
Sources: [crawl route.ts](../../../app/api/crawl/route.ts#L19-L98), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L78-L114), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L165-L248), [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L1-L14)

## 請求入口與輸入契約

前端 Create 頁的 `handleSubmit()` 會把目前 textarea 內容送成 `input`，並把 URL 數量上限、重試次數、單 URL timeout、清洗開關、Firecrawl、LLM、URL Extractor 與 R2 override 一起包進 `engineSettings` 後 POST 到 `/api/crawl`；成功後前端只先記住回傳的 `taskId`，之後靠 `/api/status/[taskId]` 輪詢狀態，而不是等待整批完成才拿結果。  
Sources: [page.tsx](../../../app/page.tsx#L566-L615), [page.tsx](../../../app/page.tsx#L472-L517), [crawl route.ts](../../../app/api/crawl/route.ts#L10-L17), [crawl route.ts](../../../app/api/crawl/route.ts#L90-L98)

| 請求/回應元素 | 實際欄位 | 用途 |
|---|---|---|
| Request body | `input` | 使用者貼上的原始文字，可是單一 URL、多行 URL、sitemap 或自由文字。 |
| Request body | `engineSettings.maxUrls` / `maxRetries` / `urlTimeout` / `enableClean` | 控制批次大小、重試上限、單 URL timeout 與是否做清洗。 |
| Request body | `firecrawlKey`、`llmApiKey`、`urlExtractorApiKey`、`r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName` | 只作為本次執行與儲存覆蓋，不直接原樣持久化進 task JSON。 |
| Response body | `taskId` / `urlCount` / `dispatchMode` / `message` / `urls` | 讓前端切換到監控流程，並知道本次實際建了幾個 URL 工作與採用哪種 dispatch 模式。 |

這個契約的關鍵不是「後端回傳完整結果」，而是「後端立即建立可追蹤的 task handle」：成功訊息只有 `Task queued successfully` 或 `Task started successfully`，代表任務建立與派送成功，不代表所有 URL 已經完成。  
Sources: [page.tsx](../../../app/page.tsx#L579-L605), [crawl route.ts](../../../app/api/crawl/route.ts#L90-L98), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L125-L149)

## URL 解析：從原始文字到 URL 清單

`extractUrls()` 的第一層分流非常直接：先把輸入按換行或逗號切開；若每一段都符合 URL 正則，單一 URL 會再檢查是否為 sitemap，若是則展開 sitemap，否則直接回傳該 URL；多行 URL 清單則直接去重後回傳。只有當輸入不是純 URL 清單時，才退回 LLM 模式從自由文字中抽 URL。  
Sources: [url-extractor.ts](../../../lib/processors/url-extractor.ts#L23-L50)

| 輸入形態 | `extractUrls()` 行為 | 主要實作 |
|---|---|---|
| 單一一般 URL | 直接回傳 `[url]` | `extractUrls()` |
| 單一 sitemap URL | 呼叫 `extractFromSitemap()` 抓 `<loc>`，必要時遞迴 sitemap index | `extractFromSitemap()` |
| 多行 / 逗號 URL 清單 | `new Set(...)` 去重後回傳 | `extractUrls()` |
| 自由文字 | 用 chat completion 要求輸出 `{"urls": [...]}` JSON，再 parse 成陣列 | `extractFromText()` |

LLM fallback 並不是硬編碼到單一供應商：它會優先吃前端覆蓋的 `baseUrl`、`apiKey`、`model`、`prompt`，否則退回 `URL_EXTRACTOR_BASE_URL`、`URL_EXTRACTOR_API_KEY`、`URL_EXTRACTOR_MODEL` 這組設定；而且要求 `responseFormat: 'json_object'`，若 parse 失敗就只記 log 並回傳空陣列。  
Sources: [url-extractor.ts](../../../lib/processors/url-extractor.ts#L111-L135), [config.ts](../../../lib/config.ts#L6-L11)

`/api/crawl` 會在 URL 解析完成後先做兩個 guard：沒有 `input` 或型別不是字串時直接回 `400 Missing or invalid input`，而解析結果為空時回 `400 No valid URLs found in input`；若 URL 數超過 `engineSettings.maxUrls` 或環境預設 `MAX_URLS_LIMIT`，則直接截斷到 hard limit 再繼續建立 task。  
Sources: [crawl route.ts](../../../app/api/crawl/route.ts#L12-L17), [crawl route.ts](../../../app/api/crawl/route.ts#L29-L40), [config.ts](../../../lib/config.ts#L32-L35)

## Task 初始化：`tasks/{taskId}.json` 寫了什麼

當 `/api/crawl` 取得最終 URL 清單後，會用 `generateTaskId()` 產生 UUID、用 `formatDate()` 產生 `YYYYMMDD` 分區日期、用 `summarizeDomains()` 抽出 `domains` 與 `domainSummary`，然後立刻把一份 `status: 'processing'` 的 `JobTask` 寫到 `tasks/${taskId}.json`；此時每個 URL 都只會被標成 `pending`，`completed` 與 `failed` 都從 0 開始。  
Sources: [crawl route.ts](../../../app/api/crawl/route.ts#L42-L75), [helpers.ts](../../../lib/utils/helpers.ts#L4-L16), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L71-L84), [r2.ts](../../../lib/r2.ts#L5-L22), [r2.ts](../../../lib/r2.ts#L137-L140)

`JobTask` 型別本身就把這份 JSON 的責任講得很清楚：它同時保存整體狀態、成功/失敗數、`failedUrls[]`、可選的 `retryingUrls[]`、逐 URL `urls[]` 狀態，以及 `date`、`createdAt`、`updatedAt`、`domains`、`domainSummary` 與儲存後的 `engineSettings`。因此 batch task 並不是只靠物件 key 命名來追蹤，而是一份完整可回讀的控制平面文件。  
Sources: [r2.ts](../../../lib/r2.ts#L5-L22), [tasks route.ts](../../../app/api/tasks/route.ts#L22-L54)

這裡有兩條常被混在一起的設定線：一條是「task 要寫到哪個 bucket / credentials」，所以 route 會根據 `r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName` 組出 `R2Overrides` 給 `putTaskStatus()`；另一條是「哪些設定要永久附在 task JSON 上」，所以 `sanitizeEngineSettingsForStorage()` 只保留非敏感的行為設定，會排除 Firecrawl、LLM、URL Extractor API keys 與 R2 認證相關 key 名稱。  
Sources: [crawl route.ts](../../../app/api/crawl/route.ts#L49-L57), [r2.ts](../../../lib/r2.ts#L24-L30), [r2.ts](../../../lib/r2.ts#L54-L87), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L27-L30), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L125-L149)

## Dispatch：queue、inline、mixed 三種建立結果

`dispatchCrawlJobs()` 先判斷 runtime 能不能用背景 queue：只有 `NODE_ENV === 'development'` 或 `VERCEL === '1'` 時才會走 `@vercel/queue.send()`；否則整批 job 直接改走 `processCrawlJobsInline()`，回傳 `dispatchMode = 'inline'`。這也是為什麼 `/api/crawl` 的成功訊息有時是 queued、有時只是 started。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L56-L64), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L78-L89), [crawl route.ts](../../../app/api/crawl/route.ts#L79-L98)

即使 runtime 允許 queue，`dispatchCrawlJobs()` 也不是「送失敗就整批炸掉」：只要錯誤訊息看起來像 OIDC / 非 Vercel Function / project root 缺失這類 queue 不可用情境，它就會把尚未成功送出的剩餘 jobs 改成交給 inline processor，並依照已送出數量回傳 `inline` 或 `mixed`。測試也明確驗證了三種結果：完全無法用 queue 時是 `inline`、第一筆就失敗會把整批 inline、前幾筆已送出而後續失敗時則是 `mixed`，而且只補跑未入列的 pending jobs。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L66-L114), [crawl-dispatch.test.ts](../../../tests/crawl-dispatch.test.ts#L22-L81)

不論是 queue callback 還是 inline fallback，最後都會落到同一個 `processCrawlJob()`：它先把單筆 URL 標成 `processing`，再抓 raw markdown、視需要做清洗、寫入 `raw/` 與 `cleaned/`，最後用 `updateTaskStatus()` 回寫成功或失敗；queue 版本的 HTTP 入口只是 `app/api/queues/process-url/route.ts` 這個很薄的 wrapper，負責把訊息交給 `processCrawlJob()`，並用 `getCrawlRetryDirective()` 產生 retry 策略。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L129-L145), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L165-L259), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L261-L327), [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L1-L14)

## 建立後如何回到前端監控與歷史任務

前端在 `/api/crawl` 成功後只做一件關鍵事：`setTaskId(data.taskId)`。接著頁面會每 3 秒拉一次 `/api/status/${taskId}`，若任務仍是 `processing` 會自動打開 Drawer；這代表 batch 建立 API 的核心價值是立即回傳一個可監控的 task handle，而不是同步等待內容處理完成。  
Sources: [page.tsx](../../../app/page.tsx#L602-L623), [page.tsx](../../../app/page.tsx#L472-L517)

同一份 task JSON 也會直接成為 Tasks 分頁的歷史來源：`/api/tasks` 只是列出 `tasks/` prefix、按 R2 `LastModified` 由新到舊取前 20 筆、再逐一用 `getTaskStatus()` 回讀完整 JSON；如果舊 task 沒有 `domainSummary`，它還會從 `urls[]` 或 `failedUrls[]` 反推網域摘要。換句話說，`/api/crawl` 建立 task 的那一刻，就已經把未來的狀態輪詢與歷史列表入口一起種好了。  
Sources: [tasks route.ts](../../../app/api/tasks/route.ts#L6-L54), [r2.ts](../../../lib/r2.ts#L137-L149), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L71-L84), [page.tsx](../../../app/page.tsx#L519-L550)

## 關鍵模組／檔案導覽

| 檔案 | 在本頁流程中的角色 |
|---|---|
| `app/page.tsx` | Create 頁的 `handleSubmit()`、成功後 `setTaskId()`、狀態輪詢與歷史任務載入。 |
| `app/api/crawl/route.ts` | 驗證輸入、呼叫 `extractUrls()`、套用 URL 上限、建立初始 task、觸發 dispatch。 |
| `lib/processors/url-extractor.ts` | 把 raw input 解析成 URL list，支援純 URL、sitemap 與 LLM fallback。 |
| `lib/utils/helpers.ts` | 生成 task UUID 與 `YYYYMMDD` 日期。 |
| `lib/utils/task-metadata.ts` | 產生網域摘要，並在儲存 task 前脫敏 `engineSettings`。 |
| `lib/r2.ts` | 定義 `JobTask` / `R2Overrides`，把 task JSON 寫入 `tasks/{taskId}.json`。 |
| `lib/services/crawl-dispatch.ts` | 封裝 queue/inline/mixed dispatch，以及後續共用的 URL 執行入口。 |
| `app/api/queues/process-url/route.ts` | Vercel Queue callback 入口，將訊息轉交給 `processCrawlJob()`。 |
| `app/api/tasks/route.ts` | 之後把 `tasks/` prefix 回讀成 Tasks 歷史列表。 |

如果你在 trace「為什麼按下 Start Crawl & Process 後會立刻出現 task，但內容還沒完成」這種問題，實務上最短路徑就是：先看 `app/page.tsx` 的 submit/polling，再看 `app/api/crawl/route.ts` 的 task 初始化，最後看 `crawl-dispatch.ts` 的 `dispatchMode` 決策。  
Sources: [page.tsx](../../../app/page.tsx#L472-L550), [page.tsx](../../../app/page.tsx#L566-L615), [crawl route.ts](../../../app/api/crawl/route.ts#L10-L98), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L78-L114)

## 常見誤解與邊界

第一個常見誤解是把 `/api/crawl` 當成「網站探索 API」。其實它不會主動去某個首頁抓 links；它只吃既有輸入文字，靠 `extractUrls()` 解析出 URL 清單。若要先從單一入口網址探索出 links，再轉成 batch task，真正的前置 API 是 `/api/crawl-job`，那是下一頁要講的預探索流程。  
Sources: [crawl route.ts](../../../app/api/crawl/route.ts#L12-L40), [url-extractor.ts](../../../lib/processors/url-extractor.ts#L23-L50), [page.tsx](../../../app/page.tsx#L758-L827)

第二個常見誤解是把回應裡的 `dispatchMode: 'queue'` 視為「一定純背景執行」。實際上只有成功送進 `@vercel/queue` 的那些 jobs 會走 callback；若 queue 在送出過程中暴露 OIDC 或環境錯誤，系統會把剩餘工作改成交由 inline processor，並把回應模式改成 `inline` 或 `mixed`。  
Sources: [crawl route.ts](../../../app/api/crawl/route.ts#L79-L98), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L66-L114), [crawl-dispatch.test.ts](../../../tests/crawl-dispatch.test.ts#L41-L81)

第三個常見誤解是以為 task JSON 會保存所有 API key 與 R2 認證，好讓之後完全重播。事實上它只保存脫敏後的 `engineSettings`，而真正的敏感執行設定只存在於本次 request、dispatch 時帶入的 `engineSettings` 與環境配置中；另外，若環境端沒有預設 R2 credentials，而前端也沒有提供完整覆蓋，`lib/r2.ts` 會直接拋錯，錯誤訊息中明確要求設定 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。  
Sources: [page.tsx](../../../app/page.tsx#L579-L605), [crawl route.ts](../../../app/api/crawl/route.ts#L79-L85), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L9-L31), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L27-L30), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L125-L167), [r2.ts](../../../lib/r2.ts#L35-L40), [r2.ts](../../../lib/r2.ts#L58-L87), [config.ts](../../../lib/config.ts#L26-L31)
