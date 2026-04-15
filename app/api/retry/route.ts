import { NextRequest, NextResponse } from 'next/server';
import { send } from '@vercel/queue';
import { getTaskStatus, putTaskStatus } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import { mergeStoredTaskEngineSettingsForRetry } from '@/lib/utils/task-metadata';

/**
 * POST /api/retry
 * 重試指定任務中的失敗 URL（支援單筆或批次）
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { taskId, urls, retryAll, engineSettings } = body;

        if (!taskId || (!retryAll && (!urls || !Array.isArray(urls) || urls.length === 0))) {
            return NextResponse.json({ error: 'taskId and either retryAll or urls[] are required' }, { status: 400 });
        }

        // 提取 R2 覆蓋配置
        const r2Overrides: R2Overrides | undefined = (
            engineSettings?.r2AccountId || engineSettings?.r2AccessKeyId || engineSettings?.r2SecretAccessKey || engineSettings?.r2BucketName
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

        const retryUrls = retryAll
            ? (taskStatus.urls?.map((item) => item.url) || [])
            : urls;

        if (!retryUrls || retryUrls.length === 0) {
            return NextResponse.json({ error: 'Task has no tracked URLs to retry' }, { status: 400 });
        }

        const retryEngineSettings = retryAll
            ? mergeStoredTaskEngineSettingsForRetry(taskStatus.engineSettings, engineSettings)
            : { ...taskStatus.engineSettings, ...engineSettings };

        if (retryAll) {
            taskStatus.completed = 0;
            taskStatus.failed = 0;
            taskStatus.failedUrls = [];
            taskStatus.retryingUrls = [];
            if (taskStatus.urls) {
                taskStatus.urls = taskStatus.urls.map((entry) => ({
                    ...entry,
                    status: 'pending',
                    error: undefined,
                }));
            }
        } else {
            // 更新 R2 中的狀態：將要重試的 URL 標記為 pending，並從 failedUrls 移除
            for (const retryUrl of retryUrls) {
                const removedFailures = taskStatus.failedUrls.filter((f) => f.url === retryUrl).length;
                taskStatus.failedUrls = taskStatus.failedUrls.filter((f) => f.url !== retryUrl);
                if (removedFailures > 0) {
                    taskStatus.failed = Math.max(0, taskStatus.failed - removedFailures);
                }

                if (taskStatus.urls) {
                    const entry = taskStatus.urls.find((u) => u.url === retryUrl);
                    if (entry) {
                        entry.status = 'pending';
                        entry.error = undefined;
                    }
                }
            }

            if (taskStatus.retryingUrls) {
                taskStatus.retryingUrls = taskStatus.retryingUrls.filter((item) => !retryUrls.includes(item.url));
            }
        }

        // 如果整體任務已經完成/失敗，重設為 processing
        if (taskStatus.status !== 'processing') {
            taskStatus.status = 'processing';
        }

        taskStatus.updatedAt = new Date().toISOString();

        await putTaskStatus(taskId, taskStatus, r2Overrides);

        // 將 URL 重新送入 Queue
        const queuePromises = retryUrls.map((url: string) =>
            send('crawl-urls', {
                taskId,
                url,
                date: taskStatus.date,
                engineSettings: retryEngineSettings,
            })
        );
        await Promise.all(queuePromises);

        console.log(`[API Retry] Re-queued ${retryUrls.length} URLs for task ${taskId}`);

        return NextResponse.json({
            message: `${retryUrls.length} URL(s) re-queued for retry`,
            retried: retryUrls,
        });
    } catch (error: unknown) {
        console.error('[API Retry] Error:', error);
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: 'Failed to retry', details: msg }, { status: 500 });
    }
}
