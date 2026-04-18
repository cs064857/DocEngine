import { NextRequest, NextResponse } from 'next/server';

import {
  abortSkillTaskInProcess,
  extractSkillTaskR2Overrides,
  getSkillTaskStatus,
  updateSkillTaskStatus,
} from '@/lib/services/skill-task-control';
import { isSkillTaskTerminalStatus, SKILL_TASK_ABORT_MESSAGE } from '@/lib/utils/skill-task-status';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const taskId = typeof body.taskId === 'string' ? body.taskId : '';

    if (!taskId) {
      return NextResponse.json({ error: 'Missing required field: taskId' }, { status: 400 });
    }

    const r2 = extractSkillTaskR2Overrides(body);
    const current = await getSkillTaskStatus(taskId, r2);

    if (isSkillTaskTerminalStatus(current.status)) {
      return NextResponse.json(current);
    }

    abortSkillTaskInProcess(taskId);
    const updated = await updateSkillTaskStatus(taskId, {
      status: 'aborted',
      error: SKILL_TASK_ABORT_MESSAGE,
    }, r2);

    return NextResponse.json(updated);
  } catch (error: unknown) {
    const err = error as Error;

    if (err?.name === 'NoSuchKey' || err?.message?.includes('NoSuchKey') || err?.message?.includes('not found')) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    console.error('[Abort Skill] Error:', error);
    return NextResponse.json(
      { error: err?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
