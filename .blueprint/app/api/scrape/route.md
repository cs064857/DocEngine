# POST /api/scrape

## 職責契約

**即時單頁** scrape 的 HTTP 入口：驗證 URL 後整包 body 委派 `runSingleScrapeTask`（Firecrawl + 可選 LLM 清理 + R2）。

- **做**：參數校驗、錯誤包裝、回傳完整 result（含 task 狀態）。
- **不做**：批次 URL 抽取、佇列分發、Map/Crawl Job、任務級 retry/abort（分屬 crawl / process-url / map / crawl-job / retry / abort）。

## 接口摘要

`POST(req: NextRequest) → NextResponse`

| 面向 | 形狀 |
|------|------|
| **Input** | `{ url: string, … }`（其餘欄位原樣傳入 `runSingleScrapeTask`：engineSettings、清理選項等） |
| **Output 成功** | `runSingleScrapeTask` 的完整 result（含 success、taskId、task 等） |
| **Output 失敗** | `{ error, details, taskId?, task? }` status 500 |
| **Side Effect** | 由 service 層決定：可能寫 R2、呼叫 Firecrawl/LLM |
| **Constraints** | `url` 必為非空字串 |

## 依賴拓撲

```
Client → **POST /api/scrape** → runSingleScrapeTask (scrape-task) → Firecrawl / R2 / LLM
```

同 bundle：與 `crawl` 對立——`scrape` 同步單頁完成；`crawl` 批次非同步 + 佇列。不經 `process-url` 回呼。
