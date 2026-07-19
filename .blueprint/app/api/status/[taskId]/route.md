# GET|POST /api/status/[taskId]

## 職責契約

單一爬取任務的**狀態查詢端點**：依 `taskId` 從 R2 讀取 `JobTask` 並回傳。

- **做**：路徑參數校驗；GET 用環境預設 R2；POST 可帶 `r2Overrides` 查詢；404/400/500 錯誤形狀。
- **不做**：任務列表、狀態寫入、abort/retry、進度 UI 決策、domain 彙總（列表側才 normalize）。

## 接口摘要

`GET(req, { params })` / `POST(req, { params })` → `NextResponse`

| 面向 | 形狀 |
|------|------|
| **Input (path)** | `taskId: string`（必填） |
| **Input (POST body)** | 可選 `{ r2AccountId?, r2AccessKeyId?, r2SecretAccessKey?, r2BucketName? }` → 組裝 `R2Overrides` |
| **Output 200** | `JobTask` 原樣 JSON（`getTaskStatus` 結果） |
| **Output** | 400 缺 taskId；404 Task not found；500 Internal Server Error |
| **Side Effect** | 僅讀 R2；無寫入 |

## 依賴拓撲

```
Client → **GET|POST /api/status/[taskId]**
            └→ getTaskStatus(taskId, r2Overrides?)  (@/lib/r2)
```

同 bundle：與 `tasks` 對稱——本端點查單筆、不 normalize；`tasks` 列最近 20 筆並補 domain 摘要。UI 輪詢此端點後可餵給 `shouldAutoOpenTaskDrawer`。
