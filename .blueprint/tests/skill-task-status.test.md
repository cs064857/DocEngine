# skill-task-status.test

## 職責契約

鎖定 **skill-task-status** 終態/可中止判斷與中止訊息字面穩定（node:test + assert/strict）。

- **負責**：terminal / stoppable 真值表；`SKILL_TASK_ABORT_MESSAGE` 字串不變（UI/API 契約）。
- **不負責**：R2、abort controller、生成流程。

## 接口摘要

| 案例 | 斷言意圖 |
|------|----------|
| `isSkillTaskTerminalStatus` | processing=false；completed/failed/aborted=true |
| `isSkillTaskStoppable` | 僅 processing=true |
| abort message | 嚴格等於 `Generation stopped by user.` |

## 依賴拓撲

```
tests/skill-task-status.test
        │  直接 import
        ▼
  lib/utils/skill-task-status（葉契約）
```

Bundle 內與 **skill-task-control.test** 分工：狀態純邏輯 vs 執行期控制。
