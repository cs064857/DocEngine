export interface TaskDrawerAutoOpenState {
  taskId: string | null;
  autoOpenedTaskId: string | null;
  taskStatus: {
    status?: string | null;
  } | null;
}

export function shouldAutoOpenTaskDrawer(state: TaskDrawerAutoOpenState): boolean {
  if (!state.taskId) {
    return false;
  }

  if (state.autoOpenedTaskId === state.taskId) {
    return false;
  }

  return !state.taskStatus || state.taskStatus.status === 'processing';
}
