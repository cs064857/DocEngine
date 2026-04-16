# Generate Skill API：建立版本化 skill 任務

## 本頁範圍與讀者定位

本頁只說明 `POST /api/generate-skill` 如何從既有 `cleaned/{date}/{domain}/` 內容建立一筆新的 skill 任務、把狀態寫進 `skill-tasks/{taskId}.json`、啟動同進程背景生成、並把輸出落到版本化 `skills/{date}/{domain}/{taskId}/` 目錄；Skill 狀態/歷史/下載查詢只會作為這條建立流程的後續消費端被提及。Sources: [route.ts](app/api/generate-skill/route.ts#L164-L238), [route.ts](app/api/skill-status/[taskId]/route.ts#L12-L49), [route.ts](app/api/skill-tasks/route.ts#L48-L69), [route.ts](app/api/skill-download/route.ts#L13-L98)

## 核心流程

```mermaid
flowchart TD
    UI[Skill Generator UI] --> FOLDERS[/api/list-cleaned-folders]
    UI --> SUBMIT[POST /api/generate-skill]
    SUBMIT --> CHECK[listObjects cleaned/date/domain]
    CHECK --> CREATE[建立 taskId 與 queued 狀態 JSON]
    CREATE --> ASYNC[processSkillGeneration fire-and-forget]
    ASYNC --> PIPE[generateSkill: collecting → summarize → generate → refine]
    PIPE --> WRITE[寫入 skills/date/domain/taskId/SKILL.md]
    PIPE --> COPY[複製 cleaned 檔到 references/]
    WRITE --> STATUS[更新 skill-tasks/taskId.json]
    COPY --> STATUS
    STATUS --> POLL[/api/skill-status/taskId]
    STATUS --> HISTORY[/api/skill-tasks]
    STATUS --> DOWNLOAD[/api/skill-download]
```

這條 API 的角色不是直接同步回傳 `SKILL.md`，而是先驗證對應 cleaned prefix 至少有物件、再建立 `queued` 狀態的任務紀錄，接著以 `processSkillGeneration(payload).catch(console.error)` 啟動非阻塞背景工作；真正的收集、摘要、生成、精修、寫檔與引用檔複製都在背景流程內完成，而前端只靠 `/api/skill-status/[taskId]` 輪詢與 `/api/skill-tasks` 歷史列表回收結果。Sources: [route.ts](app/api/generate-skill/route.ts#L166-L238), [route.ts](app/api/generate-skill/route.ts#L78-L160), [skill-generator.ts](lib/processors/skill-generator.ts#L145-L265), [page.tsx](app/page.tsx#L255-L333), [route.ts](app/api/skill-status/[taskId]/route.ts#L12-L49), [route.ts](app/api/skill-tasks/route.ts#L48-L69)

## 請求契約與任務建立結果

| 欄位 | API 是否硬性要求 | 建立任務時的用途 | 是否寫入 `SkillTaskStatus` |
|---|---|---|---|
| `date`、`domain` | 是 | 組成 `cleaned/{date}/{domain}/` 檢查前綴，並決定輸出位置 | 是 |
| `provider`、`modelId` | 否 | 若未提供就退回 `config.llm.skillGenerator` 預設值 | 是 |
| `apiKey`、`baseUrl` | 否 | 只傳給背景 worker 解析，不直接存進狀態 JSON | 否 |
| `customPrompt` | 否 | 傳給生成流程作為額外指示 | 是 |
| `r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName` | 否 | 組成 R2 overrides，供檢查 cleaned、寫 task JSON 與背景生成共用 | 否 |

後端實際只硬性檢查 `date` 與 `domain`，再確認 `cleaned/{date}/{domain}/` 至少列得出一個物件；`provider`、`modelId` 會在建立 task 時先解析成預設值，`apiKey` 與 R2 憑證則只存在 request payload / 背景執行上下文，不會被回存到 `skill-tasks/{taskId}.json`。Sources: [route.ts](app/api/generate-skill/route.ts#L166-L213), [route.ts](app/api/generate-skill/route.ts#L215-L228), [config.ts](lib/config.ts#L17-L31)

每次建立都會先用 `generateTaskId()` 產生新的 UUID，然後把 `status='processing'`、`phase='queued'`、`createdAt/updatedAt`、`outputPrefix` 與此次解析後的 provider/model/baseUrl/customPrompt 寫成 `SkillTaskStatus`；這代表同一個 `date + domain` 可以產生多個互相隔離的版本，而不是覆蓋同一筆 metadata。Sources: [helpers.ts](lib/utils/helpers.ts#L1-L6), [route.ts](app/api/generate-skill/route.ts#L186-L213)

## 版本化儲存與輸出路徑

| 物件 | 路徑規則 | 由誰寫入 | 說明 |
|---|---|---|---|
| 任務狀態 JSON | `skill-tasks/{taskId}.json` | `POST /api/generate-skill`、`updateSkillTaskStatus()` | 建立、進度更新、完成/失敗都回寫同一個 task 檔 |
| 版本化 skill 根目錄 | `skills/{date}/{domain}/{taskId}/` | `buildSkillVersionPrefix()` | 每次 task 各有獨立輸出前綴 |
| 生成結果 | `skills/{date}/{domain}/{taskId}/SKILL.md` | 背景 worker | 寫入最終 `SKILL.md` |
| 引用文件 | `skills/{date}/{domain}/{taskId}/references/{filename}` | 背景 worker | 從 cleaned 原始來源複製過去 |
| 舊版相容前綴 | `skills/{date}/{domain}/` | `/api/skill-download` fallback | 若指定 taskId 的版本化目錄不存在，下載端會退回舊路徑 |

版本化規則集中在 `buildSkillVersionPrefix()`，而測試也直接驗證 `skills/20260415/docs.firecrawl.dev/task-123/` 這種「同網域、不同 taskId 分資料夾」的隔離語義；下載 API 則會優先用 `taskId` 重建版本化 prefix，找不到內容時才退回 legacy prefix。Sources: [task-metadata.ts](lib/utils/task-metadata.ts#L117-L123), [task-metadata.test.ts](tests/task-metadata.test.ts#L52-L57), [route.ts](app/api/generate-skill/route.ts#L84-L85), [route.ts](app/api/generate-skill/route.ts#L119-L149), [route.ts](app/api/skill-download/route.ts#L36-L52)

## 背景執行、phase 更新與預設設定回退

背景 worker 一開始會把 `outputPrefix` 算成版本化目錄，再解析 provider/model 預設值；其中 `apiKey` 的回退邏輯有一個特例：一般 provider 可退回 `SKILL_GENERATOR_API_KEY`，但若 provider 是 `openai-codex`，程式會刻意避免用環境變數 API key 覆蓋 OAuth token 流程。Sources: [route.ts](app/api/generate-skill/route.ts#L81-L97), [config.ts](lib/config.ts#L17-L24)

真正的生成工作由 `generateSkill()` 執行，內部分成 `collecting → summarize → generate → refine` 四個主要階段：先列出 `cleaned/{date}/{domain}/` 下全部 `.md`、讀取並截斷內容、整理 file list，之後透過 `piComplete()` 先做摘要，再生成 SKILL 草稿，最後精修成必須帶 YAML frontmatter 的最終輸出。這些 phase 透過 `onProgress` 回傳後，再被 `updateSkillTaskStatus()` 寫回 task JSON。Sources: [skill-generator.ts](lib/processors/skill-generator.ts#L84-L140), [skill-generator.ts](lib/processors/skill-generator.ts#L145-L265), [route.ts](app/api/generate-skill/route.ts#L99-L118)

寫檔階段會先把 phase 改成 `writing`，接著把最終 `SKILL.md` 寫到版本化 skill 目錄，並逐一把本次 cleaned 檔案複製到 `references/`；完成後才把 `status` 改成 `completed`、`phase` 改成 `done`、更新 `fileCount`，並把 `skillPreview` 截成前 2000 字。Sources: [route.ts](app/api/generate-skill/route.ts#L116-L151)

失敗處理是以 partial update 方式覆寫同一份 `SkillTaskStatus`：`updateSkillTaskStatus()` 會先讀舊 JSON 再 merge 新欄位，因此成功路徑可逐步追加 phase / preview / fileCount；但失敗時目前只寫入 `status='failed'` 與 `error`，不會額外把 `phase` 改成獨立的 failed phase，畫面上最後看到的 phase 會停在失敗前的那一步。Sources: [route.ts](app/api/generate-skill/route.ts#L52-L76), [route.ts](app/api/generate-skill/route.ts#L143-L159)

## 前端如何提交、輪詢與重跑

Skill 分頁打開時就會呼叫 `loadSkillHistory()` 讀 `/api/skill-tasks`；使用者在送出前通常先透過 `/api/list-cleaned-folders` 取得 `cleaned/{date}/{domain}/` 清單，這個端點也會把每個資料夾的 `fileCount` 與 `emptyFileCount` 算出來，前端則對 `0B` 檔案顯示警告。Sources: [page.tsx](app/page.tsx#L225-L253), [page.tsx](app/page.tsx#L552-L556), [page.tsx](app/page.tsx#L2029-L2084), [route.ts](app/api/list-cleaned-folders/route.ts#L10-L85)

真正提交時，前端會先做比後端更嚴格的驗證：OAuth 模式要求先有 `codexAuth`，API key 模式要求 `skillApiKey`，而且自訂 model 也必須非空；檢查通過後才把 `date`、`domain`、provider/model、目前表單上的 `skillApiKey`、`baseUrl`、`customPrompt` 與所有 R2 overrides 一起送到 `/api/generate-skill`。成功後前端會立刻 reload history，再以 3 秒週期輪詢 `/api/skill-status/[taskId]`，直到 task 進入 `completed` 或 `failed`。Sources: [page.tsx](app/page.tsx#L284-L333), [page.tsx](app/page.tsx#L2106-L2145), [route.ts](app/api/skill-status/[taskId]/route.ts#L12-L49), [route.ts](app/api/codex-auth/route.ts#L1-L16)

History 卡片上的 Retry 並不是重用舊任務，而是把該筆 history 的 `date`、`domain`、`provider`、`modelId`、`baseUrl`、`customPrompt` 再送一次 `submitSkillGeneration()`，因此會得到新的 `taskId` 與新的版本化輸出資料夾；但 API key 仍取自目前表單 state 的 `skillApiKey`，不是從歷史紀錄回存。Sources: [page.tsx](app/page.tsx#L284-L333), [page.tsx](app/page.tsx#L2263-L2312)

## 關鍵模組 / 檔案導覽

| 檔案 | 角色 | 本頁重點 |
|---|---|---|
| `app/api/generate-skill/route.ts` | 建立 API 與背景 worker | 建 task、更新 `SkillTaskStatus`、寫版本化輸出 |
| `lib/processors/skill-generator.ts` | 生成核心 | 收集 cleaned 文件並執行 summarize / generate / refine |
| `lib/utils/task-metadata.ts` | 路徑工具 | 定義 versioned / legacy skill prefix |
| `app/api/skill-status/[taskId]/route.ts` | 單筆狀態查詢 | 前端輪詢 task JSON |
| `app/api/skill-tasks/route.ts` | 歷史列表查詢 | 讀取最近 50 筆 skill task |
| `app/api/list-cleaned-folders/route.ts` | cleaned 資料夾索引 | 提供可生成的 `{date, domain}` 與空檔案數 |
| `app/page.tsx` | Skill Generator UI | 送出、輪詢、history retry、下載 |

這些檔案共同組成「先從 cleaned prefix 選材，再建立 task JSON，之後由背景流程把輸出落到 versioned skill 目錄，最後由 status/history UI 觀察結果」的閉環。Sources: [route.ts](app/api/generate-skill/route.ts#L52-L238), [skill-generator.ts](lib/processors/skill-generator.ts#L145-L265), [task-metadata.ts](lib/utils/task-metadata.ts#L117-L123), [route.ts](app/api/skill-status/[taskId]/route.ts#L12-L49), [route.ts](app/api/skill-tasks/route.ts#L7-L69), [route.ts](app/api/list-cleaned-folders/route.ts#L10-L85), [page.tsx](app/page.tsx#L225-L333), [page.tsx](app/page.tsx#L2029-L2354)

## 已知邊界與踩坑

後端對 cleaned 輸入的檢查只有「prefix 下至少有物件」這一層，並不會像 `list-cleaned-folders` / UI 那樣辨識 `0B` 檔案並阻止送出，所以使用者即使已經看到 empty-file 警告，仍然可以繼續建立 skill 任務。Sources: [route.ts](app/api/generate-skill/route.ts#L175-L184), [route.ts](app/api/list-cleaned-folders/route.ts#L16-L18), [route.ts](app/api/list-cleaned-folders/route.ts#L43-L51), [page.tsx](app/page.tsx#L2070-L2083)

後端 phase 枚舉其實包含 `queued` 與 `collecting`，但前端進度條只畫出 `summarize`、`generate`、`refine`、`writing` 四步，所以 task 在剛建立或尚在收集 cleaned 檔案時，UI 並不會把這兩個早期 phase 視覺化成獨立節點。Sources: [route.ts](app/api/generate-skill/route.ts#L9-L25), [route.ts](app/api/generate-skill/route.ts#L192-L206), [skill-generator.ts](lib/processors/skill-generator.ts#L158-L181), [page.tsx](app/page.tsx#L2168-L2189)

這條建立路徑目前不是 queue-based worker，而是由 API route 在回應後直接 fire-and-forget 啟動 `processSkillGeneration()`；因此它的隔離單位是「每次建立一個新的 `taskId` 與版本化資料夾」，而不是把單一 task 分派到另一條背景佇列管線。Sources: [route.ts](app/api/generate-skill/route.ts#L78-L81), [route.ts](app/api/generate-skill/route.ts#L230-L238)
