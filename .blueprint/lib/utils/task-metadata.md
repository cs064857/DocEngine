# lib/utils/task-metadata

## 職責契約

爬取任務的**純函式元資料工具**：網域彙總、日期顯示、skill 路徑前綴、引擎設定存檔消毒與 retry 合併。

- **做**：hostname 抽取與 domain 摘要；compact/ISO 日期格式化；R2 skill 路徑建構；從 `CrawlEngineSettings` 剝離密鑰後持久化；retry 時以存檔行為為主、runtime 只補 secrets。
- **不做**：HTTP、R2 I/O、任務狀態機、UI 開關、實際爬取/清理邏輯。

## 接口摘要

| 符號 | 輸入 → 輸出 / 副作用 |
|------|----------------------|
| `extractHostname(url)` | 合法 URL → hostname；非法 → `null` |
| `summarizeDomains(urls)` | → `{ domains: string[], domainSummary }`：0 空、1 單域名、N→`"{N} domains"` |
| `formatStoredDate(value?, includeTime?)` | `YYYYMMDD` 或 ISO → `YYYY/MM/DD[ HH:mm]`；無效則原字串或 `''` |
| `getTaskDisplayDate(task)` | 優先 `createdAt`（含時間），否則 `date` |
| `buildSkillVersionPrefix(date, domain, taskId)` | → `skills/{date}/{domain}/{taskId}/` |
| `buildLegacySkillPrefix(date, domain)` | → `skills/{date}/{domain}/`（無 task 隔離） |
| `sanitizeEngineSettingsForStorage(settings?)` | 去掉 firecrawl/llm/urlExtractor/r2 密鑰與帳密；僅保留行為設定 |
| `mergeStoredTaskEngineSettingsForRetry(stored?, runtime?)` | stored 行為 + runtime secrets/R2；runtime 不覆寫 stored 行為欄位 |

型別：`CrawlEngineSettings`（完整含密鑰）／`StoredTaskEngineSettings`（已消毒）／`TaskDateLike`。

## 依賴拓撲

```
tasks route.normalizeTask ──→ summarizeDomains
retry API ──────────────────→ mergeStoredTaskEngineSettingsForRetry
crawl 寫入任務 ─────────────→ sanitizeEngineSettingsForStorage
skill 路徑 / UI 日期 ───────→ build*Prefix / getTaskDisplayDate
tests/task-metadata.test ───→ 契約鎖定
```

同 bundle：`tasks` 直接依賴 domain 摘要；`status` 不呼叫本模組。與 skill 路徑、retry 設定生命週期跨 bundle 共用。
