import { getObject, putObject } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import { SKILL_TASK_ABORT_MESSAGE, type SkillTaskStatus } from '@/lib/utils/skill-task-status';

const skillTaskAbortControllers = new Map<string, AbortController>();

export class SkillTaskAbortedError extends Error {
  constructor(message = SKILL_TASK_ABORT_MESSAGE) {
    super(message);
    this.name = 'SkillTaskAbortedError';
  }
}

export function extractSkillTaskR2Overrides(body: {
  r2AccountId?: unknown;
  r2AccessKeyId?: unknown;
  r2SecretAccessKey?: unknown;
  r2BucketName?: unknown;
}): R2Overrides | undefined {
  const accountId = typeof body.r2AccountId === 'string' ? body.r2AccountId : undefined;
  const accessKeyId = typeof body.r2AccessKeyId === 'string' ? body.r2AccessKeyId : undefined;
  const secretAccessKey = typeof body.r2SecretAccessKey === 'string' ? body.r2SecretAccessKey : undefined;
  const bucketName = typeof body.r2BucketName === 'string' ? body.r2BucketName : undefined;

  if (!accountId && !accessKeyId && !secretAccessKey && !bucketName) {
    return undefined;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
  };
}

export async function getSkillTaskStatus(taskId: string, r2?: R2Overrides): Promise<SkillTaskStatus> {
  const raw = await getObject(`skill-tasks/${taskId}.json`, r2);
  return JSON.parse(raw) as SkillTaskStatus;
}

export async function updateSkillTaskStatus(
  taskId: string,
  updates: Partial<SkillTaskStatus>,
  r2?: R2Overrides
): Promise<SkillTaskStatus> {
  const current = await getSkillTaskStatus(taskId, r2);
  const updated: SkillTaskStatus = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await putObject(
    `skill-tasks/${taskId}.json`,
    JSON.stringify(updated, null, 2),
    'application/json',
    r2
  );

  return updated;
}

export async function throwIfSkillTaskAborted(taskId: string, r2?: R2Overrides): Promise<void> {
  const status = await getSkillTaskStatus(taskId, r2);
  if (status.status === 'aborted') {
    throw new SkillTaskAbortedError();
  }
}

export function registerSkillTaskAbortController(taskId: string, controller: AbortController): void {
  skillTaskAbortControllers.set(taskId, controller);
}

export function unregisterSkillTaskAbortController(taskId: string): void {
  skillTaskAbortControllers.delete(taskId);
}

export function abortSkillTaskInProcess(taskId: string): boolean {
  const controller = skillTaskAbortControllers.get(taskId);
  if (!controller) {
    return false;
  }

  controller.abort();
  return true;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof SkillTaskAbortedError
    || (error instanceof Error && error.name === 'AbortError');
}
