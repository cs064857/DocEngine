# CrawlDocs Web — Shadow Architecture Map

> **受眾**：AI Agents。問題導向索引——「功能 X / 領域 Y 的程式碼在哪個 Bundle？」  
> **索引來源**：`.blueprint/bundles.json`（11 bundles / 63 files）  
> **專案**：Next.js App Router · 文件爬取 · Skill 產生 · LLM 整合

---

## 快速導航（Feature → Bundle）

| 你要找… | Bundle | 關鍵目錄 |
|--------|--------|----------|
| 根 layout / 首頁 / next 設定 / 全域 config | **bundle_1** `app-shell-and-config` | `app/`, `lib/config.ts`, `next.config.ts` |
| 爬取引擎、併發、dispatch、scrape 任務、Firecrawl key | **bundle_2** `crawl-services-and-tests` | `lib/services/` + `tests/` |
| HTTP：`/api/crawl` `/scrape` `/map` `/retry` `/abort` 佇列 | **bundle_3** `crawl-api-routes` | `app/api/crawl*`, `scrape`, `map`, `queues`, `retry`, `abort` |
| 清理文件、檔案列表、URL 抽取 | **bundle_4** `clean-and-files` | `app/api/clean|files|list-cleaned-folders`, `lib/processors/` |
| Skill API：產生 / 狀態 / 下載 / 中止 / 任務列表 | **bundle_5** `skill-api-routes` | `app/api/generate-skill`, `skill-*`, `abort-skill` |
| Skill 產生器、prompt、任務控制邏輯 | **bundle_6** `skill-lib-and-tests` | `lib/processors|prompts|services|utils` + tests |
| 一般爬取任務 metadata / progress / status | **bundle_7** `task-tracking` | `app/api/tasks`, `status/[taskId]`, `lib/utils/task-*` |
| Codex/Pi 認證、LLM 服務、模型列表 | **bundle_8** `llm-and-auth` | `app/api/*auth|*llm|pi-models`, `lib/oauth`, `lib/services/llm*` |
| R2 儲存、下載、helpers、引擎 UI 設定 | **bundle_9** `shared-utils-and-storage` | `lib/r2.ts`, `lib/utils/` |
| skill-creator 評測 / benchmark / report 迴圈 | **bundle_10** `skill-creator-eval-benchmark` | `skill-creator/scripts/run_*`, `eval-viewer/` |
| skill-creator 打包 / 驗證 / description 改善 | **bundle_11** `skill-creator-packaging-utils` | `skill-creator/scripts/package_*` 等 |

---

## 領域分層

```
┌─────────────────────────────────────────────────────────────┐
│  App Shell          bundle_1  layout · page · config · next │
├─────────────────────────────────────────────────────────────┤
│  HTTP API Layer                                             │
│    Crawl/Map/Scrape  bundle_3                               │
│    Clean/Files       bundle_4                               │
│    Skill lifecycle   bundle_5                               │
│    Task status       bundle_7                               │
│    LLM/Auth          bundle_8                               │
├─────────────────────────────────────────────────────────────┤
│  Domain Services                                            │
│    Crawl core        bundle_2  crawler · dispatch · key     │
│    Skill core        bundle_6  generator · control · status │
│    LLM services      bundle_8  llm · pi-llm · pi-auth       │
│    Clean processors  bundle_4  cleaner · url-extractor      │
├─────────────────────────────────────────────────────────────┤
│  Shared Infra        bundle_9  r2 · download · helpers      │
├─────────────────────────────────────────────────────────────┤
│  Offline Tooling     skill-creator/                         │
│    Eval/Benchmark    bundle_10                              │
│    Package/Utils     bundle_11                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Bundle 詳目

### 殼層與設定

#### bundle_1 · `app-shell-and-config` (5)
**職責**：Next.js 應用殼層與全域設定。  
**檔案**：`next-env.d.ts` · `next.config.ts` · `app/layout.tsx` · `app/page.tsx` · `lib/config.ts`  
**找這裡若**：改首頁 UI、根 layout、環境/全域 config、Next 編譯設定。

---

### 爬取域（Crawl）

#### bundle_2 · `crawl-services-and-tests` (8)
**職責**：爬取核心服務——crawler / dispatch / concurrency / scrape-task / firecrawl-key。  
**核心**：`lib/services/crawler.ts`, `crawl-dispatch.ts`, `crawl-concurrency.ts`, `scrape-task.ts`, `firecrawl-key-manager.ts`  
**測試**：`tests/crawl-*.test.ts`, `scrape-task.test.ts`  
**找這裡若**：改爬取邏輯、併發控制、任務分派、Firecrawl API key 輪替。

#### bundle_3 · `crawl-api-routes` (7)
**職責**：爬取/抓取 HTTP 入口。  
**路由**：`/api/crawl` · `/api/crawl-job` · `/api/map` · `/api/scrape` · `/api/queues/process-url` · `/api/retry` · `/api/abort`  
**找這裡若**：新增/修改 crawl HTTP 契約、重試、中止、佇列消費入口。  
**下游**：呼叫 **bundle_2** 服務。

#### bundle_7 · `task-tracking` (6)
**職責**：一般爬取任務追蹤（非 Skill 任務）。  
**路由**：`/api/tasks` · `/api/status/[taskId]`  
**Utils**：`task-metadata.ts` · `task-progress-drawer.ts`  
**找這裡若**：任務列表、進度、metadata 讀寫。  
**注意**：Skill 任務狀態走 **bundle_5/6**，勿混淆。

---

### 清理與檔案域

#### bundle_4 · `clean-and-files` (5)
**職責**：文件清理與檔案列舉。  
**路由**：`/api/clean` · `/api/files` · `/api/list-cleaned-folders`  
**Processors**：`lib/processors/cleaner.ts` · `url-extractor.ts`  
**找這裡若**：清洗 markdown、抽 URL、列出已清理資料夾。

---

### Skill 域

#### bundle_5 · `skill-api-routes` (5)
**職責**：Skill 生命週期 HTTP API。  
**路由**：`/api/generate-skill` · `/api/skill-tasks` · `/api/skill-status/[taskId]` · `/api/skill-download` · `/api/abort-skill`  
**找這裡若**：Skill 產生請求契約、狀態輪詢、下載、中止。  
**下游**：呼叫 **bundle_6**。

#### bundle_6 · `skill-lib-and-tests` (6)
**職責**：Skill 產生與任務控制核心。  
**核心**：`lib/processors/skill-generator.ts` · `lib/prompts/skill-generator.ts` · `lib/services/skill-task-control.ts` · `lib/utils/skill-task-status.ts`  
**測試**：`skill-task-control.test.ts` · `skill-task-status.test.ts`  
**找這裡若**：改 Skill 產生流程、prompt、任務狀態機。  
**依賴**：常經 **bundle_8** 呼叫 LLM。

---

### LLM 與認證域

#### bundle_8 · `llm-and-auth` (6)
**職責**：LLM 呼叫與 OAuth/認證。  
**路由**：`/api/codex-auth` · `/api/pi-models` · `/api/test-llm`  
**服務**：`lib/services/llm.ts` · `pi-llm.ts` · `lib/oauth/pi-auth.ts`  
**找這裡若**：換 LLM provider、Pi/Codex 認證、模型列表、連線測試。

---

### 共用基礎設施

#### bundle_9 · `shared-utils-and-storage` (5)
**職責**：跨域共用。  
**檔案**：`lib/r2.ts` · `lib/utils/download.ts` · `helpers.ts` · `advanced-engine-settings-ui.ts` + test  
**找這裡若**：R2 上傳下載、通用 helpers、進階爬取引擎 UI 設定。

---

### skill-creator 離線工具（Python）

#### bundle_10 · `skill-creator-eval-benchmark` (5)
**職責**：評測與基準迴圈。  
**腳本**：`run_eval.py` · `run_loop.py` · `aggregate_benchmark.py` · `generate_report.py` · `eval-viewer/generate_review.py`  
**找這裡若**：Skill 品質評測、benchmark 彙總、report/review 產生。

#### bundle_11 · `skill-creator-packaging-utils` (5)
**職責**：打包與輔助工具。  
**腳本**：`package_skill.py` · `quick_validate.py` · `improve_description.py` · `utils.py` · `__init__.py`  
**找這裡若**：打包 skill、快速驗證、改善 description。

---

## 典型資料流（Agent 追蹤用）

```
[Crawl 請求]
  bundle_3 API → bundle_2 services → (Firecrawl) → bundle_9 R2
                ↘ bundle_7 task status/metadata

[Clean 請求]
  bundle_4 API → cleaner / url-extractor → files / list-cleaned-folders

[Skill 產生]
  bundle_5 API → bundle_6 generator+control → bundle_8 LLM
                ↘ skill-status / skill-download

[Skill 評測（離線）]
  bundle_10 run_eval/run_loop → report/review
  bundle_11 package/validate
```

---

## 目錄 ↔ Bundle 對照

| 目錄前綴 | Bundles |
|---------|---------|
| `app/layout.tsx`, `app/page.tsx`, root config | 1 |
| `app/api/crawl*`, `scrape`, `map`, `queues`, `retry`, `abort` | 3 |
| `app/api/clean`, `files`, `list-cleaned-folders` | 4 |
| `app/api/generate-skill`, `skill-*`, `abort-skill` | 5 |
| `app/api/tasks`, `status/[taskId]` | 7 |
| `app/api/codex-auth`, `pi-models`, `test-llm` | 8 |
| `lib/services/crawl*`, `scrape-task`, `firecrawl-key*` | 2 |
| `lib/services/skill-*`, `processors/skill-*`, `prompts/skill-*` | 6 |
| `lib/services/llm*`, `lib/oauth/*` | 8 |
| `lib/processors/cleaner*`, `url-extractor*` | 4 |
| `lib/utils/task-*` | 7 |
| `lib/utils/skill-task-*` | 6 |
| `lib/r2.ts`, `lib/utils/download|helpers|advanced-*` | 9 |
| `lib/config.ts` | 1 |
| `tests/crawl*|scrape-task*` | 2 |
| `tests/skill-task*` | 6 |
| `tests/task-*` | 7 |
| `skill-creator/scripts/run_*|aggregate*|generate_report*` + eval-viewer | 10 |
| `skill-creator/scripts/package*|quick_validate*|improve*|utils*` | 11 |

---

## 統計

| 項目 | 值 |
|------|-----|
| Bundle 數 | **11** |
| 總檔案數 | **63** |
| 主應用 (bundle 1–9) | 53 files |
| skill-creator 離線 (10–11) | 10 files |
| 索引檔 | `bundles.json` · 本 `README.md` |
