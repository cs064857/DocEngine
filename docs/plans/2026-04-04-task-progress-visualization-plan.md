# Task Progress Visualization Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** 實作一個滑出式的抽屜面板 (Drawer)，以平舖清單即時監控爬蟲/抓取任務，並支援單筆或全部失敗重試。

**Architecture:**

- 前端新增 `TaskProgressDrawer` 組件作為容器，負責獲取資料與維護統整狀態。
- 內部列表項目使用 `TaskProgressItem` 繪製個別 URL 的圖示、狀態與 Retry 按鈕。
- 在 `app/page.tsx` 中將此 Drawer 加入主結構，並與現存表單整合。

**Tech Stack:** React, Next.js, Tailwind CSS, Lucide Icons

---

### Task 1: 建立 UI 基礎元件 (TaskProgressItem)

**Files:**

- Create: `components/TaskProgressItem.tsx`

**Step 1: Write component definition**
建立負責顯示單個 URL 與其狀態的小元件。

```tsx
import { CheckCircle2, XCircle, Loader2, RotateCw } from "lucide-react";

export function TaskProgressItem({ url, status, onRetry }) {
  return (
    <div className="flex items-center justify-between p-2 border-b">
      <span className="truncate w-1/2">{url}</span>
      <div className="flex items-center gap-2">
        {status === 'loading' && <Loader2 className="animate-spin text-blue-500 w-4 h-4" />}
        {status === 'success' && <CheckCircle2 className="text-green-500 w-4 h-4" />}
        {status === 'failed' && <XCircle className="text-red-500 w-4 h-4" />}
        <span className="text-sm uppercase">{status}</span>
        {status === 'failed' && (
          <button onClick={() => onRetry(url)} className="p-1 hover:bg-gray-100 rounded">
            <RotateCw className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add components/TaskProgressItem.tsx
git commit -m "feat: add TaskProgressItem component"
```

---

### Task 2: 建立抽屜容器與狀態邏輯 (TaskProgressDrawer)

**Files:**

- Create: `components/TaskProgressDrawer.tsx`

**Step 1: Write Drawer Layout & Fake Data Integration**
先刻畫 Drawer 的外殼與 Header（包含 Retry All Failed）。未來再替換為真實 API。

```tsx
'use client';
import { useState } from 'react';
import { TaskProgressItem } from './TaskProgressItem';

export function TaskProgressDrawer({ isOpen, onClose, taskId }) {
  const [items, setItems] = useState([]); // Will hold urls & statuses
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[400px] bg-white shadow-xl flex flex-col z-50">
      <div className="p-4 border-b flex justify-between items-center bg-gray-50">
        <h2 className="font-bold">Task Progress</h2>
        <button onClick={onClose} className="text-gray-500">Close</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.map(item => (
          <TaskProgressItem 
            key={item.url} 
            url={item.url} 
            status={item.status} 
            onRetry={(url) => console.log('retry', url)} 
          />
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add components/TaskProgressDrawer.tsx
git commit -m "feat: add basic TaskProgressDrawer container"
```

---

### Task 3: 實現即時輪詢 (Polling) 與重試邏輯

**Files:**

- Modify: `components/TaskProgressDrawer.tsx`

**Step 1: Add Polling & Retry Functions**
加入 `useEffect` 進行 API 輪詢，以及實際呼叫 Retry API。

```tsx
// Insert useEffect to fetch active task progress using taskId
// Implement onRetrySingle(url) to push the url back to queue
// Implement onRetryAll() to iterate over failed urls
```

**Step 2: Commit**

```bash
git add components/TaskProgressDrawer.tsx
git commit -m "feat: integrate polling and retry logic for Drawer"
```

---

### Task 4: 整合 Drawer 到主頁面

**Files:**

- Modify: `app/page.tsx`

**Step 1: Inject Drawer into UI**
在首頁引入 `TaskProgressDrawer`，並在啟動 Scrape/Crawl 按鈕的 `onSubmit` 時，設定打開 Drawer 並且傳入新的 `taskId`。

**Step 2: Commit**

```bash
git add app/page.tsx
git commit -m "feat: hook TaskProgressDrawer into main page"
```
