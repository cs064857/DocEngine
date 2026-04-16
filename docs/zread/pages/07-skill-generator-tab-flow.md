# Skill Generator 分頁的互動流

## 本頁範圍與讀者定位

本頁只追蹤 `app/page.tsx` 中 Skill Generator 分頁，重點是它如何把「認證模式、provider/model 選擇、cleaned folder 挑選、送出生成、輪詢進度、歷史版本、下載與重跑」串成一條前後端互動鏈；若你想知道一個 `Generate Skill` 點擊之後，前端 state、`skill-tasks/{taskId}.json`、背景 worker 與版本化 `skills/` 目錄如何彼此對應，這頁就是最短入口。 Sources: [page.tsx](app/page.tsx#L181-L215), [page.tsx](app/page.tsx#L225-L333), [page.tsx](app/page.tsx#L1791-L2354), [route.ts](app/api/generate-skill/route.ts#L9-L25), [route.ts](app/api/generate-skill/route.ts#L81-L244)

## 一張圖看懂互動流

```mermaid
flowchart TD
  A[切到 Skill tab] --> B[loadSkillHistory]
  B --> C[/api/skill-tasks]
  A --> D[/api/pi-models]
  E[OAuth 重新檢查] --> F[/api/codex-auth]
  G[Refresh cleaned folders] --> H[/api/list-cleaned-folders]
  H --> I[cleaned/{date}/{domain}/]
  J[Generate Skill] --> K[submitSkillGeneration]
  K --> L[/api/generate-skill]
  L --> M[skill-tasks/{taskId}.json\nqueued + processing]
  M --> N[processSkillGeneration]
  N --> O[collecting]
  O --> P[summarize]
  P --> Q[generate]
  Q --> R[refine]
  R --> S[writing]
  S --> T[skills/{date}/{domain}/{taskId}/SKILL.md]
  S --> U[references/*.md]
  V[前端每 3 秒輪詢] --> W[/api/skill-status/{taskId}]
  W --> X[skillStatus + preview]
  X --> Y{completed / failed?}
  Y -->|yes| Z[重新載入 history]
  Z --> C
  X --> AA[Download]
  AA --> AB[/api/skill-download]
  C --> AC[Retry]
  AC --> K
```

這條流程可以拆成三段：先用 `/api/pi-models`、`/api/codex-auth`、`/api/list-cleaned-folders` 準備輸入，再由 `/api/generate-skill` 建立 `skill-tasks/{taskId}.json` 並 fire-and-forget 啟動 worker，最後由 `/api/skill-status/[taskId]` 與 `/api/skill-tasks` 把進度面板與版本歷史同步回前端，而完成品則落在 versioned `skills/{date}/{domain}/{taskId}/` 目錄供下載。 Sources: [page.tsx](app/page.tsx#L405-L434), [page.tsx](app/page.tsx#L552-L556), [page.tsx](app/page.tsx#L1824-L1858), [page.tsx](app/page.tsx#L2031-L2056), [page.tsx](app/page.tsx#L2106-L2354), [route.ts](app/api/generate-skill/route.ts#L166-L238), [route.ts](app/api/skill-status/[taskId]/route.ts#L6-L47), [route.ts](app/api/skill-tasks/route.ts#L7-L63), [task-metadata.ts](lib/utils/task-metadata.ts#L117-L123)

## 互動階段拆解

Skill 分頁在前端是獨立 state 群組：它持有 `skillAuthMode`、`skillProvider`、`skillApiKey`、`skillModel`、`skillUseCustomModel`、`skillCustomModelId`、`selectedFolder`、`skillStatus`、`skillHistory` 等欄位；其中 auth/provider/model/API key/baseUrl/custom model 旗標會跟著整體 `docengineConfig` 寫進 `localStorage`，但 `selectedFolder`、`skillStatus`、`skillHistory` 這類工作態不會被持久化；另外切到 `activeTab === 'skill'` 時只會自動載入 history。 Sources: [page.tsx](app/page.tsx#L181-L215), [page.tsx](app/page.tsx#L335-L374), [page.tsx](app/page.tsx#L436-L470), [page.tsx](app/page.tsx#L552-L556)

認證與模型選擇分成兩條路：OAuth 模式只針對 `openai-codex`，由 `/api/codex-auth` 回報伺服器端 `auth.json` 是否可用，真正送出時前端固定把 provider 設成 `openai-codex`、model 設成 `gpt-4o`；API key 模式則先在 mount effect 載入 `/api/pi-models` 的 registry，讓下拉選單顯示 `@mariozechner/pi-ai` 內建 provider/model，並額外插入 `openai-compatible` 這個可自填 `modelId` 與 `baseUrl` 的通道。 Sources: [page.tsx](app/page.tsx#L376-L434), [page.tsx](app/page.tsx#L1797-L1978), [page.tsx](app/page.tsx#L2126-L2135), [route.ts](app/api/codex-auth/route.ts#L4-L15), [route.ts](app/api/pi-models/route.ts#L23-L85), [pi-auth.ts](lib/oauth/pi-auth.ts#L51-L98)

API key 模式還有一個前置驗證動作：`Test LLM Connection` 會 POST `/api/test-llm`，Skill 路徑在 server 端不是走一般 cleaner 的 `chatCompletion()`，而是走 `piComplete()`，把 provider、modelId、apiKey、baseUrl 帶入 `@mariozechner/pi-ai complete(...)`；若 provider 是 `openai-codex` 且沒有明示 API key，`piComplete()` 會再透過 `getCodexApiKey()` 從 `auth.json` 讀取或刷新 OAuth token。 Sources: [page.tsx](app/page.tsx#L1979-L2024), [route.ts](app/api/test-llm/route.ts#L7-L103), [pi-llm.ts](lib/services/pi-llm.ts#L29-L141), [pi-auth.ts](lib/oauth/pi-auth.ts#L71-L98)

`Cleaned Folder` 區塊不是從 history 反推，而是獨立向 `/api/list-cleaned-folders` 要資料；前端在 `Refresh` 時把目前 R2 覆蓋欄位一併送出，後端則掃描 `cleaned/` prefix，將 key 依 `cleaned/{date}/{domain}/{path}.md` 聚合成唯一的 `{date, domain}` 組合，並附帶 `fileCount` 與 `emptyFileCount`，所以 UI 才能在下拉選單中直接顯示「幾個檔案」以及 0B 檔案警告。 Sources: [page.tsx](app/page.tsx#L2030-L2084), [route.ts](app/api/list-cleaned-folders/route.ts#L10-L18), [route.ts](app/api/list-cleaned-folders/route.ts#L19-L79)

真正提交時，`submitSkillGeneration()` 先做前端閘門：OAuth 要先有 `codexAuth`，非 OAuth 要先有 `skillApiKey`，接著把 `date`、`domain`、provider/model、可選 `baseUrl`、可選 `customPrompt` 與 R2 覆蓋一起 POST 到 `/api/generate-skill`；route 會先確認 `cleaned/{date}/{domain}/` 至少有檔案，再建立一筆 `status: processing`、`phase: queued` 的 `SkillTaskStatus` 寫入 `skill-tasks/{taskId}.json`，最後以 fire-and-forget 方式啟動背景處理。 Sources: [page.tsx](app/page.tsx#L284-L333), [page.tsx](app/page.tsx#L2106-L2145), [route.ts](app/api/generate-skill/route.ts#L166-L238)

背景 worker 的責任不是只吐一個 `SKILL.md` 字串，而是完整版本化輸出：`processSkillGeneration()` 先解析 provider/model/apiKey/baseUrl 的最終值，再呼叫 `generateSkill()`；而 `generateSkill()` 會從 `cleaned/{date}/{domain}/` 列出全部 `.md`，讀內容後依序執行 `collecting -> summarize -> generate -> refine`，其中三個 LLM 階段都透過 `piComplete()`；完成後 worker 會把 `SKILL.md` 寫到 `skills/{date}/{domain}/{taskId}/SKILL.md`，再把來源 cleaned 檔複製到同一版本目錄的 `references/`，最後把 task 狀態更新成 `completed`、`phase: done`，並在 JSON 中保留前 2000 字的 `skillPreview`。 Sources: [route.ts](app/api/generate-skill/route.ts#L81-L160), [skill-generator.ts](lib/processors/skill-generator.ts#L84-L140), [skill-generator.ts](lib/processors/skill-generator.ts#L145-L265), [pi-llm.ts](lib/services/pi-llm.ts#L29-L141), [task-metadata.ts](lib/utils/task-metadata.ts#L117-L123)

提交成功後，前端會立刻記住 `taskId`、刷新一次 history，然後開始每 3 秒 POST `/api/skill-status/[taskId]` 查詢最新 `SkillTaskStatus`；只要 status 進入 `completed` 或 `failed`，poller 就會停止並再次刷新 history。另一方面，`/api/skill-tasks` 會先掃 `skill-tasks/` prefix，再依 R2 `LastModified` 新到舊排序，只讀最新 50 筆 JSON，因此 Skill 分頁歷史是一份「最近版本清單」，不是全量事件流。 Sources: [page.tsx](app/page.tsx#L225-L282), [page.tsx](app/page.tsx#L305-L329), [route.ts](app/api/skill-status/[taskId]/route.ts#L6-L47), [route.ts](app/api/skill-tasks/route.ts#L7-L33), [route.ts](app/api/skill-tasks/route.ts#L48-L63)

畫面上的進度面板與歷史卡片共用同一種 `SkillTaskStatus`：即時面板會依 `skillStatus.status` 顯示 badge、phase chips、錯誤訊息與 `skillPreview`，而完成後的下載按鈕會把 `date`、`domain`、`taskId` 與 R2 覆蓋送到 `/api/skill-download`；歷史卡片則把每次 run 視為一個 isolated version，`Retry` 會重用該筆記錄保存的 provider/model/baseUrl/customPrompt 再送一次 `submitSkillGeneration()`，`Download` 會以 `taskId` 生成檔名並下載 zip。 Sources: [page.tsx](app/page.tsx#L2155-L2354), [route.ts](app/api/skill-download/route.ts#L13-L97), [route.ts](app/api/generate-skill/route.ts#L9-L25)

## 互動節點對照表

| 互動節點 | 前端行為 | 後端 / 儲存落點 | 證據 |
| --- | --- | --- | --- |
| 進入 Skill 分頁 | 切 tab 後自動載入 history | `/api/skill-tasks` 讀 `skill-tasks/` 最新 50 筆 | [page.tsx](app/page.tsx#L552-L556), [route.ts](app/api/skill-tasks/route.ts#L7-L33), [route.ts](app/api/skill-tasks/route.ts#L48-L63) |
| OAuth / API key 選擇 | `skillAuthMode` 切換不同表單；OAuth 可重新檢查，API key 可選 provider/model/custom model/baseUrl | `/api/codex-auth`、`/api/pi-models`、`/api/test-llm` | [page.tsx](app/page.tsx#L1797-L2024), [route.ts](app/api/codex-auth/route.ts#L4-L15), [route.ts](app/api/pi-models/route.ts#L23-L85), [route.ts](app/api/test-llm/route.ts#L7-L103) |
| 選 cleaned folder | 手動 Refresh，選 `date|domain`，必要時顯示 0B warning | `/api/list-cleaned-folders` 聚合 `cleaned/{date}/{domain}/` | [page.tsx](app/page.tsx#L2030-L2084), [route.ts](app/api/list-cleaned-folders/route.ts#L10-L79) |
| 送出生成 | 驗證 auth / api key 後呼叫 `submitSkillGeneration()` | `/api/generate-skill` 建立 `skill-tasks/{taskId}.json` 並啟動 worker | [page.tsx](app/page.tsx#L284-L333), [page.tsx](app/page.tsx#L2106-L2145), [route.ts](app/api/generate-skill/route.ts#L166-L238) |
| 背景生成 | 前端只看 phase；實際收集、摘要、生成、精修在 server 完成 | `skills/{date}/{domain}/{taskId}/SKILL.md` + `references/` | [route.ts](app/api/generate-skill/route.ts#L81-L160), [skill-generator.ts](lib/processors/skill-generator.ts#L145-L265), [task-metadata.ts](lib/utils/task-metadata.ts#L117-L123) |
| 進度與歷史同步 | 每 3 秒輪詢單筆狀態，完成後刷新 history | `/api/skill-status/[taskId]`、`/api/skill-tasks` | [page.tsx](app/page.tsx#L255-L282), [route.ts](app/api/skill-status/[taskId]/route.ts#L6-L47), [route.ts](app/api/skill-tasks/route.ts#L7-L33) |
| 下載與重跑 | 即時面板與 history 都可下載；history 可 retry | `/api/skill-download` 先找 versioned prefix，再 fallback legacy prefix | [page.tsx](app/page.tsx#L2208-L2238), [page.tsx](app/page.tsx#L2285-L2354), [route.ts](app/api/skill-download/route.ts#L36-L52) |

把上表串起來看，Skill 分頁其實不是「單一提交表單」，而是一個以 `skill-tasks/` 為控制面、以 `skills/{date}/{domain}/{taskId}/` 為輸出面、以 `cleaned/{date}/{domain}/` 為來源面的三段式工作台。 Sources: [route.ts](app/api/list-cleaned-folders/route.ts#L10-L79), [route.ts](app/api/generate-skill/route.ts#L166-L238), [route.ts](app/api/skill-tasks/route.ts#L7-L33), [task-metadata.ts](lib/utils/task-metadata.ts#L117-L123)

## 關鍵模組 / 檔案導覽

| 檔案 | 在本頁的角色 |
| --- | --- |
| `app/page.tsx` | Skill 分頁的 UI、state、history 載入、submit、polling、retry/download 都集中在這裡。 |
| `app/api/pi-models/route.ts` | 提供 provider/model registry，並補一個 `openai-compatible` 自訂通道。 |
| `app/api/codex-auth/route.ts` + `lib/oauth/pi-auth.ts` | 檢查伺服器端 Codex OAuth 是否可用，並在需要時從 `auth.json` 讀取/刷新 token。 |
| `app/api/test-llm/route.ts` + `lib/services/pi-llm.ts` | 測試 Skill provider 連線，實際封裝 `@mariozechner/pi-ai` 的 `complete(...)`。 |
| `app/api/list-cleaned-folders/route.ts` | 把 `cleaned/` 物件列表整理成前端可選的 folder 清單與 0B 統計。 |
| `app/api/generate-skill/route.ts` | 建立 `SkillTaskStatus`、啟動背景 worker、更新 phase 與完成/失敗狀態。 |
| `lib/processors/skill-generator.ts` | 真正的 Skill 生成核心：收集 cleaned docs、summarize、generate、refine。 |
| `app/api/skill-status/[taskId]/route.ts` + `app/api/skill-tasks/route.ts` | 單筆狀態查詢與最近歷史列表讀面。 |
| `app/api/skill-download/route.ts` + `lib/utils/task-metadata.ts` | 依 `taskId` 優先下載 versioned skill 目錄，必要時退回 legacy 路徑。 |

若你要 trace 一個 Skill run 的問題，實務上最有效的順序是：先看 `app/page.tsx` 確認前端送了什麼，再看 `app/api/generate-skill/route.ts` 的 task 建立與 phase 更新，最後看 `lib/processors/skill-generator.ts` 與 `lib/services/pi-llm.ts` 判斷是來源檔案、模型設定，還是輸出寫入出了問題。 Sources: [page.tsx](app/page.tsx#L225-L333), [page.tsx](app/page.tsx#L1791-L2354), [route.ts](app/api/generate-skill/route.ts#L52-L160), [skill-generator.ts](lib/processors/skill-generator.ts#L145-L265), [pi-llm.ts](lib/services/pi-llm.ts#L29-L141)

## 容易踩坑的地方

第一個要注意的是 phase 顯示並不完整：後端 `SkillTaskStatus.phase` 型別與初始化值都包含 `queued`、`collecting`、`summarize`、`generate`、`refine`、`writing`、`done`，而 `generateSkill()` 也真的會先回報 `collecting`；但前端 phase chips 只畫 `summarize / generate / refine / writing`，比較陣列也沒有 `queued`、`collecting`，所以任務剛建立或正在讀 cleaned 檔時，進度指示器不會有對應高亮。 Sources: [route.ts](app/api/generate-skill/route.ts#L9-L25), [route.ts](app/api/generate-skill/route.ts#L108-L149), [skill-generator.ts](lib/processors/skill-generator.ts#L158-L181), [page.tsx](app/page.tsx#L2168-L2189)

第二個坑是前端比後端更嚴格地要求 API key：UI 在非 OAuth 路徑下會直接擋住沒有 `skillApiKey` 的提交與測試，但 server 端實際仍保留 `SKILL_GENERATOR_API_KEY`、`SKILL_GENERATOR_BASE_URL`、`SKILL_GENERATOR_PROVIDER`、`SKILL_GENERATOR_MODEL_ID` 這組 fallback 設定。也就是說，若你打算依賴伺服器環境變數，後端本身做得到，但當前 Skill 分頁 UI 不讓你這樣操作。 Sources: [page.tsx](app/page.tsx#L292-L297), [page.tsx](app/page.tsx#L2008-L2015), [route.ts](app/api/generate-skill/route.ts#L88-L97), [config.ts](lib/config.ts#L17-L24)

第三個坑藏在 Retry：history 卡片會把舊 run 儲存的 `provider`、`modelId`、`baseUrl`、`customPrompt` 帶回 `submitSkillGeneration()`，但真正送出的 `apiKey` 仍取自當前畫面的 `skillApiKey` state，而不是歷史記錄本身；因此只靠 history metadata 並不足以重跑非 OAuth 任務，現在的表單 API key 仍必須有效。 Sources: [page.tsx](app/page.tsx#L284-L333), [page.tsx](app/page.tsx#L2287-L2297), [route.ts](app/api/generate-skill/route.ts#L21-L24)

第四個坑是不要把 history 的時間與下載來源想得太直覺：列表排序依據是 R2 物件 `LastModified`，不是 `createdAt` 欄位；下載時則會先找 `skills/{date}/{domain}/{taskId}/` 這個 versioned prefix，只有找不到才退回 `skills/{date}/{domain}/` 的 legacy 目錄，所以同一 domain 的多次 run 在設計上是被刻意隔離的。 Sources: [route.ts](app/api/skill-tasks/route.ts#L7-L33), [page.tsx](app/page.tsx#L2243-L2283), [route.ts](app/api/skill-download/route.ts#L36-L52), [task-metadata.ts](lib/utils/task-metadata.ts#L117-L123)

第五個坑是 auto-load 的範圍很有限：切到 Skill 分頁時只會自動抓 history，`Cleaned Folder` 清單要靠 `Refresh`，OAuth 狀態要靠 `重新檢查授權狀態`；如果使用者以為進頁後所有前置資料都會同步刷新，就會誤判當前 UI 顯示的是即時狀態。 Sources: [page.tsx](app/page.tsx#L552-L556), [page.tsx](app/page.tsx#L1841-L1858), [page.tsx](app/page.tsx#L2031-L2056)
