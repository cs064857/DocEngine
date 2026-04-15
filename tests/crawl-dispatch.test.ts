import test from 'node:test';
import assert from 'node:assert/strict';

import { dispatchCrawlJobs } from '../lib/services/crawl-dispatch';

const jobs = [
  {
    taskId: 'task-1',
    url: 'https://example.com/a',
    date: '20260415',
    engineSettings: {},
  },
  {
    taskId: 'task-1',
    url: 'https://example.com/b',
    date: '20260415',
    engineSettings: {},
  },
];

test('dispatchCrawlJobs bypasses queue when current runtime cannot support background delivery', async () => {
  const sent: string[] = [];
  const processedInline: string[] = [];

  const mode = await dispatchCrawlJobs(jobs, {
    canUseBackgroundQueue: () => false,
    sendToQueue: async (_topic, job) => {
      sent.push(job.url);
    },
    processJobsInline: async (pendingJobs) => {
      processedInline.push(...pendingJobs.map((job) => job.url));
    },
  });

  assert.equal(mode, 'inline');
  assert.deepEqual(sent, []);
  assert.deepEqual(processedInline, ['https://example.com/a', 'https://example.com/b']);
});

test('dispatchCrawlJobs falls back to inline processing when queue auth is unavailable', async () => {
  const sent: string[] = [];
  const processedInline: string[] = [];

  const mode = await dispatchCrawlJobs(jobs, {
    canUseBackgroundQueue: () => true,
    sendToQueue: async (_topic, job) => {
      sent.push(job.url);
      throw new Error('Failed to get OIDC token. This usually means the function is running outside of a Vercel Function environment.');
    },
    processJobsInline: async (pendingJobs) => {
      processedInline.push(...pendingJobs.map((job) => job.url));
    },
  });

  assert.equal(mode, 'inline');
  assert.deepEqual(sent, ['https://example.com/a']);
  assert.deepEqual(processedInline, ['https://example.com/a', 'https://example.com/b']);
});

test('dispatchCrawlJobs only falls back for jobs that were not already queued', async () => {
  const sent: string[] = [];
  const processedInline: string[] = [];

  const mode = await dispatchCrawlJobs(jobs, {
    canUseBackgroundQueue: () => true,
    sendToQueue: async (_topic, job) => {
      sent.push(job.url);
      if (job.url.endsWith('/b')) {
        throw new Error('Failed to get OIDC token. This usually means the function is running outside of a Vercel Function environment.');
      }
    },
    processJobsInline: async (pendingJobs) => {
      processedInline.push(...pendingJobs.map((job) => job.url));
    },
  });

  assert.equal(mode, 'mixed');
  assert.deepEqual(sent, ['https://example.com/a', 'https://example.com/b']);
  assert.deepEqual(processedInline, ['https://example.com/b']);
});
