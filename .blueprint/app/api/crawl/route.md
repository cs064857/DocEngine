# POST /api/crawl

## 職責契約

批次爬取任務的**入口編排器**：從自由文字抽出 URL、建立 R2 任務追蹤、再委派 `dispatchCrawlJobs` 啟動實際抓取。

- **做**：輸入驗證、URL 抽取（可覆寫 LLM 設定）、硬上限截斷、`taskId` 生成、R2 初始狀態寫入、分發佇列/直跑。
- **不做**：單頁 scrape 實作、Firecrawl 呼叫、佇列回呼處理、重試/中止邏輯（分屬 scrape / crawl-dispatch / process-url / retry / abort）。

## 接口摘要

`POST(req: NextRequest) → NextResponse`

| 面向 | 形狀 |
|------|------|
| **Input** | `{ input: string, engineSettings?: { urlExtractor*, maxUrls, r2*, … } }` |
| **Output 200** | `{ taskId, urlCount, dispatchMode: 'queue'\|…, message, urls[] }` |
| **Output 4xx/5xx** | `{ error, details? }` |
| **Side Effect** | `putTaskStatus` 寫入 R2（status=`processing`、全 URL `pending`）；呼叫 `dispatchCrawlJobs` |
| **Constraints** | `input` 必為非空字串；抽出 0 條 URL → 400；超過 `maxUrls`/`config.project.maxUrlsLimit` 則截斷 |

## 依賴拓撲

```
Client → **POST /api/crawl**
           ├→ extractUrls (url-extractor + engineSettings 覆寫)
           ├→ generateTaskId / formatDate / summarizeDomains / sanitizeEngineSettingsForStorage
           ├→ putTaskStatus (R2, 可 r2Overrides)
           └→ dispatchCrawlJobs → [queue] process-url 或 [direct] processCrawlJob
```

同 bundle：啟動後由 `process-url` 消費；失敗後可由 `retry`/`abort` 操作同一 `taskId`。
