# tests/advanced-engine-settings-ui.test

## 職責契約

鎖定 `advanced-engine-settings-ui` 的**顯示與提示契約**：三種來源皆顯示；僅 scrape 有 batch hint。

- **做**：node:test 斷言 `shouldShowAdvancedEngineSettings` 對 scrape/crawl/map 為 true；`getAdvancedEngineSettingsHint('scrape')` 為含 Batch 的字串；crawl/map 為 null。
- **不做**：UI 渲染、設定值行為、API 整合測試。

## 接口摘要

| 案例 | 斷言意圖 |
|------|----------|
| 全來源顯示 | scrape/crawl/map → `true` |
| scrape hint | 型別 string 且匹配 `/Batch/i` |
| 非 scrape | crawl/map → `null` |

## 依賴拓撲

```
advanced-engine-settings-ui ──→ 本測試（契約消費者）
node:test / node:assert/strict
```

同 bundle：僅測 UI 策略模組；不碰 `r2`/`download`/`helpers`。
