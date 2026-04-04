import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export interface R2Config {
    r2AccountId?: string;
    r2AccessKeyId?: string;
    r2SecretAccessKey?: string;
    r2BucketName?: string;
}

/**
 * 下載單一檔案
 */
export async function downloadSingleFile(key: string, r2Config?: R2Config, filename?: string) {
    try {
        const res = await fetch(`/api/files?key=${encodeURIComponent(key)}`, {
            method: r2Config && Object.keys(r2Config).length > 0 ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json' },
            body: r2Config && Object.keys(r2Config).length > 0 ? JSON.stringify(r2Config) : undefined
        });

        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.error || 'Failed to download file');
        }

        const blob = await res.blob();
        const name = filename || key.split('/').pop() || 'download.md';

        saveAs(blob, name);
    } catch (error) {
        console.error('Download single file error:', error);
        throw error;
    }
}

/**
 * 解析回報結構
 */
export interface DownloadZipResult {
    failedKeys: { key: string; reason: string }[];
}

/**
 * 批次下載資料夾，並壓縮為 ZIP。
 * 遇到空檔案(0B)或下載失敗時會記錄，並自動在 ZIP 加入 error log。
 */
export async function downloadFolderAsZip(
    prefix: string,
    zipName: string,
    r2Config?: R2Config,
    onProgress?: (percent: number) => void
): Promise<DownloadZipResult> {
    try {
        onProgress?.(0);

        const fetchOptions = {
            method: r2Config && Object.keys(r2Config).length > 0 ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json' },
            body: r2Config && Object.keys(r2Config).length > 0 ? JSON.stringify(r2Config) : undefined
        };

        const listRes = await fetch(`/api/files?prefix=${encodeURIComponent(prefix)}&limit=1000`, fetchOptions);
        if (!listRes.ok) throw new Error('Failed to list files');

        const { files } = await listRes.json() as { files: { key: string, size: number }[] };
        if (!files || files.length === 0) {
            throw new Error('No files found in this folder');
        }

        const zip = new JSZip();
        let completed = 0;
        const total = files.length;
        const CONCURRENCY = 5;

        const failedKeys: { key: string; reason: string }[] = [];

        // Filter out 0B files immediately
        const queue = files.filter(f => {
            if (f.size === 0) {
                failedKeys.push({ key: f.key, reason: 'File is empty (0 Bytes)' });
                completed++;
                return false;
            }
            return true;
        });

        const workers = Array(CONCURRENCY).fill(null).map(async () => {
            while (queue.length > 0) {
                const file = queue.shift();
                if (!file) break;

                try {
                    const res = await fetch(`/api/files?key=${encodeURIComponent(file.key)}`, fetchOptions);
                    if (res.ok) {
                        const content = await res.text();
                        const relativePath = file.key.replace(prefix, '').replace(/^\/+/, '');
                        zip.file(relativePath || file.key.split('/').pop() || 'unknown.md', content);
                    } else {
                        const errJson = await res.json().catch(() => ({}));
                        failedKeys.push({ key: file.key, reason: errJson.error || `HTTP ${res.status}` });
                    }
                } catch (e: any) {
                    failedKeys.push({ key: file.key, reason: e.message || 'Network error' });
                }

                completed++;
                onProgress?.(Math.round((completed / total) * 90));
            }
        });

        await Promise.all(workers);

        // Write error log if there were errors
        if (failedKeys.length > 0) {
            const errorLog = failedKeys.map(f => `[${f.key}]\nReason: ${f.reason}\n`).join('\n');
            zip.file('download_errors.txt', `CrawlDocs Download Warning Log\n\n${errorLog}`);
        }

        const content = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 5 }
        }, (metadata) => {
            onProgress?.(90 + (metadata.percent * 0.1));
        });

        saveAs(content, `${zipName}.zip`);
        onProgress?.(100);

        return { failedKeys };

    } catch (error) {
        console.error('Download generic ZIP error:', error);
        onProgress?.(0);
        throw error;
    }
}
