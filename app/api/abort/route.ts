import { NextRequest, NextResponse } from 'next/server';
import { getTaskStatus, putTaskStatus } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';

/**
 * POST /api/abort
 * 中斷指定任務中卡住的 URL（支援單筆或批次）
 * 將目標 URL 標記為 failed + 'User aborted' 錯誤訊息
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { taskId, urls, engineSettings } = body;

        if (!taskId || !urls || !Array.isArray(urls) || urls.length === 0) {
            return NextResponse.json({ error: 'taskId and urls[] are required' }, { status: 400 });
        }

        // 提取 R2 覆蓋配置
        const r2Overrides: R2Overrides | undefined = (
            engineSettings?.r2AccountId || engineSettings?.r2AccessKeyId || engineSettings?.r2SecretAccessKey
        ) ? {
            accountId: engineSettings?.r2AccountId,
            accessKeyId: engineSettings?.r2AccessKeyId,
            secretAccessKey: engineSettings?.r2SecretAccessKey,
            bucketName: engineSettings?.r2BucketName,
        } : undefined;

        // 取得目前的任務狀態
        const taskStatus = await getTaskStatus(taskId, r2Overrides);
        if (!taskStatus) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        let abortedCount = 0;

        // 將要中斷的 URL 標記為 failed
        for (const abortUrl of urls) {
            // 更新 urls 追蹤陣列
            if (taskStatus.urls) {
                const entry = taskStatus.urls.find(u => u.url === abortUrl);
                if (entry && (entry.status === 'pending' || entry.status === 'processing')) {
                    entry.status = 'failed';
                    entry.error = 'User aborted';
                    taskStatus.failed += 1;
                    taskStatus.failedUrls.push({ url: abortUrl, error: 'User aborted' });
                    abortedCount++;
                }
            }
        }

        // 檢查是否所有 URL 都已完成
        if ((taskStatus.completed + taskStatus.failed) >= taskStatus.total) {
            taskStatus.status = 'completed';
            console.log(`[API Abort] Task ${taskId} has completed all URLs after abort`);
        }

        await putTaskStatus(taskId, taskStatus, r2Overrides);

        console.log(`[API Abort] Aborted ${abortedCount} URLs for task ${taskId}`);

        return NextResponse.json({
            message: `${abortedCount} URL(s) aborted`,
            aborted: urls,
        });
    } catch (error: unknown) {
        console.error('[API Abort] Error:', error);
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: 'Failed to abort', details: msg }, { status: 500 });
    }
}
