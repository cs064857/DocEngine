import { NextRequest, NextResponse } from 'next/server';

import { getObject, listObjects } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import type { SkillTaskStatus } from '@/app/api/generate-skill/route';

async function fetchSkillTasks(r2?: R2Overrides): Promise<SkillTaskStatus[]> {
  const objects = await listObjects('skill-tasks/', 1000, r2);

  const sortedObjects = objects.sort((a, b) => {
    const timeA = a.LastModified?.getTime() || 0;
    const timeB = b.LastModified?.getTime() || 0;
    return timeB - timeA;
  });

  const tasks = await Promise.all(
    sortedObjects.slice(0, 50).map(async (object) => {
      if (!object.Key) {
        return null;
      }

      try {
        const raw = await getObject(object.Key, r2);
        return JSON.parse(raw) as SkillTaskStatus;
      } catch (error) {
        console.error(`[Skill Tasks] Failed to read ${object.Key}:`, error);
        return null;
      }
    })
  );

  return tasks.filter(Boolean) as SkillTaskStatus[];
}

function extractR2Overrides(body: Record<string, string | undefined>): R2Overrides | undefined {
  if (!body.r2AccountId && !body.r2AccessKeyId && !body.r2SecretAccessKey && !body.r2BucketName) {
    return undefined;
  }

  return {
    accountId: body.r2AccountId,
    accessKeyId: body.r2AccessKeyId,
    secretAccessKey: body.r2SecretAccessKey,
    bucketName: body.r2BucketName,
  };
}

export async function GET() {
  try {
    const tasks = await fetchSkillTasks();
    return NextResponse.json({ tasks });
  } catch (error: unknown) {
    console.error('[Skill Tasks] Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tasks = await fetchSkillTasks(extractR2Overrides(body));
    return NextResponse.json({ tasks });
  } catch (error: unknown) {
    console.error('[Skill Tasks] Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
