import { NextResponse } from 'next/server';
import { getObject, putObject } from '@/lib/r2';
import { cleanContent } from '@/lib/processors/cleaner';
import { buildR2Key } from '@/lib/utils/helpers';

export const maxDuration = 60; // 允許較長執行時間以處理大型 LLM 請求

export async function POST(req: Request) {
    try {
        const data = await req.json();
        const { url, date, engineSettings, r2Overrides } = data;

        if (!url || !date) {
            return NextResponse.json({ error: 'Missing url or date' }, { status: 400 });
        }

        // 1. 從 R2 取得生肉 (raw)
        const rawKey = buildR2Key(url, 'raw', date);
        let rawContent = '';
        try {
            rawContent = await getObject(rawKey, r2Overrides);
        } catch (e: any) {
            console.error(`Clean API: Failed to get raw content for ${rawKey}`, e);
            return NextResponse.json({ error: e.message || 'Raw file is missing or empty' }, { status: 404 });
        }

        if (!rawContent || rawContent.trim() === '') {
            return NextResponse.json({ error: 'Raw file is 0 Bytes / empty' }, { status: 404 });
        }

        const { llmApiKey, llmModelName, llmBaseUrl, cleaningPrompt } = engineSettings || {};

        // 2. 呼叫 LLM 清洗（cleanContent 簽名為 (rawMarkdown, overrides?: CleanerOverrides)）
        const cleanedContent = await cleanContent(rawContent, {
            apiKey: llmApiKey,
            model: llmModelName,
            baseUrl: llmBaseUrl,
            prompt: cleaningPrompt,
        });

        if (!cleanedContent || cleanedContent.trim() === '') {
            return NextResponse.json({ error: 'LLM returned empty completion' }, { status: 500 });
        }

        // 3. 儲存至 R2 (cleaned)
        const cleanedKey = buildR2Key(url, 'cleaned', date);
        await putObject(cleanedKey, cleanedContent, 'text/markdown', r2Overrides);

        return NextResponse.json({
            success: true,
            size: cleanedContent.length,
        });
    } catch (error: any) {
        console.error('Clean API Error:', error);
        return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
    }
}
