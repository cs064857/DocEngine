# tests/task-metadata.test

## 職責契約

鎖定 `task-metadata` 的**可觀察契約**：日期格式、domain 摘要、skill 路徑、設定消毒與 retry 合併，避免 UI/列表/retry 靜默回歸。

- **做**：node:test 斷言上述純函式邊界（compact 日期、單/多 domain、密鑰剝離、stored 優先於 runtime 行為欄位）。
- **不做**：R2/HTTP 整合、UI、mock 伺服器。

## 接口摘要

| 案例焦點 | 斷言意圖 |
|----------|----------|
| `formatStoredDate` | `YYYYMMDD` → `YYYY/MM/DD` |
| `getTaskDisplayDate` | `createdAt` 優先於 `date` |
| `summarizeDomains` | 單域顯示 hostname；多域 `"N domains"`；非法 URL 忽略 |
| `buildSkillVersionPrefix` | 含 taskId 的隔離路徑 |
| `sanitizeEngineSettingsForStorage` | 密鑰/R2 憑證移除，行為設定保留 |
| `mergeStoredTaskEngineSettingsForRetry` | stored 行為不被 runtime 覆寫；secrets 由 runtime 填入 |

## 依賴拓撲

```
**task-metadata.test** → lib/utils/task-metadata
（間接守護）tasks.normalizeTask、retry 設定合併、skill 路徑消費者
```
