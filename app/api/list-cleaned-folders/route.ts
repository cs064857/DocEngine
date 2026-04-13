import { NextRequest, NextResponse } from 'next/server';
import { listObjects } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';

/**
 * 解析 cleaned/ 下的資料夾結構
 * 目錄格式：cleaned/{date}/{domain}/{path}.md
 * 
 * 返回唯一的 { date, domain } 組合
 */
function parseFolders(keys: string[]): { date: string; domain: string; prefix: string; fileCount: number }[] {
  const folderMap = new Map<string, { date: string; domain: string; prefix: string; count: number }>();

  for (const key of keys) {
    // cleaned/20260414/docs.example.com/some/path.md
    const parts = key.split('/');
    if (parts.length < 4 || parts[0] !== 'cleaned') continue;

    const date = parts[1];
    const domain = parts[2];
    const folderKey = `${date}/${domain}`;

    if (!folderMap.has(folderKey)) {
      folderMap.set(folderKey, {
        date,
        domain,
        prefix: `cleaned/${date}/${domain}/`,
        count: 0,
      });
    }
    folderMap.get(folderKey)!.count += 1;
  }

  return Array.from(folderMap.values())
    .map((v) => ({ date: v.date, domain: v.domain, prefix: v.prefix, fileCount: v.count }))
    .sort((a, b) => b.date.localeCompare(a.date)); // 最新日期在前
}

/**
 * POST /api/list-cleaned-folders
 *
 * 列出 R2 中所有 cleaned/{date}/{domain}/ 的唯一組合。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // 提取 R2 覆蓋配置
    const r2: R2Overrides | undefined =
      body.r2AccountId || body.r2AccessKeyId || body.r2SecretAccessKey
        ? {
            accountId: body.r2AccountId,
            accessKeyId: body.r2AccessKeyId,
            secretAccessKey: body.r2SecretAccessKey,
            bucketName: body.r2BucketName,
          }
        : undefined;

    // 列出 cleaned/ 下所有物件
    const objects = await listObjects('cleaned/', 1000, r2);
    const keys = objects.map((obj) => obj.Key!).filter(Boolean);

    const folders = parseFolders(keys);

    return NextResponse.json({ folders });
  } catch (error: unknown) {
    console.error('[List Cleaned Folders] Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
