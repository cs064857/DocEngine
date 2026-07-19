# POST /api/generate-skill

## 職責契約

Skill 產生任務的**入口與異步編排器**：驗證已清理文件存在、建立 R2 任務狀態、以 fire-and-forget 啟動背景 worker，最終寫入版本化 skill 產物。

- **做**：date/domain 驗證、`cleaned/` 前綴存在性檢查、`taskId` 生成、初始 `skill-tasks/{taskId}.json` 寫入、LLM 設定解析（含 openai-codex 不覆蓋 OAuth）、背景呼叫 `generateSkill`、寫入 `SKILL.md` + 複製 references、進度/終態更新、中止感知。
- **不做**：LLM 生成演算法本身（`skill-generator`）、中止訊號實作（`skill-task-control`）、任務列表/狀態查詢/ZIP 下載/中止 API（同 bundle 其他 route）。

## 接口摘要

`POST(req: NextRequest) → NextResponse`

| 面向 | 形狀 |
|------|------|
| **Input** | `{ date, domain, provider?, modelId?, apiKey?, baseUrl?, customPrompt?, r2* }` |
| **Output 200** | `{ taskId, message }`（任務已非同步啟動，非最終產物） |
| **Output 400** | 缺 date/domain |
| **Output 404** | `cleaned/{date}/{domain}/` 無檔 |
| **Output 500** | `{ error }` |
| **Side Effect** | 寫入 `skill-tasks/{taskId}.json`（status=`processing`, phase=`queued`）；背景寫入 `skills/.../{taskId}/SKILL.md` 與 `references/*`；更新 phase/status |
| **Constraints** | openai-codex 時不注入預設 apiKey；全程可被 abort 中斷 |

內部 `processSkillGeneration(payload: SkillJobPayload)`：註冊 AbortController → generateSkill → writing → completed/aborted/failed → 反註冊。

## 依賴拓撲

```
Client → **POST /api/generate-skill**
           ├→ listObjects(cleaned/{date}/{domain}/)
           ├→ putObject(skill-tasks/{taskId}.json)
           └→ [async] processSkillGeneration
                 ├→ skill-task-control (register/abort check/updateStatus)
                 ├→ generateSkill (skill-generator)
                 ├→ putObject(SKILL.md) + getObject/putObject(references)
                 └→ updateSkillTaskStatus(completed|aborted|failed)
```

同 bundle：`skill-status`/`skill-tasks` 讀同一 R2 狀態；`abort-skill` 中止進行中 worker；`skill-download` 打包 `outputPrefix` 產物。
