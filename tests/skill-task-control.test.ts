import test from 'node:test';
import assert from 'node:assert/strict';

import {
  abortSkillTaskInProcess,
  extractSkillTaskR2Overrides,
  isAbortError,
  registerSkillTaskAbortController,
  SkillTaskAbortedError,
  unregisterSkillTaskAbortController,
} from '../lib/services/skill-task-control';

test('abortSkillTaskInProcess aborts a registered controller', () => {
  const controller = new AbortController();

  registerSkillTaskAbortController('task-abortable', controller);

  assert.equal(abortSkillTaskInProcess('task-abortable'), true);
  assert.equal(controller.signal.aborted, true);

  unregisterSkillTaskAbortController('task-abortable');
});

test('abortSkillTaskInProcess returns false when task is unknown', () => {
  assert.equal(abortSkillTaskInProcess('missing-task'), false);
});

test('isAbortError recognizes abort-style errors', () => {
  const abortError = new Error('aborted');
  abortError.name = 'AbortError';

  assert.equal(isAbortError(new SkillTaskAbortedError()), true);
  assert.equal(isAbortError(abortError), true);
  assert.equal(isAbortError(new Error('other error')), false);
});

test('extractSkillTaskR2Overrides returns undefined when overrides are absent', () => {
  assert.equal(extractSkillTaskR2Overrides({}), undefined);
});

test('extractSkillTaskR2Overrides only accepts string fields', () => {
  const overrides = extractSkillTaskR2Overrides({
    r2AccountId: 'acc',
    r2AccessKeyId: 123,
    r2SecretAccessKey: null,
    r2BucketName: 'bucket',
  });

  assert.deepEqual(overrides, {
    accountId: 'acc',
    accessKeyId: undefined,
    secretAccessKey: undefined,
    bucketName: 'bucket',
  });
});
