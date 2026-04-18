import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSkillTaskStoppable,
  isSkillTaskTerminalStatus,
  SKILL_TASK_ABORT_MESSAGE,
} from '../lib/utils/skill-task-status';

test('isSkillTaskTerminalStatus treats aborted tasks as terminal', () => {
  assert.equal(isSkillTaskTerminalStatus('processing'), false);
  assert.equal(isSkillTaskTerminalStatus('completed'), true);
  assert.equal(isSkillTaskTerminalStatus('failed'), true);
  assert.equal(isSkillTaskTerminalStatus('aborted'), true);
});

test('isSkillTaskStoppable only allows processing tasks to be stopped', () => {
  assert.equal(isSkillTaskStoppable('processing'), true);
  assert.equal(isSkillTaskStoppable('completed'), false);
  assert.equal(isSkillTaskStoppable('failed'), false);
  assert.equal(isSkillTaskStoppable('aborted'), false);
});

test('skill abort message stays stable for UI and API', () => {
  assert.equal(SKILL_TASK_ABORT_MESSAGE, 'Generation stopped by user.');
});
