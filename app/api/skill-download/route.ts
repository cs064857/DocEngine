import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { listObjects, getObject } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';

/**
 * POST /api/skill-download
 *
 * 將 R2 中 skills/{date}/{domain}/ 下的所有檔案
 * 打包為 ZIP 並返回。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { date, domain } = body;

    if (!date || !domain) {
      return NextResponse.json(
        { error: 'Missing required fields: date, domain' },
        { status: 400 }
      );
    }

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

    const prefix = `skills/${date}/${domain}/`;
    const objects = await listObjects(prefix, 500, r2);

    if (!objects || objects.length === 0) {
      return NextResponse.json(
        { error: `No skill files found at: ${prefix}` },
        { status: 404 }
      );
    }

    // 建立 ZIP
    const zip = new JSZip();
    const skillFolder = zip.folder(`${domain}-skill`) || zip;

    // 並行讀取所有檔案
    const filePromises = objects.map(async (obj) => {
      if (!obj.Key) return;
      try {
        const content = await getObject(obj.Key, r2);

        // 相對路徑：移除 prefix 部分
        const relativePath = obj.Key.replace(prefix, '');
        skillFolder.file(relativePath, content);
      } catch (err) {
        console.warn(`[Skill Download] Failed to read ${obj.Key}:`, err);
      }
    });

    await Promise.all(filePromises);

    // 產生 ZIP Buffer
    const zipUint8 = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // 轉為 ArrayBuffer 以相容 NextResponse
    const zipBuffer = new ArrayBuffer(zipUint8.byteLength);
    new Uint8Array(zipBuffer).set(zipUint8);

    // 返回 ZIP 檔案
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${domain}-skill.zip"`,
        'Content-Length': String(zipUint8.byteLength),
      },
    });
  } catch (error: unknown) {
    console.error('[Skill Download] Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
