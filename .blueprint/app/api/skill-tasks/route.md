# GET|POST /api/skill-tasks

## 職責契約

Skill 任務的**列表查詢**：掃描 R2 `skill-tasks/` 前綴，回傳最近任務狀態陣列。GET 用預設 R2；POST 可帶 R2 覆蓋。

- **做**：list `skill-tasks/`、依 LastModified 降序、最多取 50 筆、並行讀 JSON 解析為 `SkillTaskStatus[]`。
- **不做**：單任務詳情以外的寫入、生成、中止、過濾/分頁參數（固定上限 50）。

## 接口摘要

| 方法 | Input | Output 200 |
|------|-------|------------|
| `GET()` | 無 | `{ tasks: SkillTaskStatus[] }` |
| `POST(req)` | body `{ r2*? }`（可空） | 同上，使用 overrides |

| 面向 | 形狀 |
|------|------|
| **Output 500** | `{ error }` |
| **Side Effect** | 僅 R2 讀取；單檔 parse 失敗 skip 並 log |
| **Constraints** | list 上限 1000，實際回傳 top 50（時間新→舊） |

## 依賴拓撲

```
Client → **GET|POST /api/skill-tasks**
           └→ fetchSkillTasks(r2?)
                 ├→ listObjects('skill-tasks/', 1000)
                 ├→ sort by LastModified desc
                 └→ getObject + JSON.parse → filter nulls
```

同 bundle：列表項由 `generate-skill` 寫入；細節輪詢走 `skill-status`；中止後列表反映 aborted。
