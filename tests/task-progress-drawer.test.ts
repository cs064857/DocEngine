import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldAutoOpenTaskDrawer } from '../lib/utils/task-progress-drawer';

test('shouldAutoOpenTaskDrawer returns true for a new task without taskStatus yet', () => {
  assert.equal(
    shouldAutoOpenTaskDrawer({
      taskId: 'task-1',
      autoOpenedTaskId: null,
      taskStatus: null,
    }),
    true
  );
});

test('shouldAutoOpenTaskDrawer returns false after the same task already auto-opened once', () => {
  assert.equal(
    shouldAutoOpenTaskDrawer({
      taskId: 'task-1',
      autoOpenedTaskId: 'task-1',
      taskStatus: { status: 'processing' },
    }),
    false
  );
});

test('shouldAutoOpenTaskDrawer returns true again when a different task starts', () => {
  assert.equal(
    shouldAutoOpenTaskDrawer({
      taskId: 'task-2',
      autoOpenedTaskId: 'task-1',
      taskStatus: { status: 'processing' },
    }),
    true
  );
});

test('shouldAutoOpenTaskDrawer returns false for completed tasks', () => {
  assert.equal(
    shouldAutoOpenTaskDrawer({
      taskId: 'task-3',
      autoOpenedTaskId: null,
      taskStatus: { status: 'completed' },
    }),
    false
  );
});
