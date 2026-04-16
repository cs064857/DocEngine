# Skill 狀態、歷史與下載 API

## 本頁範圍與讀者定位

本頁聚焦 Skill Generator 的三個讀面 / 輸出面 API：`/api/skill-status/[taskId]`、`/api/skill-tasks`、`/api/skill-download`，以及它們如何從 `skill-tasks/{taskId}.json` 與 `skills/{date}/{domain}/{taskId}/` 讀回進度、歷史與下載包；如果你已經知道 `/api/generate-skill` 會建立版本化 skill 任務，這頁就是接著往下看「怎麼查、怎麼列、怎麼抓」的最短入口。 Sources: [page.tsx](app/page.tsx#L225-L333), [page.tsx](app/page.tsx#L2208-L2354), [route.ts](app/api/skill-status/[taskId]/route.ts#L12-L47), [route.ts](app/api/skill-tasks/route.ts#L7-L69), [route.ts](app/api/skill-download/route.ts#L13-L99), [route.ts](app/api/generate-skill/route.ts#L192-L238)

## 一張圖看懂讀面與下載面

```mermaid
flowchart TD
  A[/api/generate-skill/] --> B[create skill-tasks/{taskId}.json\nstatus=processing phase=queued]
  B --> C[processSkillGeneration]
  C --> D[updateSkillTaskStatus\ncollecting -> summarize -> generate -> refine -> writing]
  D --> E[write skills/{date}/{domain}/{taskId}/SKILL.md]
  E --> F[copy references/*.md]
  F --> G[update task\nstatus=completed phase=done\nfileCount + skillPreview]
  C --> H[on error\nstatus=failed\nphase preserved]
  B --> I[/api/skill-status/{taskId}\nread one task JSON]
  B --> J[/api/skill-tasks\nlist skill-tasks/\nsort LastModified desc]
  E --> K[/api/skill-download\nbuild versioned prefix]
  K --> L{versioned files exist?}
  L -->|yes| M[zip versioned files]
  L -->|no| N[fallback to legacy prefix]
  J --> O[Skill tab history]
  I --> P[current status panel]
  K --> Q[current/history download]
```

這三個 API 本身都很薄：`/api/skill-status/[taskId]` 只是直讀單筆 `skill-tasks/{taskId}.json`，`/api/skill-tasks` 只是掃描 `skill-tasks/` 並挑出最近 50 筆，`/api/skill-download` 則依請求重新組出 skill 目錄 prefix 後打包 ZIP；真正決定 phase、preview、輸出檔位置的寫面仍在 `/api/generate-skill` 與 `processSkillGeneration()`。 Sources: [route.ts](app/api/skill-status/[taskId]/route.ts#L12-L47), [route.ts](app/api/skill-tasks/route.ts#L7-L69), [route.ts](app/api/skill-download/route.ts#L13-L99), [route.ts](app/api/generate-skill/route.ts#L52-L160), [route.ts](app/api/generate-skill/route.ts#L192-L238)

## 三個 API 的職責與回傳來源

`/api/skill-status/[taskId]` 只有 `POST`，因為它允許 request body 夾帶 `r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName` 這四個覆蓋欄位；route 會直接 `getObject('skill-tasks/{taskId}.json')`、`JSON.parse(...)` 後原樣回傳 `SkillTaskStatus`，若 R2 物件不存在則回 404。 Sources: [route.ts](app/api/skill-status/[taskId]/route.ts#L12-L47), [route.ts](app/api/generate-skill/route.ts#L9-L25)

`/api/skill-tasks` 是最近歷史列表端點：`GET` 走預設 R2 設定，`POST` 則允許帶同一組 R2 覆蓋欄位；它會先 `listObjects('skill-tasks/', 1000)`，再依物件 `LastModified` 由新到舊排序，只讀前 50 筆 JSON，讀失敗的項目只記錄 log 並略過，不會讓整個列表失敗。 Sources: [route.ts](app/api/skill-tasks/route.ts#L7-L33), [route.ts](app/api/skill-tasks/route.ts#L35-L69)

`/api/skill-download` 只接受 `POST`，而且硬性要求 `date` 與 `domain`；若有 `taskId`，它會先組出 `skills/{date}/{domain}/{taskId}/` 的 versioned prefix，列不到檔案才退回 `skills/{date}/{domain}/` 的 legacy prefix，接著把找到的所有物件讀出後放進 `${domain}-skill/` 子資料夾並回傳 `application/zip`。 Sources: [route.ts](app/api/skill-download/route.ts#L13-L93), [task-metadata.ts](lib/utils/task-metadata.ts#L117-L123)

這三個讀面 API 不會自行推導狀態欄位；`SkillTaskStatus` 是由 `/api/generate-skill` 先寫入 `status: 'processing'`、`phase: 'queued'` 的初始 JSON，再由 `updateSkillTaskStatus()` 持續覆蓋同一個 `skill-tasks/{taskId}.json`，把 `collecting / summarize / generate / refine / writing / done`、`fileCount`、`skillPreview`、`outputPrefix` 等資訊寫回去，因此 status 與 history 本質上都在讀同一份任務檔。 Sources: [route.ts](app/api/generate-skill/route.ts#L52-L76), [route.ts](app/api/generate-skill/route.ts#L81-L160), [route.ts](app/api/generate-skill/route.ts#L192-L212), [skill-generator.ts](lib/processors/skill-generator.ts#L145-L259)

## 關鍵模組 / 檔案導覽

| 檔案 | 角色 | 本頁關心的重點 | 證據 |
| --- | --- | --- | --- |
| `app/api/skill-status/[taskId]/route.ts` | 單筆狀態讀面 | 直接讀 `skill-tasks/{taskId}.json`，找不到回 404。 | [route.ts](app/api/skill-status/[taskId]/route.ts#L12-L47) |
| `app/api/skill-tasks/route.ts` | 最近歷史列表 | 掃 `skill-tasks/`、依 `LastModified` 排序、最多回 50 筆。 | [route.ts](app/api/skill-tasks/route.ts#L7-L69) |
| `app/api/skill-download/route.ts` | ZIP 下載端點 | 優先抓 versioned prefix，失敗才 fallback legacy prefix。 | [route.ts](app/api/skill-download/route.ts#L13-L99), [task-metadata.ts](lib/utils/task-metadata.ts#L117-L123) |
| `app/api/generate-skill/route.ts` | 狀態寫面與背景 worker 入口 | 初始化 `SkillTaskStatus`，並在背景流程中反覆覆寫同一份 task JSON。 | [route.ts](app/api/generate-skill/route.ts#L52-L76), [route.ts](app/api/generate-skill/route.ts#L81-L160), [route.ts](app/api/generate-skill/route.ts#L166-L238) |
| `lib/processors/skill-generator.ts` | phase 來源 | 真正發出 `collecting -> summarize -> generate -> refine` 進度。 | [skill-generator.ts](lib/processors/skill-generator.ts#L145-L259) |
| `lib/utils/task-metadata.ts` | 路徑規則 | 定義 versioned / legacy skill prefix 的組法。 | [task-metadata.ts](lib/utils/task-metadata.ts#L117-L123) |
| `app/page.tsx` | 唯一前端消費者 | 載入 history、輪詢 status、觸發 download，全都集中在 Skill tab。 | [page.tsx](app/page.tsx#L225-L333), [page.tsx](app/page.tsx#L552-L564), [page.tsx](app/page.tsx#L2168-L2354) |

把這些檔案串起來看，Skill 的「狀態面、歷史面、下載面」並不是三條獨立資料流，而是同一組 versioned task/output 資料在不同 UI 節點上的三種讀法：單筆 JSON、最近列表、整包 ZIP。 Sources: [route.ts](app/api/skill-status/[taskId]/route.ts#L12-L47), [route.ts](app/api/skill-tasks/route.ts#L7-L69), [route.ts](app/api/skill-download/route.ts#L13-L99), [route.ts](app/api/generate-skill/route.ts#L192-L238)

## 前端如何使用這三個 API

Skill 分頁被打開時，前端只會自動呼叫一次 `loadSkillHistory()`；提交新任務後，`submitSkillGeneration()` 會先拿到新的 `taskId`，立刻刷新 history，然後開始每 3 秒 `POST /api/skill-status/{taskId}` 輪詢，直到 `status` 進入 `completed` 或 `failed` 才停下來並再次刷新 history，而且輪詢失敗會被刻意吞掉，不讓畫面中斷。 Sources: [page.tsx](app/page.tsx#L225-L282), [page.tsx](app/page.tsx#L299-L333), [page.tsx](app/page.tsx#L552-L564)

即時狀態卡片會吃 `skillStatus.skillPreview` 與 `skillStatus.fileCount`；當前 run 完成後，下載按鈕會把 `date`、`domain`、`taskId` 與 R2 覆蓋欄位送給 `/api/skill-download`，並以前端 `<a download>` 指定 `${domain}-skill.zip`。歷史卡片則顯示 `status`、`domain`、`createdAt`、`provider/modelId`、`taskId`，只有 `completed` 項目能下載，且會用 `${domain}-${taskId.slice(0, 8)}-skill.zip` 這個更偏版本化的檔名。 Sources: [page.tsx](app/page.tsx#L2191-L2238), [page.tsx](app/page.tsx#L2243-L2354), [route.ts](app/api/skill-download/route.ts#L86-L92), [route.ts](app/api/generate-skill/route.ts#L144-L149)

## 容易踩坑的地方

第一個坑是「列表排序」與「列表顯示時間」不是同一件事：`/api/skill-tasks` 用的是 R2 物件 `LastModified` 來排序，但 history 卡片畫面上顯示的是 task JSON 內的 `createdAt`，而同一個 task 檔在整個生成過程中會被 `updateSkillTaskStatus()` 持續覆寫，所以使用者看到的時間未必就是列表排序依據。 Sources: [route.ts](app/api/skill-tasks/route.ts#L7-L24), [route.ts](app/api/generate-skill/route.ts#L52-L72), [page.tsx](app/page.tsx#L2268-L2283)

第二個坑是 failed 任務沒有自己的 phase：失敗時 worker 只更新 `status: 'failed'` 與 `error`，沒有把 `phase` 改成額外的 failed 狀態；由於 `updateSkillTaskStatus()` 是 merge 現有 JSON，失敗後前端看到的 phase 其實會停留在上一個成功寫入的階段，例如 `queued`、`collecting`、`generate` 或 `writing`。 Sources: [route.ts](app/api/generate-skill/route.ts#L52-L76), [route.ts](app/api/generate-skill/route.ts#L156-L159)

第三個坑是前端 stepper 不完整：後端型別與生成器都明確有 `queued`、`collecting`、`summarize`、`generate`、`refine`、`writing`、`done`，但 UI stepper 只畫 `summarize / generate / refine / writing`，因此任務剛建立或仍在讀取 cleaned 文件時，status API 雖然已經回報 phase，畫面卻沒有對應節點可高亮。 Sources: [route.ts](app/api/generate-skill/route.ts#L9-L25), [skill-generator.ts](lib/processors/skill-generator.ts#L158-L181), [page.tsx](app/page.tsx#L2168-L2189)

第四個坑在下載面：`/api/skill-download` 不會先讀 `skill-tasks/{taskId}.json` 驗證 `outputPrefix`，而是完全信任呼叫端給的 `date`、`domain`、`taskId` 來重建 prefix；而且只要 prefix 底下有任何物件可列出，它就會嘗試逐檔讀取，讀不到的檔案只會 `console.warn(...)` 後略過，最後仍然回傳 ZIP，因此成功下載不等於 ZIP 一定完整。 Sources: [route.ts](app/api/skill-download/route.ts#L15-L45), [route.ts](app/api/skill-download/route.ts#L58-L72), [route.ts](app/api/generate-skill/route.ts#L190-L205)
