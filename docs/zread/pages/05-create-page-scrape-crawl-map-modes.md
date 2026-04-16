# 建立頁的三種模式：Scrape、Crawl、Map

本頁只解釋 Create 分頁裡 `sourceType` 的三種來源模式如何切換前端表單、後端路由與結果呈現；它的核心不是三個完全獨立的子系統，而是一個共用建立頁，依照 `scrape`、`crawl`、`map` 三種狀態改變輸入欄位、按鈕行為，以及下方是顯示即時預覽還是 Queue Tracker。Sources: [page.tsx](app/page.tsx#L92-L95), [page.tsx](app/page.tsx#L1120-L1158), [page.tsx](app/page.tsx#L1461-L1559)

## 一張圖看懂三種模式

```mermaid
flowchart TD
  A[Create 頁] --> B{sourceType}
  B -->|Scrape| C[inputValue]
  C --> D{單一 URL?}
  D -->|是| E[/api/scrape]
  E --> F[runSingleScrapeTask]
  F --> G[即時預覽 + task 回傳]
  D -->|否：多 URL / sitemap| H[handleSubmit]
  H --> I[/api/crawl]
  I --> J[extractUrls + 建立 task + dispatch]

  B -->|Crawl| K[crawlUrl + crawlLimit]
  K --> L[/api/crawl-job]
  L --> M[輪詢 jobId 直到取得 links]
  M --> H

  B -->|Map| N[mapUrl + search + limit]
  N --> O[/api/map]
  O --> P[urls + count]
  P --> Q[append 回 inputValue]
  Q --> R[Use in Scrape / Use in Crawl]
```

這三種模式最大的差別，在於「URL 是誰先找出來、找到後是否立刻建立 task」：Scrape 可以直接打單頁預覽，也可以退化成批次 submit；Crawl 會先跑一個 Firecrawl crawl job 找 links，再自動建立批次 task；Map 只負責把 URL 清單找回來塞進畫面，讓使用者決定下一步。Sources: [page.tsx](app/page.tsx#L566-L827), [page.tsx](app/page.tsx#L1124-L1453), [app/api/scrape/route.ts](app/api/scrape/route.ts#L4-L37), [app/api/crawl-job/route.ts](app/api/crawl-job/route.ts#L4-L67), [app/api/map/route.ts](app/api/map/route.ts#L8-L96)

## 模式對照表

| 模式 | 前端主要輸入 | 第一個後端入口 | 中介步驟 | 最終結果 |
|---|---|---|---|---|
| Scrape | `inputValue` 文字框與單頁 scrape 參數 | [`/api/scrape`](app/api/scrape/route.ts#L4-L37) 或 [`/api/crawl`](app/api/crawl/route.ts#L10-L98) | 單一 URL 走 `runSingleScrapeTask()`；多 URL / sitemap 轉 `handleSubmit()` | 即時預覽或批次 task |
| Crawl | `crawlUrl`、`crawlLimit` | [`/api/crawl-job`](app/api/crawl-job/route.ts#L4-L67) | 先拿 `jobId`、輪詢 links，再把 links 丟給 [`/api/crawl`](app/api/crawl/route.ts#L10-L98) | 直接建立批次 task |
| Map | `mapUrl`、`mapSearch`、`mapLimit` | [`/api/map`](app/api/map/route.ts#L8-L96) | 把 `urls` append 回 `inputValue`，再由使用者切去 Scrape 或 Crawl | 先得到 URL 清單，不直接建立 task |

這張表對照的是「Create 頁操作模型」而不是 Firecrawl 產品名；也就是說，頁面上的 Scrape/Crawl/Map 是三種 UI 工作模式，而不是三個互不相通的後端資料流。Sources: [page.tsx](app/page.tsx#L566-L827), [page.tsx](app/page.tsx#L1124-L1453), [app/api/crawl/route.ts](app/api/crawl/route.ts#L10-L98)

## 模式拆解

Scrape 模式其實是「智慧入口」而不是「保證單頁」：UI 文案已明說 single URL 走 instant preview、multiple URLs 或 sitemap 走 batch queue；實作上 `handleScrape()` 會先檢查 `inputValue` 是否包含多行、逗號，或以 `.xml` 結尾，若是就直接改呼叫 `handleSubmit()`，只有單一 URL 才 POST `/api/scrape`。Sources: [page.tsx](app/page.tsx#L675-L756), [page.tsx](app/page.tsx#L1161-L1297), [app/api/crawl/route.ts](app/api/crawl/route.ts#L10-L33)

單頁 Scrape 的後端很薄，真正工作都在 `runSingleScrapeTask()`：它先建立一筆 `processing` 的 `JobTask`，再用 `scrapeUrlAdvanced()` 抓 markdown，依 `enableClean` 決定是否經過 Cleaner，依 `saveToR2` 決定是否寫 raw/cleaned markdown 到 R2，最後把 task 更新成 `completed` 或 `failed`，並把 `taskId`、`task`、內容長度與 R2 keys 一起回傳。Sources: [app/api/scrape/route.ts](app/api/scrape/route.ts#L4-L37), [lib/services/scrape-task.ts](lib/services/scrape-task.ts#L155-L240), [lib/services/crawler.ts](lib/services/crawler.ts#L71-L108)

Scrape 單頁與批次 submit 也使用兩套不同的參數打包方式：`handleSubmit()` 送的是 `maxUrls`、`maxRetries`、`urlTimeout`、`enableClean`、URL Extractor、LLM 與 R2 覆蓋；`handleScrape()` 則額外送 `waitFor`、`timeout`、`onlyMainContent`、`mobile`、`includeTags`、`excludeTags`、`scrapeEnableClean` 與 `scrapeSaveToR2`。這也是為什麼「Advanced Engine Settings」只在非 Scrape 模式打開，而單頁 Scrape 有自己的一組 page-level options。Sources: [page.tsx](app/page.tsx#L578-L600), [page.tsx](app/page.tsx#L698-L721), [page.tsx](app/page.tsx#L1659-L1668)

Crawl 模式使用另一組獨立 state：它讀的是 `crawlUrl` 與 `crawlLimit`，按下 `Start Crawl & Process` 後先 POST `/api/crawl-job` 取得 `jobId`，再輪詢同一路由的 GET 直到狀態 `completed`；若拿到 links，前端不先寫回 textarea，而是直接把 links join 成換行文字交給 `handleSubmit()`，因此 Crawl 模式是「先探索、再立即送批次 task」。Sources: [page.tsx](app/page.tsx#L758-L827), [page.tsx](app/page.tsx#L1301-L1358), [app/api/crawl-job/route.ts](app/api/crawl-job/route.ts#L4-L67)

這條 Crawl 預探索鏈在後端也很明確：`startCrawlJob()` 用 Firecrawl `asyncCrawlUrl()` 啟動非同步工作，而且 `scrapeOptions.formats` 只要求 `links`；等 GET `/api/crawl-job` 查到完成後，route 會從 `metadata.sourceURL` 或 `url` 抽出結果並去重，最後再交給 `/api/crawl` 建 task 與 dispatch。Sources: [lib/services/crawler.ts](lib/services/crawler.ts#L110-L151), [app/api/crawl-job/route.ts](app/api/crawl-job/route.ts#L34-L67), [app/api/crawl/route.ts](app/api/crawl/route.ts#L42-L98)

Map 模式則是比較手動的 URL 蒐集器：`handleMapFetch()` 把 `mapUrl`、`mapSearch`、`mapLimit` 與可選 `firecrawlKey` POST 到 `/api/map`，成功後只會把回傳的 `urls` append 回共用的 `inputValue`，並記住 `count` 做成功提示；它不建立 task，也不直接 dispatch queue。Sources: [page.tsx](app/page.tsx#L626-L673), [page.tsx](app/page.tsx#L1362-L1453), [app/api/map/route.ts](app/api/map/route.ts#L8-L96)

Map 的下一步是顯式由使用者決定：`Use in Scrape` 只是切回 `sourceType = 'scrape'`，`Use in Crawl` 則是把 `inputValue.split('\n')[0]` 塞進 `crawlUrl` 後切到 Crawl；換句話說，Map 結果不是自動餵給 Crawl 全量執行，而是提供一個人工接線點。Sources: [page.tsx](app/page.tsx#L1436-L1453)

另外，`/api/map` 後端其實支援 `includeSubdomains`，且預設 `true`；但當前 create 頁送出的 body 只有 `url`、`search`、`limit` 與 `firecrawlKey`，所以子網域策略目前由後端預設主導，而不是由此頁顯式切換。Sources: [page.tsx](app/page.tsx#L638-L646), [app/api/map/route.ts](app/api/map/route.ts#L10-L40)

## 關鍵模組／檔案導覽

| 檔案 | 在本頁的角色 |
|---|---|
| [`app/page.tsx#L92-L95`](app/page.tsx#L92-L95) | 定義 `sourceType` 與 Create 分頁的初始模式。 |
| [`app/page.tsx#L566-L827`](app/page.tsx#L566-L827) | 集中 `handleSubmit`、`handleMapFetch`、`handleScrape`、`handleCrawl` 四個入口 handler。 |
| [`app/page.tsx#L1124-L1559`](app/page.tsx#L1124-L1559) | 定義三模式切換 UI、Map 結果轉移按鈕，以及 Preview/Tracker 切換條件。 |
| [`app/api/scrape/route.ts#L4-L37`](app/api/scrape/route.ts#L4-L37) | 單頁 Scrape API，將請求委派到 task service。 |
| [`lib/services/scrape-task.ts#L155-L240`](lib/services/scrape-task.ts#L155-L240) | 單頁 scrape 的 task 建立、Cleaner、R2 寫入與成功/失敗狀態更新。 |
| [`app/api/crawl-job/route.ts#L4-L67`](app/api/crawl-job/route.ts#L4-L67) | Crawl 預探索 job 的 start / poll API。 |
| [`lib/services/crawler.ts#L110-L151`](lib/services/crawler.ts#L110-L151) | Firecrawl async crawl 與 job status 檢查封裝。 |
| [`app/api/crawl/route.ts#L10-L98`](app/api/crawl/route.ts#L10-L98) | 建立批次 task、寫入 task metadata、觸發 dispatch。 |
| [`lib/processors/url-extractor.ts#L23-L135`](lib/processors/url-extractor.ts#L23-L135) | 把 sitemap、URL list 或自由文字解析成 URL 陣列。 |
| [`app/api/map/route.ts#L8-L96`](app/api/map/route.ts#L8-L96) | 呼叫 Firecrawl Map API，回傳 `urls` 與 `count`。 |
| [`app/api/tasks/route.ts#L22-L87`](app/api/tasks/route.ts#L22-L87) + [`lib/r2.ts#L137-L149`](lib/r2.ts#L137-L149) | 把 `tasks/{taskId}.json` 當成歷史任務來源，供 Tasks 分頁讀取。 |

上表可以視為本頁的最小追蹤索引：想理解模式切換先看 `app/page.tsx`，想理解後端分流再看 `scrape` / `crawl-job` / `crawl` / `map` 四個 route，想理解 task 為何會出現在歷史裡就看 `scrape-task.ts`、`app/api/tasks/route.ts` 與 `lib/r2.ts`。Sources: [app/page.tsx](app/page.tsx#L92-L95), [app/page.tsx](app/page.tsx#L566-L827), [app/page.tsx](app/page.tsx#L1124-L1559), [app/api/tasks/route.ts](app/api/tasks/route.ts#L22-L87), [lib/r2.ts](lib/r2.ts#L137-L149)

## 任務、預覽與歷史如何接在一起

Create 頁下半部不是單純跟著模式切，而是看 `sourceType === 'scrape' && !taskId`：只有 Scrape 且尚未綁定 task 時，畫面才保留即時預覽面板；一旦已有 `taskId`，或目前不是 Scrape，頁面就改顯示 Queue Tracker。前端同時會每 3 秒向 `/api/status/[taskId]` 拉一次任務狀態，並在 `taskId` 被設定且任務仍在處理時自動打開 Drawer。Sources: [page.tsx](app/page.tsx#L472-L517), [page.tsx](app/page.tsx#L727-L736), [page.tsx](app/page.tsx#L1461-L1559), [app/api/status/[taskId]/route.ts](app/api/status/[taskId]/route.ts#L5-L63)

批次 Crawl 與單頁 Scrape 都會落到同一個 task 儲存模型：`/api/crawl` 用 `putTaskStatus()` 建立批次 `processing` task，`runSingleScrapeTask()` 也會先建單頁 task 再更新最終狀態，而 `putTaskStatus()` 實際寫入的位置就是 `tasks/${taskId}.json`。`/api/tasks` 又是直接列出 `tasks/` prefix 後回讀完整 JSON，因此單頁 Scrape 雖然 UI 偏向預覽，仍然能以標準 task 身分出現在歷史任務清單。Sources: [app/api/crawl/route.ts](app/api/crawl/route.ts#L59-L98), [lib/services/scrape-task.ts](lib/services/scrape-task.ts#L163-L240), [lib/r2.ts](lib/r2.ts#L134-L149), [app/api/tasks/route.ts](app/api/tasks/route.ts#L22-L87)

## 常見誤解／踩坑

- **「選了 Scrape 就一定打 `/api/scrape`」是錯的。** 只要輸入是多 URL、逗號分隔清單或 sitemap，`handleScrape()` 會直接改走 `handleSubmit()`，最後進 `/api/crawl` 的批次路徑。 Sources: [page.tsx](app/page.tsx#L675-L690), [app/api/crawl/route.ts](app/api/crawl/route.ts#L10-L33), [lib/processors/url-extractor.ts](lib/processors/url-extractor.ts#L23-L50)
- **Map 不會直接建立 task。** 它只回傳 `urls` 與 `count`，前端再把結果 append 回 `inputValue`；如果要真的執行，還要再切去 Scrape 或 Crawl。 Sources: [page.tsx](app/page.tsx#L655-L660), [page.tsx](app/page.tsx#L1436-L1453), [app/api/map/route.ts](app/api/map/route.ts#L84-L96)
- **Crawl 不會先把探索結果回填到 textarea。** 它在拿到 links 後直接 `await handleSubmit(queueInput)` 建正式 task，這和 Map 的「先回填、再人工決定下一步」是兩種不同互動。 Sources: [page.tsx](app/page.tsx#L816-L820), [page.tsx](app/page.tsx#L655-L660)
- **Map 的 `Use in Crawl` 不是把整份 map 結果餵進 Crawl。** 它只取 `inputValue` 第一行來設定 `crawlUrl`，所以這個按鈕更像切換入口點，而不是直接複用整份 URL 清單。 Sources: [page.tsx](app/page.tsx#L1446-L1448)
- **Scrape 畫面雖然有 `scrapeTargetUrl` state，實際使用的仍是共用 `inputValue`。** 目前的 textarea 綁在 `inputValue`，Map 也把結果 append 進同一欄，因此這個共享輸入框才是三模式之間最重要的交會點。 Sources: [page.tsx](app/page.tsx#L94-L95), [page.tsx](app/page.tsx#L127-L147), [page.tsx](app/page.tsx#L1165-L1173), [page.tsx](app/page.tsx#L655-L660), [page.tsx](app/page.tsx#L675-L685)
