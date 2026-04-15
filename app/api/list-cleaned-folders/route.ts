import { NextRequest, NextResponse } from 'next/server';
import { listObjects } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';

interface R2Object {
  Key?: string;
  Size?: number;
}

/**
 * 解析 cleaned/ 下的資料夾結構
 * 目錄格式：cleaned/{date}/{domain}/{path}.md
 * 
 * 返回唯一的 { date, domain } 組合，包含 emptyFileCount（0B 檔案數量）
 */
function parseFolders(objects: R2Object[]): { date: string; domain: string; prefix: string; fileCount: number; emptyFileCount: number }[] {
  const folderMap = new Map<string, { date: string; domain: string; prefix: string; count: number; emptyCount: number }>();

  for (const obj of objects) {
    const key = obj.Key;
    if (!key) continue;

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
        emptyCount: 0,
      });
    }
    const entry = folderMap.get(folderKey)!;
    entry.count += 1;

    // 檢查檔案大小是否為 0
    if (obj.Size !== undefined && obj.Size === 0) {
      entry.emptyCount += 1;
    }
  }

  return Array.from(folderMap.values())
    .map((v) => ({ date: v.date, domain: v.domain, prefix: v.prefix, fileCount: v.count, emptyFileCount: v.emptyCount }))
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
      body.r2AccountId || body.r2AccessKeyId || body.r2SecretAccessKey || body.r2BucketName
        ? {
            accountId: body.r2AccountId,
            accessKeyId: body.r2AccessKeyId,
            secretAccessKey: body.r2SecretAccessKey,
            bucketName: body.r2BucketName,
          }
        : undefined;

    // 列出 cleaned/ 下所有物件（完整 object 含 Size）
    const objects = await listObjects('cleaned/', 1000, r2);

    const folders = parseFolders(objects as R2Object[]);

    return NextResponse.json({ folders });
  } catch (error: unknown) {
    console.error('[List Cleaned Folders] Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
