# Skill Generator 核心：收集、摘要、生成、精修

本頁聚焦 `lib/processors/skill-generator.ts` 與它的直接協作者：`app/api/generate-skill/route.ts` 先建立 `skill-tasks/{taskId}.json` 並 fire-and-forget 啟動 `processSkillGeneration()`，真正的核心則在 `generateSkill()` 內完成 `collecting → summarize → generate → refine`，最後再由 route 補上 `writing → done` 與 `skills/{date}/{domain}/{taskId}/` 的版本化輸出。Sources: [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L81-L160), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L166-L238), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L145-L265), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L117-L123)

## 核心流程

```mermaid
flowchart TD
    A[cleaned/{date}/{domain}/] --> B[listAllMdFiles<br/>最多 500 筆 .md]
    B --> C[readFiles<br/>Promise.allSettled]
    C --> D[buildFileList + buildDocumentContents<br/>每檔最多 3000 字 / 總量 100000 字]
    D --> E[Summarize<br/>piComplete]
    E --> F[Generate<br/>piComplete + skill-creator guidance + customPrompt]
    F --> G[Refine<br/>piComplete]
    G --> H[normalizeSkillMarkdown<br/>檢查 YAML frontmatter]
    H --> I[processSkillGeneration 寫入<br/>SKILL.md + references/]
    I --> J[updateSkillTaskStatus<br/>writing -> done]
```

這條流程不是多 agent tool loop，而是單一 server-side 函式鏈：先從 R2 列出並讀取 cleaned Markdown，再把裁切後的內容送進三次 `piComplete()`，最後把結果正規化後寫回版本化 skill 目錄，並同步更新 `skill-tasks/{taskId}.json` 的 phase。Sources: [skill-generator.ts](../../../lib/processors/skill-generator.ts#L84-L140), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L145-L265), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L52-L76), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L81-L160), [r2.ts](../../../lib/r2.ts#L92-L132)

## 階段拆解

### 1. 收集：列檔、讀檔、裁切

收集階段固定讀 `cleaned/${date}/${domain}/`，先用 `listObjects(prefix, 500)` 列出物件，再只保留 `.md`；若一個檔案都沒有，直接丟出 `No cleaned MD files found`。讀檔時 `readFiles()` 對每個 key 執行 `getObject()`，但用的是 `Promise.allSettled`，所以部分檔案讀失敗時只會被靜默排除，只有全部都失敗時才會在後續因 `files.length === 0` 中止。Sources: [skill-generator.ts](../../../lib/processors/skill-generator.ts#L84-L106), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L158-L172), [r2.ts](../../../lib/r2.ts#L106-L132)

收集後的內容不會原封不動送進 LLM：單檔預設上限是 3000 字，且採「前 70% + 截斷標記 + 後 20%」的 head/tail 保留方式；當總長逼近 100000 字時，後續檔案的單檔上限降成 500 字，超過總量後就停止追加並插入省略提示。`fileList` 另外會把每個來源格式化成 `references/...` 清單，供後續 prompt 明示可引用檔案。Sources: [skill-generator.ts](../../../lib/processors/skill-generator.ts#L30-L38), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L108-L140), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L174-L175)

### 2. Summarize：先要結構化摘要，但不做程式級 JSON 驗證

摘要階段會把 `fileList` 與拼接後的 `documentContents` 填進 `SUMMARIZE_DOCS_PROMPT`，system prompt 固定是 `You are a technical documentation analyst.`；prompt 明確要求模型輸出一個 JSON block，內含 `suggestedName`、`suggestedDescription`、`primaryTechnology`、`topics`、`summary` 與 `fileGrouping`。Sources: [skill-generator.ts](../../../lib/processors/skill-generator.ts#L180-L197), [prompts/skill-generator.ts](../../../lib/prompts/skill-generator.ts#L8-L52)

但目前這份 JSON 只是「提示契約」，不是「執行期 schema」：程式在 summarize 完成後直接取 `summaryResponse.text`，原樣塞進下一階段的 `GENERATE_SKILL_PROMPT`，沒有 `JSON.parse()`、型別驗證或欄位補救邏輯。換句話說，摘要品質完全仰賴模型遵守 prompt，而不是靠 server 端嚴格解析。Sources: [skill-generator.ts](../../../lib/processors/skill-generator.ts#L187-L213), [prompts/skill-generator.ts](../../../lib/prompts/skill-generator.ts#L32-L52), [prompts/skill-generator.ts](../../../lib/prompts/skill-generator.ts#L54-L107)

### 3. Generate：把摘要轉成 SKILL.md 骨架

生成階段會組出一個較長的 `systemPrompt`：基本身份是「Antigravity/OpenCode skill 文件專家」，若本機存在 `skill-creator/SKILL.md`，程式會擷取 `### Write the SKILL.md` 到 `## Running and evaluating test cases` 之間的片段，必要時再截到 12000 字內，並把這段當成額外寫作指引；若呼叫端提供 `customPrompt`，也會同樣附加到 system prompt。Sources: [skill-generator.ts](../../../lib/processors/skill-generator.ts#L37-L61), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L177-L208), [skill-creator/SKILL.md](../../../skill-creator/SKILL.md#L62-L163)

`GENERATE_SKILL_PROMPT` 不只要求輸出 Markdown，還把 SKILL.md 的格式明寫死：必須以 YAML frontmatter 開頭、frontmatter 只包含 `name` 與帶 trigger phrases 的 `description`，正文至少要覆蓋 Overview、Key Concepts、API/Usage、Examples、Reference Files、Best Practices、Troubleshooting，且引用檔案時要用 `references/filename.md` 相對路徑。這代表生成器希望模型一次產出接近成品，而不是先吐大綱再二次展開。Sources: [prompts/skill-generator.ts](../../../lib/prompts/skill-generator.ts#L54-L107), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L199-L225)

### 4. Refine：精修、正規化、最小驗證

精修階段的 prompt 會再次檢查 frontmatter、章節完整度、reference files 覆蓋、heading 階層與 code block 語言標籤；server 在拿到 refine 結果後，會先用 `normalizeSkillMarkdown()` 剝掉整體包住的 code fence，並在模型前面多講了一段前言時，嘗試把內容切到第一個 `---` 開始。Sources: [prompts/skill-generator.ts](../../../lib/prompts/skill-generator.ts#L109-L166), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L63-L82), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L227-L252)

不過執行期的硬驗證其實很少：程式只檢查 refine 後內容不得為空，且 `trimStart()` 後必須以 `---` 開頭；它不會驗證 frontmatter 是否真只有 `name`/`description`，也不會確認所有 reference files 都真的被提到。換言之，格式完整性主要靠 refine prompt，而不是 server-side parser。Sources: [skill-generator.ts](../../../lib/processors/skill-generator.ts#L251-L257), [prompts/skill-generator.ts](../../../lib/prompts/skill-generator.ts#L124-L151)

### 5. Writing：由 route 收尾成版本化輸出

`generateSkill()` 只回傳 `skillMd` 與成功讀到的 `fileList`；真正的寫檔是在 `processSkillGeneration()` 完成。route 先把 phase 改成 `writing`，把最終內容寫到 `skills/{date}/{domain}/{taskId}/SKILL.md`，再逐一把 `cleaned/{date}/{domain}/{filename}` 複製到同版本目錄下的 `references/`，最後才把 task 狀態更新成 `completed`、`phase: done`、`fileCount` 與前 2000 字的 `skillPreview`。Sources: [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L84-L149), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L117-L123)

## 關鍵模組 / 檔案導覽

| 檔案 | 在這條流程中的角色 | 關鍵細節 |
|---|---|---|
| `app/api/generate-skill/route.ts` | 背景 worker 與狀態寫面 | 建立 `SkillTaskStatus`、執行 `processSkillGeneration()`、寫入 `SKILL.md`/`references/`、更新 `writing/done/failed`。 |
| `lib/processors/skill-generator.ts` | 生成核心 | 收集 cleaned 文件、裁切內容、串起 `summarize -> generate -> refine`。 |
| `lib/prompts/skill-generator.ts` | 三階段 prompt 契約 | 定義 summarize JSON、generate 格式要求、refine checklist。 |
| `lib/services/pi-llm.ts` | LLM 呼叫橋 | 以 `@mariozechner/pi-ai` 執行完成呼叫，處理 provider/model/baseUrl/apiKey。 |
| `lib/oauth/pi-auth.ts` | Codex OAuth 憑證橋 | 在 `openai-codex` 無 apiKey 時讀 `auth.json`，必要時 refresh 並寫回。 |
| `skill-creator/SKILL.md` | 本地寫作參考包 | 生成/精修 system prompt 會擷取其中一段當附加指南。 |

Sources: [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L52-L160), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L166-L238), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L37-L61), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L84-L265), [prompts/skill-generator.ts](../../../lib/prompts/skill-generator.ts#L13-L166), [pi-llm.ts](../../../lib/services/pi-llm.ts#L1-L141), [pi-auth.ts](../../../lib/oauth/pi-auth.ts#L5-L98), [skill-creator/SKILL.md](../../../skill-creator/SKILL.md#L62-L163)

## LLM 呼叫橋接與模型決策

這條核心不是直接打 OpenAI SDK，而是統一走 `@mariozechner/pi-ai` 的 `complete()`；`package.json` 也把它列成正式 runtime dependency。`piComplete()` 只接一個 system prompt 與一個 user message，回傳後會自行拼接所有 `text` block，若 `stopReason` 是 `error`/`aborted` 或完全沒有文字區塊，就主動拋錯。Sources: [package.json](../../../package.json#L11-L22), [pi-llm.ts](../../../lib/services/pi-llm.ts#L1-L12), [pi-llm.ts](../../../lib/services/pi-llm.ts#L97-L141)

模型解析有兩個重要分支：若 provider 是 `openai-compatible`，程式會手工建立一個 `openai-completions` model 物件並允許自訂 `baseUrl`；若 provider 是 pi-ai 已知供應商但 `modelId` 沒在 registry 中，且該 provider 只有一種 API 類型，程式會用第一個 model 當模板，動態產生一個「自訂 modelId」fallback。Sources: [pi-llm.ts](../../../lib/services/pi-llm.ts#L51-L90), [pi-llm.ts](../../../lib/services/pi-llm.ts#L92-L109)

`openai-codex` 又是另一條特殊路徑：route 端刻意不讓 `SKILL_GENERATOR_API_KEY` 覆蓋 OAuth 流程，而 `piComplete()` 在沒顯式 apiKey 時會改讀 `auth.json`；`getCodexApiKey()` 透過 `@mariozechner/pi-ai/oauth` 取 token，若發生 refresh 也會把新憑證寫回檔案。這使得 Skill Generator 可以同時支援一般 API key provider 與 server-side Codex OAuth。Sources: [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L88-L97), [config.ts](../../../lib/config.ts#L17-L24), [pi-llm.ts](../../../lib/services/pi-llm.ts#L35-L49), [pi-auth.ts](../../../lib/oauth/pi-auth.ts#L5-L15), [pi-auth.ts](../../../lib/oauth/pi-auth.ts#L71-L98)

## 常見限制與踩坑

第一個限制是輸入枚舉有硬上限：`listAllMdFiles()` 只做一次 `listObjects(prefix, 500)`，沒有 continuation token 或分頁回圈，所以同一個 cleaned folder 若超過 500 個 Markdown，後面的檔案根本不會進入 summarize / generate / refine。Sources: [skill-generator.ts](../../../lib/processors/skill-generator.ts#L34-L36), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L84-L87), [r2.ts](../../../lib/r2.ts#L123-L132)

第二個限制是「部分讀檔失敗」不會讓任務立即失敗：`readFiles()` 會把 rejected 結果直接濾掉，所以只要還有至少一個檔案讀成功，後續流程就會繼續跑；這會讓最終 skill 可能只建立在「部分 cleaned corpus」之上。Sources: [skill-generator.ts](../../../lib/processors/skill-generator.ts#L94-L106), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L167-L175)

第三個限制是 size guard 的提示訊息只有近似值：超量時程式用 `files.length - parts.length` 生成「還有幾個檔案被省略」的文案，但 `parts.length` 在該時點已包含剛加入的省略提示本身，因此顯示的 omitted count 可能比實際少 1。Sources: [skill-generator.ts](../../../lib/processors/skill-generator.ts#L123-L131)

第四個限制是 reference 複製失敗不會阻止任務完成：copy 迴圈對單檔錯誤只做 `console.warn`，`Promise.all()` 等到每個 promise 結束後，仍會照常把 task 更新成 `completed` 與 `phase: done`。因此下載到的 versioned skill 可能缺少部分 `references/` 檔案，但狀態面看起來仍是成功。Sources: [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L128-L151)

第五個限制是前後端 phase 視圖不完全對齊：後端 phase 型別與 `generateSkill()` 真正會產生 `queued`、`collecting`、`summarize`、`generate`、`refine`、`writing`、`done`，但現有 UI stepper 只畫 `summarize / generate / refine / writing`，所以使用者在任務剛建立或仍在收集 cleaned 文件時，看不到對應節點高亮。Sources: [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L9-L25), [skill-generator.ts](../../../lib/processors/skill-generator.ts#L158-L181), [page.tsx](../../../app/page.tsx#L2168-L2189)
