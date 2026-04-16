# Scraping Processor Concurrency And Task Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `maxConcurrency` from the Scraping Processor flow into batch task execution and make the Task Progress drawer auto-open only once per task.

**Architecture:** Keep the existing batch crawl pipeline intact and thread `maxConcurrency` through existing `engineSettings` structures. Enforce runtime concurrency in `crawl-dispatch` for inline and mixed fallback paths, and isolate the drawer behavior behind a pure decision helper plus a small state guard in `app/page.tsx`.

**Tech Stack:** Next.js App Router, React 19, TypeScript, `node:test`, existing Vercel queue integration.

---

### Task 1: Add failing tests for concurrency and drawer behavior

**Files:**
- Modify: `tests/crawl-dispatch.test.ts`
- Create: `tests/task-progress-drawer.test.ts`
- Create: `lib/utils/task-progress-drawer.ts`

- [ ] **Step 1: Write the failing dispatch concurrency tests**

```ts
test('processCrawlJobsInline runs up to requested maxConcurrency workers', async () => {
  // import processCrawlJobsInline through public module export
  // use deferred promises to observe parallel starts
});

test('processCrawlJobsInline falls back to default concurrency when maxConcurrency is invalid', async () => {
  // pass engineSettings.maxConcurrency = 0 and verify default is used
});
```

- [ ] **Step 2: Run dispatch tests to verify they fail**

Run: `node --test tests/crawl-dispatch.test.ts`
Expected: FAIL because the public module does not yet expose the needed runtime behavior and inline processing is still serial.

- [ ] **Step 3: Write the failing drawer decision tests**

```ts
test('shouldAutoOpenTaskDrawer returns true for a new processing task that has not auto-opened yet', () => {
  assert.equal(
    shouldAutoOpenTaskDrawer({ taskId: 'task-1', autoOpenedTaskId: null, taskStatus: null }),
    true,
  )
})

test('shouldAutoOpenTaskDrawer returns false for the same task after auto-open already happened', () => {
  assert.equal(
    shouldAutoOpenTaskDrawer({ taskId: 'task-1', autoOpenedTaskId: 'task-1', taskStatus: { status: 'processing' } }),
    false,
  )
})

test('shouldAutoOpenTaskDrawer returns true again when taskId changes', () => {
  assert.equal(
    shouldAutoOpenTaskDrawer({ taskId: 'task-2', autoOpenedTaskId: 'task-1', taskStatus: { status: 'processing' } }),
    true,
  )
})
```

- [ ] **Step 4: Run drawer tests to verify they fail**

Run: `node --test tests/task-progress-drawer.test.ts`
Expected: FAIL because `lib/utils/task-progress-drawer.ts` does not exist yet.

- [ ] **Step 5: Commit**

```bash
git add tests/crawl-dispatch.test.ts tests/task-progress-drawer.test.ts lib/utils/task-progress-drawer.ts
git commit -m "test: cover crawl concurrency and drawer behavior"
```

### Task 2: Implement runtime concurrency and single auto-open behavior

**Files:**
- Modify: `lib/services/crawl-dispatch.ts`
- Modify: `lib/utils/task-metadata.ts`
- Modify: `app/page.tsx`
- Modify: `tests/crawl-dispatch.test.ts`
- Create: `lib/utils/task-progress-drawer.ts`
- Test: `tests/task-progress-drawer.test.ts`

- [ ] **Step 1: Implement the drawer decision helper**

```ts
export interface TaskDrawerAutoOpenState {
  taskId: string | null
  autoOpenedTaskId: string | null
  taskStatus: { status?: string | null } | null
}

export function shouldAutoOpenTaskDrawer(state: TaskDrawerAutoOpenState): boolean {
  if (!state.taskId) return false
  if (state.autoOpenedTaskId === state.taskId) return false
  return !state.taskStatus || state.taskStatus.status === 'processing'
}
```

- [ ] **Step 2: Implement the crawl concurrency normalization and worker pool**

```ts
function normalizeMaxConcurrency(value?: number): number {
  if (!Number.isFinite(value) || !value || value < 1) {
    return 2
  }
  return Math.floor(value)
}

export async function processCrawlJobsInline(jobs: CrawlJobPayload[]): Promise<void> {
  const concurrency = normalizeMaxConcurrency(jobs[0]?.engineSettings?.maxConcurrency)
  let index = 0

  async function worker() {
    while (index < jobs.length) {
      const current = jobs[index]
      index += 1
      // existing retry loop per job remains here
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()))
}
```

- [ ] **Step 3: Thread `maxConcurrency` through stored engine settings and page submit/retry paths**

```ts
// task-metadata.ts
maxConcurrency?: number

// page.tsx engineSettings payloads
maxConcurrency: Number.parseInt(maxConcurrency, 10) || undefined,
```

- [ ] **Step 4: Implement the page drawer state guard**

```ts
const [autoOpenedTaskId, setAutoOpenedTaskId] = useState<string | null>(null)

useEffect(() => {
  if (shouldAutoOpenTaskDrawer({ taskId, autoOpenedTaskId, taskStatus })) {
    setDrawerOpen(true)
    setAutoOpenedTaskId(taskId)
  }
}, [taskId, autoOpenedTaskId, taskStatus])
```

- [ ] **Step 5: Run targeted tests to verify green**

Run: `node --test tests/crawl-dispatch.test.ts tests/task-progress-drawer.test.ts tests/scrape-task.test.ts tests/task-metadata.test.ts`
Expected: PASS

- [ ] **Step 6: Run lint to verify project stays clean**

Run: `npm run lint`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add lib/services/crawl-dispatch.ts lib/utils/task-metadata.ts lib/utils/task-progress-drawer.ts app/page.tsx tests/crawl-dispatch.test.ts tests/task-progress-drawer.test.ts
git commit -m "feat: wire scraping concurrency and drawer auto-open"
```
