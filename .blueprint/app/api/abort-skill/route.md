# POST /api/abort-skill

## 職責契約

進行中 Skill 任務的**中止控制端點**：對 in-process worker 發 abort 訊號，並將 R2 狀態持久為 `aborted`。

- **做**：驗證 `taskId`、讀取當前狀態、終態直接回傳、否則 `abortSkillTaskInProcess` + `updateSkillTaskStatus(aborted)`。
- **不做**：生成、下載、列表；不刪除已寫入的部分產物。

## 接口摘要

`POST(req: NextRequest) → NextResponse`

| 面向 | 形狀 |
|------|------|
| **Input** | `{ taskId: string, r2*? }` |
| **Output 200** | 完整 `SkillTaskStatus`（已是終態則原樣回傳；否則 status=`aborted`, error=中止訊息） |
| **Output 400** | 缺 taskId |
| **Output 404** | 任務不存在 |
| **Output 500** | `{ error }` |
| **Side Effect** | 記憶體內 AbortController.abort；R2 狀態更新為 aborted |
| **Constraints** | `isSkillTaskTerminalStatus` 時冪等，不重複 abort |

## 依賴拓撲

```
Client → **POST /api/abort-skill**
           ├→ getSkillTaskStatus
           ├→ [terminal?] return as-is
           ├→ abortSkillTaskInProcess(taskId)  ──→ generate-skill worker 的 AbortController
           └→ updateSkillTaskStatus(aborted)
```

同 bundle：與 `generate-skill` 的 register/throwIfAborted 配對；`skill-status`/`skill-tasks` 隨後可見 aborted。
