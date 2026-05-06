import test from 'node:test';
import assert from 'node:assert/strict';

import { __clearLogBuffersForTests, flushAllLogs, logger, listLogFiles, readLogs } from '../lib/logger';
import type { LoggerR2Overrides } from '../lib/logger';

const objects = new Map<string, string>();
const r2 = {
  putObject: async (key: string, content: string | Buffer) => {
    objects.set(key, content.toString());
  },
  getObject: async (key: string) => {
    const content = objects.get(key);
    if (content === undefined) {
      const error = new Error('NoSuchKey');
      error.name = 'NoSuchKey';
      throw error;
    }
    return content;
  },
  listObjects: async (prefix?: string) => Array.from(objects.keys())
    .filter((key) => !prefix || key.startsWith(prefix))
    .map((Key) => ({ Key })),
} satisfies LoggerR2Overrides;

test('logger writes buffered task logs as JSONL and reads them back', async () => {
  __clearLogBuffersForTests();
  objects.clear();

  logger.info('started', { taskId: 'task-1', phase: 'start', meta: { domain: 'example.com' } });
  logger.error('failed', { taskId: 'task-1', meta: { error: 'boom' } });

  await flushAllLogs(r2);

  const files = await listLogFiles(r2);
  assert.equal(files.length, 1);
  assert.deepEqual(files[0].files, ['task-1.jsonl']);

  const entries = await readLogs({ date: files[0].date, taskId: 'task-1', r2 });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].level, 'info');
  assert.equal(entries[0].phase, 'start');
  assert.deepEqual(entries[0].meta, { domain: 'example.com' });
  assert.equal(entries[1].level, 'error');
});

test('readLogs returns an empty list for missing log files', async () => {
  __clearLogBuffersForTests();
  objects.clear();

  const entries = await readLogs({ date: '2026-05-06', taskId: 'missing', r2 });
  assert.deepEqual(entries, []);
});
