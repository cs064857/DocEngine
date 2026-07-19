# lib/utils/advanced-engine-settings-ui

## 職責契約

前端**進階引擎設定區塊**的顯示策略：依來源模式決定是否顯示，以及 scrape 模式的批次提示文案。

- **做**：`scrape|crawl|map` 皆顯示進階設定；僅 scrape 回傳 batch-only hint（多 URL/sitemap 走 `/api/crawl`，單 URL preview 走 `/api/scrape` 且忽略這些設定）。
- **不做**：實際設定表單、API 呼叫、設定值消毒/合併（那是 `task-metadata`）、引擎執行。

## 接口摘要

| 符號 | 輸入 → 輸出 / 副作用 |
|------|----------------------|
| `SourceType` | `'scrape' \| 'crawl' \| 'map'` |
| `shouldShowAdvancedEngineSettings(sourceType)` | 三種模式皆 → `true` |
| `getAdvancedEngineSettingsHint(sourceType)` | scrape → 英文 hint 字串；crawl/map → `null` |

純函式、無副作用。

## 依賴拓撲

```
UI 來源模式切換 ──→ shouldShowAdvancedEngineSettings / getAdvancedEngineSettingsHint
tests/advanced-engine-settings-ui.test ──→ 契約鎖定（顯示皆 true、scrape hint、非 scrape null）
```

同 bundle：獨立 UI 策略，不依賴 `r2`/`download`/`helpers`。與實際引擎設定持久化跨 bundle（`task-metadata`）分離。
