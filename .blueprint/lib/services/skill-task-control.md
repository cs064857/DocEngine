# skill-task-control

## 職責契約

Skill 任務的 **執行期控制與 R2 狀態讀寫**：進程內 AbortController 註冊表、狀態 JSON 合併更新、中止錯誤類型、R2 override 從 request body 抽取。

- **負責**：`skill-tasks/{taskId}.json` 的 get/merge-put；in-process abort 信號；`SkillTaskAbortedError` 與 abort 錯誤辨識。
- **不負責**：實際 LLM 生成、HTTP 路由、狀態 schema 定義（schema 在 `skill-task-status`）、任務列表掃描。

## 接口摘要

| 符號 | 形狀 / 副作用 |
|------|----------------|
| `SkillTaskAbortedError` | 預設訊息 = `SKILL_TASK_ABORT_MESSAGE` |
| `extractSkillTaskR2Overrides(body)` | 僅接受 string 欄位 → `R2Overrides \| undefined`；全缺則 undefined |
| `getSkillTaskStatus(taskId, r2?)` | 讀 `skill-tasks/{id}.json` → `SkillTaskStatus` |
| `updateSkillTaskStatus(taskId, updates, r2?)` | 讀-合併-寫；強制刷新 `updatedAt` |
| `throwIfSkillTaskAborted(taskId, r2?)` | status===`aborted` 時 throw `SkillTaskAbortedError` |
| `registerSkillTaskAbortController` / `unregister…` | 進程內 Map 生命週期 |
| `abortSkillTaskInProcess(taskId)` | 找到則 `controller.abort()` 回 true，否則 false |
| `isAbortError(error)` | `SkillTaskAbortedError` 或 `name==='AbortError'` |

## 依賴拓撲

```
Skill API（generate / abort / status）
        │
        ▼
  **skill-task-control** ──► lib/r2（getObject / putObject）
        │                 ──► lib/utils/skill-task-status（型別 + 中止訊息常量）
        │
        ├── register/abort ──► 執行中的 generateSkill(signal)
        └── throwIfSkillTaskAborted ◄── processors/skill-generator 協作點
```

Bundle 內：狀態型別來自 **skill-task-status**；被 **skill-task-control.test** 鎖定 abort 表與 R2 override 行為。
