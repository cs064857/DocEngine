import { NextRequest, NextResponse } from 'next/server';
import { listObjects, getTaskStatus } from '@/lib/r2';
import type { R2Overrides, JobTask } from '@/lib/r2';
import { summarizeDomains } from '@/lib/utils/task-metadata';

function normalizeTask(task: JobTask): JobTask {
  if (task.domainSummary && task.domains?.length) {
    return task;
  }

  const trackedUrls = task.urls?.map((item) => item.url) || [];
  const fallbackUrls = trackedUrls.length > 0 ? trackedUrls : task.failedUrls.map((item) => item.url);
  const { domains, domainSummary } = summarizeDomains(fallbackUrls);

  return {
    ...task,
    domains,
    domainSummary,
  };
}

async function fetchTasks(r2Overrides?: R2Overrides) {
  // listObjects returns { Key, LastModified, Size, ... }[]
  const objects = await listObjects('tasks/', 1000, r2Overrides); 
  
  // Sort by LastModified descending
  const sortedObjects = objects.sort((a, b) => {
    const timeA = a.LastModified?.getTime() || 0;
    const timeB = b.LastModified?.getTime() || 0;
    return timeB - timeA;
  });

  // Take top 20
  const topObjects = sortedObjects.slice(0, 20);

  // Extract taskIds from keys (e.g. 'tasks/123.json' -> '123')
  const taskIds = topObjects
    .map(obj => obj.Key?.replace('tasks/', '').replace('.json', ''))
    .filter(Boolean) as string[];

  // Fetch full details
  const tasks = await Promise.all(
    taskIds.map(async (id) => {
      try {
        return await getTaskStatus(id, r2Overrides);
      } catch (e) {
        console.error(`Failed to fetch task ${id}`, e);
        return null;
      }
    })
  );

  return (tasks.filter(Boolean) as JobTask[]).map(normalizeTask);
}

export async function GET() {
  try {
    const tasks = await fetchTasks();
    return NextResponse.json({ tasks });
  } catch (error: unknown) {
    console.error(`[API Tasks] Error:`, error);
    const msg = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const r2Overrides: R2Overrides | undefined = (
      body.r2AccountId || body.r2AccessKeyId || body.r2SecretAccessKey || body.r2BucketName
    ) ? {
      accountId: body.r2AccountId,
      accessKeyId: body.r2AccessKeyId,
      secretAccessKey: body.r2SecretAccessKey,
      bucketName: body.r2BucketName,
    } : undefined;

    const tasks = await fetchTasks(r2Overrides);
    return NextResponse.json({ tasks });
  } catch (error: unknown) {
    console.error(`[API Tasks] Error:`, error);
    const msg = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
