# POST /api/skill-status/[taskId]

## 職責契約

單一 Skill 生成任務的**狀態查詢端點**。薄代理至 `getSkillTaskStatus`，支援 body 傳入 R2 覆蓋（故用 POST 而非 GET）。

- **做**：解析 path `taskId`、抽取 R2 overrides、回傳完整 `SkillTaskStatus` JSON。
- **不做**：列表、啟動、中止、下載、狀態機轉換。

## 接口摘要

`POST(req, { params: Promise<{ taskId }> }) → NextResponse`

| 面向 | 形狀 |
|------|------|
| **Input** | path: `taskId`；body: `{ r2*? }`（可空） |
| **Output 200** | `SkillTaskStatus`（taskId/status/phase/date/domain/fileCount/outputPrefix/…） |
| **Output 404** | `{ error: 'Task not found' }`（NoSuchKey / not found） |
| **Output 500** | `{ error }` |
| **Side Effect** | 僅讀 R2 `skill-tasks/{taskId}.json` |
| **Constraints** | body 解析失敗視為 `{}` |

## 依賴拓撲

```
Client → **POST /api/skill-status/[taskId]**
           └→ getSkillTaskStatus(taskId, extractSkillTaskR2Overrides(body))
                 └→ R2 skill-tasks/{taskId}.json
```

同 bundle：狀態由 `generate-skill` 建立並持續更新；`abort-skill` 可將 status 改為 aborted；`skill-tasks` 為批量對應。
