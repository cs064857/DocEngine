import { NextRequest, NextResponse } from 'next/server';
import { getTaskStatus } from '@/lib/r2';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> } // Since Next.js 15, params must be awaited
) {
  try {
    const resolvedParams = await params;
    const { taskId } = resolvedParams;

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
