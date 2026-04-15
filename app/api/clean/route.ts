import { NextResponse } from 'next/server';
import { getObject, putObject } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import { cleanContent } from '@/lib/processors/cleaner';
import { buildR2Key } from '@/lib/utils/helpers';

export const maxDuration = 300; // Pro 計劃可支援 300 秒，避免 LLM 代理過慢導致 timeout

// 將前端欄位名稱 (r2AccountId) 映射為 R2 SDK 欄位名稱 (accountId)
function extractR2(raw?: Record<string, string>): R2Overrides | undefined {
    if (!raw?.r2AccountId && !raw?.r2AccessKeyId && !raw?.r2SecretAccessKey && !raw?.r2BucketName) return undefined;
    return {
        accountId: raw.r2AccountId,
        accessKeyId: raw.r2AccessKeyId,
        secretAccessKey: raw.r2SecretAccessKey,
        bucketName: raw.r2BucketName,
    };
}

export async function POST(req: Request) {
    try {
        const data = await req.json();
        const { url, date, engineSettings, r2Overrides: rawR2 } = data;
        const r2 = extractR2(rawR2);

        if (!url || !date) {
            return NextResponse.json({ error: 'Missing url or date' }, { status: 400 });
        }

        // 1. 從 R2 取得生肉 (raw)
        const rawKey = buildR2Key(url, 'raw', date);
        let rawContent = '';
        try {
            rawContent = await getObject(rawKey, r2);
        } catch (e: any) {
            console.error(`Clean API: Failed to get raw content for ${rawKey}`, e);
            return NextResponse.json({ error: e.message || 'Raw file is missing or empty' }, { status: 404 });
        }

        if (!rawContent || rawContent.trim() === '') {
            return NextResponse.json({ error: 'Raw file is 0 Bytes / empty' }, { status: 404 });
        }

        const { llmApiKey, llmModelName, llmBaseUrl, cleaningPrompt } = engineSettings || {};

        // 2. 呼叫 LLM 清洗（cleanContent 現在會拋出帶有完整 HTTP 錯誤的 Error）
        let cleanedContent: string;
        try {
            cleanedContent = await cleanContent(rawContent, {
                apiKey: llmApiKey,
                model: llmModelName,
                baseUrl: llmBaseUrl,
                prompt: cleaningPrompt,
            });
        } catch (cleanError: any) {
            const msg = cleanError?.message || 'LLM cleaning failed';
            console.error('Clean API: LLM cleaning error:', msg);
            return NextResponse.json({ error: `LLM cleaning failed: ${msg}` }, { status: 502 });
        }

        // 3. 儲存至 R2 (cleaned)
        const cleanedKey = buildR2Key(url, 'cleaned', date);
        await putObject(cleanedKey, cleanedContent, 'text/markdown', r2);

        return NextResponse.json({
            success: true,
            size: cleanedContent.length,
        });
    } catch (error: any) {
        console.error('Clean API Error:', error);
        return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
    }
}

