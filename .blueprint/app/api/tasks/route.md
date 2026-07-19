# GET|POST /api/tasks

## 職責契約

爬取任務**列表端點**：掃描 R2 `tasks/` 前綴，取最近修改的 20 筆完整狀態，並補齊 domain 顯示欄位。

- **做**：`listObjects('tasks/', 1000)` → 依 LastModified 降序 → top 20 → 並行 `getTaskStatus`；缺 `domainSummary`/`domains` 時以 URL 回填；GET 預設 R2、POST 可帶 overrides。
- **不做**：單筆輪詢（屬 status）、寫入/刪除任務、分頁參數、skill 任務列表。

## 接口摘要

`GET()` / `POST(req)` → `NextResponse`

| 面向 | 形狀 |
|------|------|
| **Input (POST body)** | 可選 R2 憑證欄位 → `R2Overrides` |
| **Output 200** | `{ tasks: JobTask[] }`（已 `normalizeTask`） |
| **Output 500** | `{ error: string }` |
| **Side Effect** | 僅讀 R2；單筆 fetch 失敗略過（null filter） |
| **normalizeTask** | 已有 domain 欄位則原樣；否則 `summarizeDomains(urls \|\| failedUrls)` 補 `domains` + `domainSummary` |

## 依賴拓撲

```
Client → **GET|POST /api/tasks**
            ├→ listObjects('tasks/', 1000, r2Overrides)  (@/lib/r2)
            ├→ getTaskStatus(id, r2Overrides) × N         (@/lib/r2)
            └→ summarizeDomains / normalizeTask           (task-metadata)
```

同 bundle：列表依賴 `task-metadata.summarizeDomains`；單筆細節走 `status/[taskId]`。兩者皆支援前端 R2 覆蓋認證模式。
