# 單一 URL 工作：抓取、清洗、儲存、更新任務

本頁只講 batch crawl 裡的「單一 URL worker」：`/api/crawl` 先建立 `tasks/{taskId}.json`，再把每個 URL 打包成 `CrawlJobPayload`；之後不論是 Vercel Queue callback 還是 inline fallback，最後都會落到 `processCrawlJob()`。這條 worker 使用的是只回傳 markdown 字串的 `scrapeUrl()`，所以它的核心責任是抓取、清洗、把 raw/cleaned 寫進 R2，並回寫 task counters，而不是提供單頁預覽用的進階 metadata。  
Sources: [crawl route.ts](../../../app/api/crawl/route.ts#L42-L98), [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L1-L14), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L165-L248), [crawler.ts](../../../lib/services/crawler.ts#L31-L53)

## 核心流程總覽

```mermaid
flowchart TD
  A[/api/crawl 建立 task/] --> B[dispatchCrawlJobs]
  B -->|queue| C[/api/queues/process-url]
  B -->|inline| D[processCrawlJobsInline]
  C --> E[processCrawlJob]
  D --> E
  E --> F[markUrlProcessing]
  F --> G[scrapeUrl 取得 raw markdown]
  G --> H[putObject raw/...]
  H --> I{enableClean !== false\n且 raw 非空?}
  I -->|是| J[cleanContent]
  I -->|否| K[沿用 raw 當 cleanedMarkdown]
  J --> L[putObject cleaned/...]
  K --> L
  L --> M{成功?}
  M -->|成功| N[updateTaskStatus success]
  M -->|失敗| O[logRetryAttempt 或 updateTaskStatus failed]
```

真正的收斂點只有一個：queue callback 入口 `app/api/queues/process-url/route.ts` 只是把訊息交給 `processCrawlJob()`，而 inline fallback 只是用 while-loop 重複呼叫同一個函式；因此 raw/cleaned 寫檔、重試紀錄、成功/失敗計數與 URL 細項狀態，全部都集中在 `lib/services/crawl-dispatch.ts` 這一個 worker 實作。  
Sources: [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L5-L14), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L165-L259)

## 入口：task 與 job payload 如何交棒

`/api/crawl` 在抽出 URL 清單後，會先生成 `taskId`、`date`、`createdAt`，把整份 `JobTask` 以 `status: 'processing'`、`urls[].status: 'pending'` 寫到 `tasks/{taskId}.json`，然後才把每個 URL 映射成 `{ taskId, url, date, engineSettings }` 的 `CrawlJobPayload` 交給 `dispatchCrawlJobs()`。也就是說，單一 URL worker 執行前，控制平面文件已經先落地，後續所有更新都是回寫同一份 task JSON。  
Sources: [crawl route.ts](../../../app/api/crawl/route.ts#L42-L86), [r2.ts](../../../lib/r2.ts#L5-L22), [r2.ts](../../../lib/r2.ts#L137-L149)

task 內保存的 `engineSettings` 不是原封不動的 request body；`sanitizeEngineSettingsForStorage()` 會排除 `firecrawlKey`、`llmApiKey`、`urlExtractorApiKey`、`r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName` 這些敏感欄位，只保留 `llmModel`、`llmBaseUrl`、`cleaningPrompt`、`enableClean`、`maxRetries`、`urlTimeout` 等非敏感行為設定，測試也明確驗證了這個脫敏結果。  
Sources: [task-metadata.ts](../../../lib/utils/task-metadata.ts#L27-L30), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L125-L149), [crawl route.ts](../../../app/api/crawl/route.ts#L60-L75), [task-metadata.test.ts](../../../tests/task-metadata.test.ts#L59-L85)

## 單一 URL 執行序：從 processing 到 raw / cleaned

worker 進入 `processCrawlJob()` 後，第一步是依 `engineSettings` 提取可選的 R2 overrides，再呼叫 `markUrlProcessing()` 把目前 URL 從 `pending` 或 `failed` 改成 `processing`。接著它用 `engineSettings.urlTimeout`（預設 300 秒）包住整個 scrape/clean/store 流程，並把 `firecrawlKey`、`firecrawlUrl` 送進 `scrapeUrl()`；而 `scrapeUrl()` 本身只向 Firecrawl 要 `formats: ['markdown']`，成功時也只回傳 markdown 字串。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L116-L185), [crawler.ts](../../../lib/services/crawler.ts#L31-L53), [config.ts](../../../lib/config.ts#L32-L35)

raw 檔的 key 由 `buildR2Key(url, 'raw', date)` 組成：它會取 hostname 當網域層級、保留 URL pathname 當資料夾結構，空路徑退回 `index`，並把沒有副檔名或 `.html` 的尾端正規化成 `.md`。worker 在拿到 raw markdown 後立刻把它寫到 `raw/{date}/{domain}/...`，這一步早於任何清洗與成功狀態回寫。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L182-L186), [helpers.ts](../../../lib/utils/helpers.ts#L21-L44), [r2.ts](../../../lib/r2.ts#L89-L100)

清洗階段的預設行為不是「沒開 clean 就跳過 cleaned 檔」；相反地，`cleanedMarkdown` 先預設成 `rawMarkdown`，只有在 `enableClean !== false` 且內容非空時才呼叫 `cleanContent()`。因此 batch worker 最後一定會寫 `cleaned/{date}/{domain}/...`，只是當 clean 被關掉或 raw 為空時，cleaned 檔內容會是 raw 的直通副本；若有啟用 clean，則會把 `llmModel`、`llmApiKey`、`llmBaseUrl`、`cleaningPrompt` 傳給 LLM 清洗器。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L188-L202), [cleaner.ts](../../../lib/processors/cleaner.ts#L55-L87)

R2 寫入本身也不是 best-effort 背景附加功能；`putObject()` 與 `putTaskStatus()` 都會先經過 `resolveR2()`。如果環境端沒有 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`，而這次執行又沒有帶完整 override，worker 會直接丟錯；只有單獨覆蓋 `bucketName` 時，才會沿用環境端的預設 client。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L167-L185), [r2.ts](../../../lib/r2.ts#L35-L40), [r2.ts](../../../lib/r2.ts#L58-L87), [r2.ts](../../../lib/r2.ts#L92-L100), [r2.ts](../../../lib/r2.ts#L137-L140)

## 任務狀態更新：成功、失敗、重試中的欄位變化

成功路徑非常直接：worker 寫完 raw 與 cleaned 之後呼叫 `updateTaskStatus(taskId, url, true)`，讓 `completed += 1`、把該 URL 的 `urls[]` 狀態改成 `success`、移除 `retryingUrls` 中同 URL 的項目，並在 `completed + failed >= total` 時把整個 task 標成 `completed`。這代表這裡的 `completed` 是「整批已經到終態」，不是「所有 URL 都成功」。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L204-L205), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L261-L297), [r2.ts](../../../lib/r2.ts#L5-L22)

失敗路徑則依 `engineSettings.maxRetries` 或環境預設 `RETRY_ATTEMPTS` 決定是否為 final attempt：非最後一次失敗時，worker 只更新 `retryingUrls[]` 與 `updatedAt`；到了 final attempt，才會讓 `failed += 1`、把錯誤寫進 `failedUrls[]` 與對應的 `urls[].error`，然後丟出 `QueueRetryError`。queue retry directive 則使用 `min(120, 2^deliveryCount * 10)` 的 exponential backoff。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L208-L223), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L250-L258), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L303-L327), [config.ts](../../../lib/config.ts#L32-L35)

inline fallback 也遵守同一套 retry 邏輯：`processCrawlJobsInline()` 從 `deliveryCount = 1` 開始，不斷呼叫 `processCrawlJob()`；只有在成功或 `deliveryCount >= error.maxRetries` 時才跳出迴圈。換句話說，queue 與 inline 的差異主要在投遞載體，不在單 URL 狀態機本身。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L227-L248), [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L5-L14)

## 與 Retry / Abort API 的銜接

`/api/retry` 並沒有自建另一套 worker；它會先回讀既有 task、把要重跑的 URL 改回 `pending`，必要時清空 `failedUrls[]` / `retryingUrls[]` / counters，然後再把相同的 `{ taskId, url, date, engineSettings }` payload 送回 `dispatchCrawlJobs()`。若是 `retryAll`，它還會用 `mergeStoredTaskEngineSettingsForRetry()` 把 task 內脫敏後保留的行為設定，跟本次請求帶來的 runtime secrets 重新合併。  
Sources: [retry route.ts](../../../app/api/retry/route.ts#L30-L109), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L151-L167), [task-metadata.test.ts](../../../tests/task-metadata.test.ts#L87-L120)

`/api/abort` 做的事情則更像人工狀態修補：它只會把指定 URL 在 task JSON 裡從 `pending` / `processing` 改成 `failed` 並寫入 `User aborted`，沒有把任何 cancel flag 傳給 `processCrawlJob()`；而 `processCrawlJob()` 自身也只根據 scrape/clean/store 成敗更新 task，不會先檢查某個 abort 狀態。因此從程式結構來看，Abort 會改變控制平面顯示結果，但不是對執行中抓取呼叫的真正中斷。  
Sources: [abort route.ts](../../../app/api/abort/route.ts#L35-L58), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L165-L225), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L261-L327)

## 關鍵模組／檔案導覽

| 檔案 | 在本頁流程中的角色 |
|---|---|
| `app/api/crawl/route.ts` | 建立 batch task、初始化 `tasks/{taskId}.json`、把每個 URL 轉成 `CrawlJobPayload`。 |
| `app/api/queues/process-url/route.ts` | Vercel Queue callback 入口，只負責把 message 交給 `processCrawlJob()` 並套 retry directive。 |
| `lib/services/crawl-dispatch.ts` | 單一 URL worker 主體：processing 標記、scrape、clean、R2 寫檔、task 更新、重試紀錄、inline fallback。 |
| `lib/services/crawler.ts` | 包裝 Firecrawl；本流程使用 `scrapeUrl()`，只要求 markdown 格式。 |
| `lib/processors/cleaner.ts` | LLM 清洗器，負責把 raw markdown 轉成 cleaned markdown。 |
| `lib/utils/helpers.ts` | 產生 `raw/`、`cleaned/` 的 R2 key 規則。 |
| `lib/r2.ts` | 定義 `JobTask` / `R2Overrides`，並提供 task JSON 與一般物件的 R2 讀寫。 |
| `app/api/retry/route.ts` / `app/api/abort/route.ts` | 不是 worker 本體，但會回寫同一份 task JSON，並影響後續單 URL 狀態流轉。 |

如果你要 trace 某個 URL 為什麼顯示 `processing`、為什麼有 raw 但沒有 cleaned、或為什麼 task 已 completed 但仍有 failedUrls，最短閱讀順序通常就是：`crawl-dispatch.ts` → `helpers.ts` / `r2.ts` → `retry` / `abort` 兩個修補 API。  
Sources: [crawl route.ts](../../../app/api/crawl/route.ts#L42-L98), [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L1-L14), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L78-L327), [crawler.ts](../../../lib/services/crawler.ts#L31-L53), [cleaner.ts](../../../lib/processors/cleaner.ts#L55-L87), [helpers.ts](../../../lib/utils/helpers.ts#L21-L44), [r2.ts](../../../lib/r2.ts#L5-L157), [retry route.ts](../../../app/api/retry/route.ts#L30-L109), [abort route.ts](../../../app/api/abort/route.ts#L35-L58)

## 常見誤解與踩坑

第一個常見誤解是把這條 worker 想成「進階單頁 scrape」。其實 batch worker 走的是 `scrapeUrl()`，只拿 markdown 字串，沒有保存 `scrapeUrlAdvanced()` 那種 metadata 結果；所以它比較像穩定的大量 URL 處理管線，而不是前端預覽模式的富回應 API。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L177-L182), [crawler.ts](../../../lib/services/crawler.ts#L34-L53), [crawler.ts](../../../lib/services/crawler.ts#L71-L108)

第二個常見誤解是把這條流程當成全有全無交易。實際上 raw 檔先寫、clean 後寫、最後才回寫 success 狀態；因此只要清洗或後續步驟失敗，就可能出現「raw 已存在、cleaned 缺失、task 仍是 failed 或 retrying」的中間狀態，程式裡也沒有對先前 raw 寫入做補償刪除。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L182-L223), [r2.ts](../../../lib/r2.ts#L89-L100)

第三個常見誤解是把 `task.status === 'completed'` 解讀成「全部成功」。在這套模型裡，`completed` 只是代表 `completed + failed >= total`；因此一個 task 可能同時有 `status: 'completed'` 和非空的 `failedUrls[]`，Abort API 也沿用這個同樣的完成判定。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L269-L297), [abort route.ts](../../../app/api/abort/route.ts#L52-L58)

第四個值得注意的實作細節是重試停止條件並非同一個比較式：`processCrawlJob()` 用 `deliveryCount >= maxRetries` 判定 final attempt，但 `getCrawlRetryDirective()` 要到 `deliveryCount > maxRetries` 才回 `{ acknowledge: true }`。因此閱讀 queue 實際停止時機時，不能只看其中一邊，還要把 Vercel Queue 的 `deliveryCount` 語義一起納入。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L211-L223), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L250-L258)

## 證據缺口與驗證空白

目前 repo 內可見的 `tests/crawl-dispatch.test.ts` 三個案例都聚焦在 `dispatchCrawlJobs()` 的 queue / inline / mixed fallback 分流，而不是 `processCrawlJob()` 自身的 scrape→clean→store→status 狀態機；另外 `tests/task-metadata.test.ts` 也主要驗證脫敏與 retry 合併規則。這表示本頁對 worker 細節的描述主要來自實作碼本身，而不是獨立的端到端測試佐證。  
Sources: [crawl-dispatch.test.ts](../../../tests/crawl-dispatch.test.ts#L22-L81), [task-metadata.test.ts](../../../tests/task-metadata.test.ts#L59-L120)
