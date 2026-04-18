import { NextRequest, NextResponse } from 'next/server';
import { getSkillTaskStatus, extractSkillTaskR2Overrides } from '@/lib/services/skill-task-control';

/**
 * POST /api/skill-status/[taskId]
 *
 * 查詢 Skill 生成任務的狀態。
 * 使用 POST 以便傳入 R2 覆蓋配置。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const body = await req.json().catch(() => ({}));

    const status = await getSkillTaskStatus(taskId, extractSkillTaskR2Overrides(body));

    return NextResponse.json(status);
  } catch (error: unknown) {
    const err = error as Error;

    // 任務不存在
    if (err?.name === 'NoSuchKey' || err?.message?.includes('NoSuchKey') || err?.message?.includes('not found')) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    console.error('[Skill Status] Error:', error);
    return NextResponse.json(
      { error: err?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
