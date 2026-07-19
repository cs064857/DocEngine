# POST /api/retry

## 職責契約

對既有爬取任務**重新分發**失敗或指定 URL：讀寫 R2 任務狀態後，再次 `dispatchCrawlJobs`。

- **做**：`retryAll` 全量重置或 `urls[]` 部分重試；合併 engineSettings；清除 failed/retrying 標記；重設為 `processing`；重新 dispatch。
- **不做**：新建 taskId、URL 抽取、實際 scrape 執行、使用者 abort 標記（分屬 crawl / process-url / abort）。

## 接口摘要

`POST(req: NextRequest) → NextResponse`

| 面向 | 形狀 |
|------|------|
| **Input** | `{ taskId: string, urls?: string[], retryAll?: boolean, engineSettings? }` |
| **校驗** | 需 `taskId`；且 `retryAll` 或非空 `urls[]` 擇一 |
| **Output 200** | `{ message, dispatchMode, retried: string[] }` |
| **Output** | 404 Task not found；400 無可重試 URL |
| **Side Effect** | `getTaskStatus` → 改狀態 → `putTaskStatus`；`dispatchCrawlJobs` |
| **Settings 合併** | `retryAll` → `mergeStoredTaskEngineSettingsForRetry`；否則 shallow merge 存檔設定與請求覆寫 |

## 依賴拓撲

```
Client → **POST /api/retry**
           ├→ getTaskStatus / putTaskStatus (R2, r2Overrides)
           ├→ mergeStoredTaskEngineSettingsForRetry (retryAll)
           └→ dispatchCrawlJobs → process-url 或 direct processCrawlJob
```

同 bundle：與 `crawl` 共用 dispatch 路徑；與 `abort` 對稱——retry 把 URL 拉回 pending，abort 把 pending/processing 標 failed。
