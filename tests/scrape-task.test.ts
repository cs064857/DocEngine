import test from 'node:test';
import assert from 'node:assert/strict';

import { runSingleScrapeTask } from '../lib/services/scrape-task';

test('runSingleScrapeTask creates processing and completed task records for successful scrape', async () => {
  const updates: Array<Record<string, unknown>> = [];

  const result = await runSingleScrapeTask(
    {
      url: 'https://docs.firecrawl.dev/api-reference',
      saveToR2: false,
      enableClean: false,
    },
    {
      generateTaskId: () => 'task-success',
      formatDate: () => '20260415',
      now: (() => {
        const values = ['2026-04-15T08:00:00.000Z', '2026-04-15T08:00:02.000Z'];
        return () => values.shift() || '2026-04-15T08:00:02.000Z';
      })(),
      scrapeUrlAdvanced: async () => ({
        markdown: '# Firecrawl Docs',
        metadata: { title: 'Docs' },
      }),
      cleanContent: async () => {
        throw new Error('cleanContent should not run when enableClean is false');
      },
      putObject: async () => {
        throw new Error('putObject should not run when saveToR2 is false');
      },
      putTaskStatus: async (_taskId, task) => {
        updates.push(task as unknown as Record<string, unknown>);
      },
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.taskId, 'task-success');
  assert.equal(updates.length, 2);

  assert.deepEqual(updates[0], {
    taskId: 'task-success',
    status: 'processing',
    total: 1,
    completed: 0,
    failed: 0,
    failedUrls: [],
    retryingUrls: [],
    urls: [{ url: 'https://docs.firecrawl.dev/api-reference', status: 'processing' }],
    date: '20260415',
    createdAt: '2026-04-15T08:00:00.000Z',
    updatedAt: '2026-04-15T08:00:00.000Z',
    domains: ['docs.firecrawl.dev'],
    domainSummary: 'docs.firecrawl.dev',
  });

  assert.deepEqual(updates[1], {
    taskId: 'task-success',
    status: 'completed',
    total: 1,
    completed: 1,
    failed: 0,
    failedUrls: [],
    retryingUrls: [],
    urls: [{ url: 'https://docs.firecrawl.dev/api-reference', status: 'success' }],
    date: '20260415',
    createdAt: '2026-04-15T08:00:00.000Z',
    updatedAt: '2026-04-15T08:00:02.000Z',
    domains: ['docs.firecrawl.dev'],
    domainSummary: 'docs.firecrawl.dev',
  });

  if (!result.success) {
    assert.fail('Expected successful scrape task result');
  }

  assert.equal(result.markdown, '# Firecrawl Docs');
  assert.equal(result.cleanedMarkdown, null);
  assert.deepEqual(result.metadata, { title: 'Docs' });
  assert.equal(result.charCount, 16);
  assert.equal(result.cleanedCharCount, null);
  assert.equal(result.r2, null);
  assert.deepEqual(result.task, updates[1]);
});

test('runSingleScrapeTask creates failed task record when scrape throws', async () => {
  const updates: Array<Record<string, unknown>> = [];

  const result = await runSingleScrapeTask(
    {
      url: 'https://docs.firecrawl.dev/broken',
      saveToR2: false,
      enableClean: false,
    },
    {
      generateTaskId: () => 'task-failed',
      formatDate: () => '20260415',
      now: (() => {
        const values = ['2026-04-15T09:00:00.000Z', '2026-04-15T09:00:03.000Z'];
        return () => values.shift() || '2026-04-15T09:00:03.000Z';
      })(),
      scrapeUrlAdvanced: async () => {
        throw new Error('Scrape failed: upstream timeout');
      },
      cleanContent: async () => '',
      putObject: async () => undefined,
      putTaskStatus: async (_taskId, task) => {
        updates.push(task as unknown as Record<string, unknown>);
      },
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.taskId, 'task-failed');
  assert.equal(updates.length, 2);

  assert.deepEqual(updates[0], {
    taskId: 'task-failed',
    status: 'processing',
    total: 1,
    completed: 0,
    failed: 0,
    failedUrls: [],
    retryingUrls: [],
    urls: [{ url: 'https://docs.firecrawl.dev/broken', status: 'processing' }],
    date: '20260415',
    createdAt: '2026-04-15T09:00:00.000Z',
    updatedAt: '2026-04-15T09:00:00.000Z',
    domains: ['docs.firecrawl.dev'],
    domainSummary: 'docs.firecrawl.dev',
  });

  assert.deepEqual(updates[1], {
    taskId: 'task-failed',
    status: 'failed',
    total: 1,
    completed: 0,
    failed: 1,
    failedUrls: [{ url: 'https://docs.firecrawl.dev/broken', error: 'Scrape failed: upstream timeout' }],
    retryingUrls: [],
    urls: [{ url: 'https://docs.firecrawl.dev/broken', status: 'failed', error: 'Scrape failed: upstream timeout' }],
    date: '20260415',
    createdAt: '2026-04-15T09:00:00.000Z',
    updatedAt: '2026-04-15T09:00:03.000Z',
    domains: ['docs.firecrawl.dev'],
    domainSummary: 'docs.firecrawl.dev',
  });

  if (result.success) {
    assert.fail('Expected failed scrape task result');
  }

  assert.equal(result.error, 'Scrape failed: upstream timeout');
  assert.deepEqual(result.task, updates[1]);
});
