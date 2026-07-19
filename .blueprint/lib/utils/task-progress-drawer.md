# lib/utils/task-progress-drawer

## 職責契約

前端任務進度抽屜的**自動開啟決策**：依 taskId / 已開過標記 / 狀態，判斷是否應自動展開 drawer。

- **做**：純布林決策——有 taskId、尚未對該 id auto-open、且狀態為缺席或 `processing` 時為 true。
- **不做**：React 狀態、API 呼叫、輪詢、drawer 渲染、abort/完成後的手動開關。

## 接口摘要

`shouldAutoOpenTaskDrawer(state: TaskDrawerAutoOpenState): boolean`

| 面向 | 形狀 |
|------|------|
| **Input** | `{ taskId, autoOpenedTaskId, taskStatus: { status? } \| null }` |
| **true** | 有 `taskId` 且 `autoOpenedTaskId !== taskId` 且（無 status 或 `status === 'processing'`） |
| **false** | 無 taskId；已對同一 task auto-open；已完成等非 processing 狀態 |
| **Side Effect** | 無 |

## 依賴拓撲

```
UI (page / task panel)
  ├→ 輪詢 GET /api/status/[taskId]  → taskStatus
  └→ **shouldAutoOpenTaskDrawer**   → 決定是否 setOpen + 記錄 autoOpenedTaskId

tests/task-progress-drawer.test → 契約鎖定
```

同 bundle：消費 `status` API 的輪詢結果；與 `task-metadata` 無直接依賴。
