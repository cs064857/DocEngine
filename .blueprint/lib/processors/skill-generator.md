# skill-generator（processor）

## 職責契約

從 R2 `cleaned/{date}/{domain}/` 讀取已清理 Markdown，經 **Summarize → Generate → Refine** 三步 LLM Agent，產出符合 Antigravity/OpenCode 格式的 `SKILL.md`。

- **負責**：文件收集與截斷、prompt 組裝、呼叫 `piComplete`、進度回報、中止協作、輸出正規化與 frontmatter 校驗。
- **不負責**：HTTP 路由、任務狀態持久化、R2 寫入成品、LLM provider 認證細節（委派 `pi-llm`）。

## 接口摘要

`generateSkill(params) → Promise<SkillGenerationResult>`

| 欄位 | 形狀 / 語意 |
|------|-------------|
| **Input** | `date`, `domain`（R2 路徑）；`provider`, `modelId`, 可選 `apiKey`/`baseUrl`；可選 `r2` overrides、`customPrompt`；`onProgress(phase, detail)`；`signal` / `throwIfAborted` |
| **Output** | `{ skillMd: string, fileList: string[] }` — 最終 SKILL.md 全文 + 相對路徑列表 |
| **Side Effect** | 讀 R2 cleaned 物件；讀本地 `skill-creator/SKILL.md` 片段作 system 指引；3 次 LLM 完成呼叫 |
| **Constraints** | 無 cleaned MD → throw；空輸出或缺 `---` frontmatter → throw；各 phase 前可被 abort |

`ProgressCallback`：`phase ∈ collecting|summarize|generate|refine`（寫入/完成 phase 由呼叫端負責）。

## 依賴拓撲

```
API / skill-task runner
        │
        ▼
  **skill-generator** ──► lib/prompts/skill-generator（模板 + fill）
        │              ──► lib/services/pi-llm（piComplete）
        │              ──► lib/r2（listObjects / getObject）
        │              ──► skill-creator/SKILL.md（可選指引片段）
        │
        ◄── throwIfAborted / signal（來自 skill-task-control）
```

Bundle 內：消費 **prompts/skill-generator**；中止語意對齊 **skill-task-control** + **skill-task-status** 的 phase 命名。
