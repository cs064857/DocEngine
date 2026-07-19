# POST /api/abort

## 職責契約

對任務中**卡住的 URL** 做使用者主動中止：僅改 R2 追蹤狀態，不呼叫爬取引擎取消。

- **做**：將 `pending`/`processing` 的指定 URL 標為 `failed` + error=`User aborted`；必要時將任務標 `completed`。
- **不做**：取消 Vercel Queue 在途訊息、呼叫 Firecrawl abort、重試分發、新建任務（分屬 process-url / retry / crawl）。

## 接口摘要

`POST(req: NextRequest) → NextResponse`

| 面向 | 形狀 |
|------|------|
| **Input** | `{ taskId: string, urls: string[], engineSettings? }`（r2 憑證覆寫） |
| **Output 200** | `{ message, aborted: string[] }`（`aborted` 為請求列表；實際計數見 log/`abortedCount` 邏輯） |
| **Output** | 400 缺參數；404 Task not found |
| **Side Effect** | 僅 `getTaskStatus` / `putTaskStatus`；`failed` 計數與 `failedUrls` 追加 |
| **Constraints** | 只動 `pending`/`processing`；已完成/已失敗的 URL 不重複計入 |

## 依賴拓撲

```
Client → **POST /api/abort** → getTaskStatus / putTaskStatus (R2)
```

同 bundle：與 `retry` 共用 R2 任務模型；不經 `dispatchCrawlJobs`。`process-url` 若稍後仍回寫同一 URL，可能與 abort 競態——意圖層面 abort 是「狀態層中止」，非硬取消 worker。
