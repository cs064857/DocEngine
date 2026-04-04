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
        if (!res.ok) throw new Error('Failed to download file');

        const blob = await res.blob();
        // 取出檔名 (若無傳入則嘗試從 key 萃取最後一段)
        const name = filename || key.split('/').pop() || 'download.md';

        saveAs(blob, name);
    } catch (error) {
        console.error('Download single file error:', error);
        throw error;
    }
}

/**
 * 批次下載資料夾，並壓縮為 ZIP
 * @param prefix 資料夾路徑
 * @param zipName 輸出的 ZIP 檔名
 * @param r2Config R2 Credential Overrides 
 * @param onProgress 進度回報 (百分比 0~100)
 */
export async function downloadFolderAsZip(
    prefix: string,
    zipName: string,
    r2Config?: R2Config,
    onProgress?: (percent: number) => void
) {
    try {
        onProgress?.(0);

        const fetchOptions = {
            method: r2Config && Object.keys(r2Config).length > 0 ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json' },
            body: r2Config && Object.keys(r2Config).length > 0 ? JSON.stringify(r2Config) : undefined
        };

        // 1. 取得檔案列表
        // 假設最多先拉取 1000 筆，為了安全性後端 limit 可能需要開大，或者透過分頁
        const listRes = await fetch(`/api/files?prefix=${encodeURIComponent(prefix)}&limit=1000`, fetchOptions);
        if (!listRes.ok) throw new Error('Failed to list files');

        const { files } = await listRes.json();
        if (!files || files.length === 0) {
            throw new Error('No files found in this folder');
        }

        const zip = new JSZip();
        let completed = 0;
        const total = files.length;

        // 2. 設定併發數量，避免把瀏覽器或 Vercel Serverless Function 塞爆
        const CONCURRENCY = 5;

        // 建立 Queue 用於控制併發
        const queue = [...files];
        const workers = Array(CONCURRENCY).fill(null).map(async () => {
            while (queue.length > 0) {
                const file = queue.shift();
                if (!file) break;

                const res = await fetch(`/api/files?key=${encodeURIComponent(file.key)}`, fetchOptions);
                if (res.ok) {
                    const content = await res.text();
                    // 計算相對路徑以便放入 Zip。若想讓前綴資料夾保留，可以自己做字串操作。
                    // 這裡直接保留完整的 key 結構，或去掉最前面的 root prefix。
                    // 例如 prefix='raw/20260404/example.com/'，key='raw/20260404/example.com/foo.md'
                    // 則 zip 裡為 'foo.md'
                    const relativePath = file.key.replace(prefix, '').replace(/^\/+/, '');
                    zip.file(relativePath || file.key.split('/').pop() || 'unknown.md', content);
                } else {
                    console.warn(`Failed to fetch ${file.key}`);
                }

                completed++;
                // 更新進度
                onProgress?.(Math.round((completed / total) * 90)); // 擷取預留 10% 給打包 ZIP
            }
        });

        await Promise.all(workers);

        // 3. 產生 ZIP 並下載
        const content = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: {
                level: 5 // 平衡壓縮率跟速度
            }
        }, (metadata) => {
            // metadata.percent is 0-100 for generation
            // Map it to the remaining 10% progress (90 to 100)
            onProgress?.(90 + (metadata.percent * 0.1));
        });

        saveAs(content, `${zipName}.zip`);
        onProgress?.(100);

    } catch (error) {
        console.error('Download generic ZIP error:', error);
        onProgress?.(0); // 重設進度
        throw error;
    }
}
