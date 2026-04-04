# Design Doc: Task Progress Visualization

## Objective

提供一個可視化界面去即時管理並監控 CrawlDocs-web 的任務擷取進度。確保用戶能精確掌握目標網站 URL 的處理狀況，並能在遭遇任務失敗時快速執行修復流程。

## Architecture & Data Flow

- **元件結構 (Component Hierarchy)**:
  - 任務啟動後觸發開啟 `TaskProgressDrawer` 抽屜元件。
  - 透過前端狀態管理或後端事件 (SSE / 輪詢 polling) 即時獲取當前 TaskID 底下的 URL 處理情況。
- **後端整合**:
  - 前端與現有的佇列 (Queue) 歷史 API 整合，以更新及反饋 `Pending`, `Loading`, `Success`, `Failed` 等即時狀態。
- **Retry Mechanism**:
  - Single Retry: 將特定的 Failed URL 擷取，直接呼叫 `/api/queues/process-url` 再次排隊，並將該項目切回 Loading，不影響其他條目。
  - Retry All Failed: 批次收集當下列表內所有處於 Failed 狀態的 URL，將其統一重製送回後端。

## User Interface Requirements

### 1. 觸發與容器 (Drawer)

- 使用在右側全螢幕或覆蓋的抽屜面板 (Drawer)，以確保關注點集中且不影響底層設定頁面。
- 專為單次觸發的大型批次任務提供專注介面（有別於統整全部歷史紀錄的 Tracker Board）。

### 2. Header (進度摘要)

- 總進度文字：例如 `Task Progress: 45 / 100`。
- 視覺化進度條 ProgressBar。
- 一鍵重試按鈕 `[Retry All Failed]`，為批量任務的穩定性提供最終保證。

### 3. URL List (任務清單)

- 採用「平面清單 (Flat List)」的形式展開。
- 使用虛擬列表 (Virtualization) 技術避免渲染千筆以上 URL 造成卡頓。
- 單個列表 Item 展示重點：
  - URL (網址過長以 ellipsis 處理)。
  - 狀態顯示 (如 Loading 的轉圈或跑馬燈、Success 綠勾勾、Failed 紅叉叉)。
  - 對應狀態的 Text Badge 標籤。
  - 單點的 `[Retry]` 專門重試按鈕 (僅 Failed 時顯示)。
