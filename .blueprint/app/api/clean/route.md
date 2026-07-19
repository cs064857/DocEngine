# POST /api/clean

## 職責契約

單一頁面 raw → cleaned 的 HTTP 入口。負責：從 R2 讀取 raw Markdown、委派 LLM 清洗、寫回 cleaned 物件。

**不做**：批次清洗、任務佇列、URL 提取、檔案列表、LLM 底層連線細節。

## 接口摘要

`POST(req)` — `maxDuration = 300`

- **Input (JSON)**：`url`、`date`（必填）；`engineSettings`（`llmApiKey` / `llmModelName` / `llmBaseUrl` / `cleaningPrompt`）；`r2Overrides`（前端欄位 `r2AccountId` 等，內部映射為 `R2Overrides`）
- **Output**：`{ success, size }` 或 `{ error }`
- **Status**：400 缺參；404 raw 不存在/空；502 LLM 失敗；500 其他
- **Side Effect**：R2 `putObject(cleanedKey, markdown)`；讀 `buildR2Key(url, 'raw'|'cleaned', date)`

## 依賴拓撲

```
Client → **clean/route** → getObject(raw) [r2]
                       → cleanContent() [cleaner]
                       → putObject(cleaned) [r2]
                       ↖ buildR2Key [helpers]
```

同 bundle：上游消費 raw；下游產物供 `files` / `list-cleaned-folders` 列舉與讀取。
