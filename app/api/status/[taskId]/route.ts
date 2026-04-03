import { NextRequest, NextResponse } from 'next/server';
import { getTaskStatus } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';

/**
 * GET /api/status/[taskId]
 * 使用環境變數預設值查詢任務狀態（向後相容）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    if (!taskId) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    const taskStatus = await getTaskStatus(taskId);
    if (!taskStatus) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json(taskStatus);
  } catch (error: unknown) {
    console.error(`[API Status] Error finding task:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/status/[taskId]
 * 支援前端傳入 R2 覆蓋認證來查詢任務狀態
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    if (!taskId) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    const body = await request.json();

    // 提取 R2 覆蓋配置
    const r2Overrides: R2Overrides | undefined = (
      body.r2AccountId || body.r2AccessKeyId || body.r2SecretAccessKey
    ) ? {
      accountId: body.r2AccountId,
      accessKeyId: body.r2AccessKeyId,
      secretAccessKey: body.r2SecretAccessKey,
      bucketName: body.r2BucketName,
    } : undefined;

    const taskStatus = await getTaskStatus(taskId, r2Overrides);
    if (!taskStatus) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json(taskStatus);
  } catch (error: unknown) {
    console.error(`[API Status] Error finding task:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
