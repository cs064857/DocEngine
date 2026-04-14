import { NextRequest, NextResponse } from 'next/server';
import { getObject } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import type { SkillTaskStatus } from '@/app/api/generate-skill/route';

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

    // 提取 R2 覆蓋配置
    const r2: R2Overrides | undefined =
      body.r2AccountId || body.r2AccessKeyId || body.r2SecretAccessKey || body.r2BucketName
        ? {
            accountId: body.r2AccountId,
            accessKeyId: body.r2AccessKeyId,
            secretAccessKey: body.r2SecretAccessKey,
            bucketName: body.r2BucketName,
          }
        : undefined;

    const raw = await getObject(`skill-tasks/${taskId}.json`, r2);
    const status: SkillTaskStatus = JSON.parse(raw);

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
