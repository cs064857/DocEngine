# skill-generator（prompts）

## 職責契約

純 **Prompt 契約層**：定義三步 Agent 的英文模板與佔位符填充。不呼叫 LLM、不碰 I/O。

- **負責**：`SUMMARIZE_DOCS_PROMPT` / `GENERATE_SKILL_PROMPT` / `REFINE_SKILL_PROMPT` 的意圖與 `{{var}}` 介面；`fillPromptTemplate` 字串替換。
- **不負責**：文件截斷、模型選擇、輸出解析（processor 負責）。

## 接口摘要

| 匯出 | 意圖 |
|------|------|
| `SUMMARIZE_DOCS_PROMPT` | `{{fileList}}` + `{{documentContents}}` → 要求 JSON 摘要（suggestedName/description、topics、fileGrouping…） |
| `GENERATE_SKILL_PROMPT` | `{{summary}}` + `{{fileList}}` → 完整 SKILL.md（YAML frontmatter + 固定章節） |
| `REFINE_SKILL_PROMPT` | `{{skillDraft}}` + `{{fileList}}` → 校驗 checklist 後輸出最終 SKILL.md（僅文件、無解釋） |
| `fillPromptTemplate(template, variables)` | 全域替換 `{{key}}`；**無**轉義或驗證 |

## 依賴拓撲

```
lib/processors/skill-generator
        │  import 常量 + fillPromptTemplate
        ▼
  **lib/prompts/skill-generator**   （葉節點，無專案內依賴）
```

Bundle 內：僅被 **processors/skill-generator** 消費；與 **skill-task-status** 的 phase 名稱（summarize/generate/refine）語意對齊，但無直接 import。
