# /api/crawl-job

## 職責契約

Firecrawl **Crawl Job** 的薄 HTTP 適配層：啟動全站式 crawl job，並輪詢進度與已發現連結。

- **做**：驗證 `url`/`jobId`；轉發 `startCrawlJob` / `checkCrawlJob`；完成時從結果去重抽出 links。
- **不做**：本系統 R2 任務追蹤、批次 URL 分發、Map API、單頁 scrape（分屬 crawl / map / scrape）。

## 接口摘要

### `POST(req) → { success, jobId }`

| 面向 | 形狀 |
|------|------|
| **Input** | `{ url: string, limit?: string\|number, engineSettings?: { firecrawlApiKey, firecrawlApiUrl } }` |
| **Default** | `limit` 缺省為 100 |
| **Side Effect** | 於 Firecrawl 建立遠端 crawl job |
| **Constraints** | `url` 必為字串 |

### `GET(req) → { success, status, completed, total, links[] }`

| 面向 | 形狀 |
|------|------|
| **Query** | `jobId`（必填）、`apiKey`（可選覆寫） |
| **Output** | `status` 來自 Firecrawl；`links` 僅在 `completed` 時從 `metadata.sourceURL`/`url` 去重彙總 |
| **Side Effect** | 唯讀輪詢，無 R2 寫入 |

## 依賴拓撲

```
Client → **POST/GET /api/crawl-job** → startCrawlJob / checkCrawlJob (crawler service) → Firecrawl Crawl API
```

同 bundle：與 `map` 同為「發現 URL」路徑，但此路由走非同步 job + 輪詢；`map` 為同步 Map API。不寫入 crawl 任務狀態。
