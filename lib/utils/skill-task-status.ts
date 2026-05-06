export type SkillTaskRunStatus = 'processing' | 'completed' | 'failed' | 'aborted';

export type SkillTaskPhase = 'queued' | 'collecting' | 'summarize' | 'generate' | 'refine' | 'writing' | 'done';

export interface SkillTaskSourceFolder {
  date: string;
  domain: string;
}

export interface SkillTaskStatus {
  taskId: string;
  status: SkillTaskRunStatus;
  phase: SkillTaskPhase;
  date: string;
  domain: string;
  fileCount: number;
  skillPreview?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  outputPrefix?: string;
  provider?: string;
  modelId?: string;
  baseUrl?: string;
  customPrompt?: string;
  folders?: SkillTaskSourceFolder[];
}

export const SKILL_TASK_ABORT_MESSAGE = 'Generation stopped by user.';

export function isSkillTaskTerminalStatus(status: SkillTaskRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted';
}

export function isSkillTaskStoppable(status: SkillTaskRunStatus): boolean {
  return status === 'processing';
}
