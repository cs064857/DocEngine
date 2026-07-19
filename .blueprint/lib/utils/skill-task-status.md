# skill-task-status

## 職責契約

Skill 任務狀態的 **型別契約與純判斷函式**。無 I/O、無副作用。

- **負責**：`SkillTaskStatus` / `SkillTaskRunStatus` / `SkillTaskPhase` 形狀；終態與可中止判斷；穩定中止訊息常量。
- **不負責**：持久化、abort 信號、生成流程。

## 接口摘要

| 符號 | 語意 |
|------|------|
| `SkillTaskRunStatus` | `'processing' \| 'completed' \| 'failed' \| 'aborted'` |
| `SkillTaskPhase` | `'queued' \| 'collecting' \| 'summarize' \| 'generate' \| 'refine' \| 'writing' \| 'done'` |
| `SkillTaskStatus` | 任務元資料：taskId、status、phase、date/domain、fileCount、可選 preview/error/outputPrefix/provider/model 等時間戳 |
| `SKILL_TASK_ABORT_MESSAGE` | 固定字串：`Generation stopped by user.`（UI/API 共用） |
| `isSkillTaskTerminalStatus(s)` | completed / failed / aborted → true |
| `isSkillTaskStoppable(s)` | 僅 processing → true |

## 依賴拓撲

```
  **skill-task-status**（葉節點）
        ▲
        │ type + 常量 + 純函式
        │
  skill-task-control ──► 狀態讀寫 / SkillTaskAbortedError 訊息
  Skill API routes   ──► 回應形狀、可否 abort
  skill-generator    ──► phase 字串語意對齊（無直接 import）
  skill-task-status.test ──► 終態 / 可停 / 訊息穩定
```

Bundle 內為控制層與測試的共享契約源。
