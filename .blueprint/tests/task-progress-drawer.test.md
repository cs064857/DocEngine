# tests/task-progress-drawer.test

## 職責契約

鎖定 `shouldAutoOpenTaskDrawer` 的**自動開啟規則**：新任務開一次、同任務不重複、換任務再開、完成態不開。

- **做**：四組狀態矩陣斷言（null status / 已開 / 換 task / completed）。
- **不做**：React 元件、API mock、真實 drawer 行為。

## 接口摘要

| 案例 | 預期 |
|------|------|
| 新 task、無 status、未 auto-open | `true` |
| 同 task 已 auto-open + processing | `false` |
| 不同 task + processing | `true` |
| completed | `false` |

## 依賴拓撲

```
**task-progress-drawer.test** → lib/utils/task-progress-drawer
（間接守護）前端輪詢 status 後的 drawer 自動展開行為
```
