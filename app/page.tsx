"use client";

import React, { useState, useEffect } from 'react';

// Defines the shape of standard Crawl Task metrics
interface JobTask {
  taskId: string;
  status: 'processing' | 'completed' | 'failed';
  total: number;
  completed: number;
  failed: number;
  failedUrls: { url: string; error: string }[];
  retryingUrls?: { url: string; attempts: number; maxRetries: number; error: string }[];
  date: string;
}

// 預設清理提示詞（與 CLEANING_PROMPT.md 同步）
const DEFAULT_CLEANING_PROMPT = `你是一個專業的文件處理助手，專門負責清理和結構化爬取下來的 Markdown 文件。你的目標是將粗糙的網頁內容轉化為高質量的、適合存放於 RAG (Retrieval-Augmented Generation) 知識庫的格式。

請按照以下指南處理輸入的 Markdown 文字：

# 核心目標
1. 保持資訊完整性：不要遺漏任何有價值的內容。
2. 提升可讀性：修復排版錯誤，確保結構清晰。
3. 移除雜訊：刪除無用的網頁元素（導覽列、頁腳、廣告、版權聲明等）。
4. 標準化格式：統一使用標準的 Markdown 語法。

# 具體處理步驟

## 1. 結構化重組
*   為文件添加一個適當的主標題 (H1, \`# \`)，如果原文沒有或不明確。
*   檢查標題層級 (H2, H3, 等等)，確保它們的邏輯順序正確，避免跳躍（例如 H1 直接跳到 H3）。
*   將相關的段落分組到適當的副標題下。

## 2. 內容清理與降噪
*   移除所有導覽列連結、選單、側邊欄項目。
*   移除頁腳內容 (如「版權所有」、「隱私政策」、「聯絡我們」等非核心內容)。
*   移除廣告占位符或明顯的推廣內容。
*   移除多餘的空行、連續的空格或無意義的符號 (如大量的 \`*\` 或 \`-\` 連續出現)。
*   處理殘留的 HTML 標籤，將其轉換為 Markdown 或直接移除。

## 3. 內文格式化
*   **列表**：將混亂的條列式內容整理為清晰的無序列表 (\`-\`) 或有序列表 (\`1.\`)。
*   **程式碼與指令**：將所有的指令、程式碼片段或配置檔內容放入合適的 Markdown 程式碼區塊中 (\`\`\`語言 ... \`\`\`)。
*   **強調**：合理使用**粗體**來標示關鍵名詞或重點，使用\`行內程式碼\`來標示變數、檔案路徑或介面文字。
*   **表格**：如果遇到表格數據，嘗試將其轉換為 Markdown 表格格式。

## 4. 針對 RAG 優化的特殊處理
*   **段落長度**：如果一個段落過長（超過 5 句），嘗試將其拆分為較小的段落，以利於未來的向量切塊 (Chunking)。
*   **指代消解**：如果第一段出現「這個系統」、「本產品」等代名詞，盡量用具體的名稱替換，增加獨立段落的資訊量。

# 輸出要求
*   **只輸出清理後的 Markdown 內容**，不要包含任何如「以下是清理後的內容」、「好的，我已經處理完成」等前言或結語。
*   不要改變原文的語氣與專業名詞。`;

// 預設 URL 提取提示詞（與 URL_EXTRACTOR_PROMPT.md 同步）
const DEFAULT_URL_EXTRACTOR_PROMPT = `You are a helpful assistant that extracts URLs from text.
Output ONLY a valid JSON object containing a "urls" key mapped to an array of strings.
If no valid URLs are found, output {"urls": []}. Do not output any markdown formatting, only pure JSON.`;

export default function CrawlDocsFrontend() {
  const [activeTab, setActiveTab] = useState<'tasks' | 'create' | 'storage' | 'settings'>('create');
  const [sourceType, setSourceType] = useState<'scrape' | 'crawl' | 'map'>('scrape');
  const [inputValue, setInputValue] = useState('');

  // Advanced parameters
  const [depthLimit, setDepthLimit] = useState('0');
  const [maxConcurrency, setMaxConcurrency] = useState('2');
  const [maxUrls, setMaxUrls] = useState('1000');
  const [maxRetries, setMaxRetries] = useState('3');
  const [enableClean, setEnableClean] = useState(true);

  // Content Cleaner 配置
  const [firecrawlKey, setFirecrawlKey] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModelName, setLlmModelName] = useState('glm-4-flash');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [cleaningPrompt, setCleaningPrompt] = useState(DEFAULT_CLEANING_PROMPT);
  const [showCleaningPrompt, setShowCleaningPrompt] = useState(false);

  // URL Extractor 配置
  const [urlExtractorApiKey, setUrlExtractorApiKey] = useState('');
  const [urlExtractorBaseUrl, setUrlExtractorBaseUrl] = useState('');
  const [urlExtractorModel, setUrlExtractorModel] = useState('');
  const [urlExtractorPrompt, setUrlExtractorPrompt] = useState(DEFAULT_URL_EXTRACTOR_PROMPT);
  const [showUrlExtractorPrompt, setShowUrlExtractorPrompt] = useState(false);

  // Firecrawl Map 配置
  const [mapUrl, setMapUrl] = useState('');
  const [mapSearch, setMapSearch] = useState('');
  const [mapLimit, setMapLimit] = useState('5000');
  const [isMapping, setIsMapping] = useState(false);
  const [mapResultCount, setMapResultCount] = useState<number | null>(null);

  // Firecrawl Scrape 配置
  const [scrapeTargetUrl, setScrapeTargetUrl] = useState('');
  const [scrapeWaitFor, setScrapeWaitFor] = useState('');
  const [scrapeTimeout, setScrapeTimeout] = useState('');
  const [scrapeOnlyMainContent, setScrapeOnlyMainContent] = useState(true);
  const [scrapeMobile, setScrapeMobile] = useState(false);
  const [scrapeIncludeTags, setScrapeIncludeTags] = useState('');
  const [scrapeExcludeTags, setScrapeExcludeTags] = useState('');
  const [scrapeSaveToR2, setScrapeSaveToR2] = useState(true);
  const [scrapeEnableClean, setScrapeEnableClean] = useState(true);
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<{
    markdown: string;
    cleanedMarkdown?: string | null;
    metadata?: Record<string, unknown> | null;
    charCount: number;
    cleanedCharCount?: number | null;
    r2?: { rawKey?: string; cleanedKey?: string | null } | null;
  } | null>(null);
  const [scrapeError, setScrapeError] = useState('');
  const [scrapeShowRaw, setScrapeShowRaw] = useState(true);

  // Firecrawl Crawl 探索配置
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawlLimit, setCrawlLimit] = useState('100');
  const [isCrawlingJob, setIsCrawlingJob] = useState(false);
  const [crawlStatusText, setCrawlStatusText] = useState('');

  // Cloudflare R2 儲存配置
  const [r2AccountId, setR2AccountId] = useState('');
  const [r2AccessKeyId, setR2AccessKeyId] = useState('');
  const [r2SecretAccessKey, setR2SecretAccessKey] = useState('');
  const [r2BucketName, setR2BucketName] = useState('');

  // Job Tracking
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<JobTask | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // History tasks state
  const [tasksList, setTasksList] = useState<JobTask[]>([]);
  const [isTasksLoading, setIsTasksLoading] = useState(false);

  // Hydration state for localStorage
  const [isMounted, setIsMounted] = useState(false);

  // Load configuration from localStorage on mount
  useEffect(() => {
    setIsMounted(true);
    const savedConfig = localStorage.getItem('crawldocsConfig');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        if (parsed.depthLimit !== undefined) setDepthLimit(parsed.depthLimit);
        if (parsed.maxConcurrency !== undefined) setMaxConcurrency(parsed.maxConcurrency);
        if (parsed.maxUrls !== undefined) setMaxUrls(parsed.maxUrls);
        if (parsed.maxRetries !== undefined) setMaxRetries(parsed.maxRetries);
        if (parsed.enableClean !== undefined) setEnableClean(parsed.enableClean);
        if (parsed.firecrawlKey !== undefined) setFirecrawlKey(parsed.firecrawlKey);
        if (parsed.llmApiKey !== undefined) setLlmApiKey(parsed.llmApiKey);
        if (parsed.llmModelName !== undefined) setLlmModelName(parsed.llmModelName);
        if (parsed.llmBaseUrl !== undefined) setLlmBaseUrl(parsed.llmBaseUrl);
        if (parsed.cleaningPrompt !== undefined) setCleaningPrompt(parsed.cleaningPrompt);
        if (parsed.urlExtractorApiKey !== undefined) setUrlExtractorApiKey(parsed.urlExtractorApiKey);
        if (parsed.urlExtractorBaseUrl !== undefined) setUrlExtractorBaseUrl(parsed.urlExtractorBaseUrl);
        if (parsed.urlExtractorModel !== undefined) setUrlExtractorModel(parsed.urlExtractorModel);
        if (parsed.urlExtractorPrompt !== undefined) setUrlExtractorPrompt(parsed.urlExtractorPrompt);
        if (parsed.r2AccountId !== undefined) setR2AccountId(parsed.r2AccountId);
        if (parsed.r2AccessKeyId !== undefined) setR2AccessKeyId(parsed.r2AccessKeyId);
        if (parsed.r2SecretAccessKey !== undefined) setR2SecretAccessKey(parsed.r2SecretAccessKey);
        if (parsed.r2BucketName !== undefined) setR2BucketName(parsed.r2BucketName);
      } catch (e) {
        console.error("Failed to parse config from localStorage", e);
      }
    }
  }, []);

  // Save configuration to localStorage on change
  useEffect(() => {
    if (isMounted) {
      const configObj = {
        depthLimit, maxConcurrency, maxUrls, maxRetries, enableClean,
        firecrawlKey, llmApiKey, llmModelName, llmBaseUrl, cleaningPrompt,
        urlExtractorApiKey, urlExtractorBaseUrl, urlExtractorModel, urlExtractorPrompt,
        r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName
      };
      localStorage.setItem('crawldocsConfig', JSON.stringify(configObj));
    }
  }, [
    isMounted, depthLimit, maxConcurrency, maxUrls, maxRetries, enableClean,
    firecrawlKey, llmApiKey, llmModelName, llmBaseUrl, cleaningPrompt,
    urlExtractorApiKey, urlExtractorBaseUrl, urlExtractorModel, urlExtractorPrompt,
    r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName
  ]);

  // Polling Effect
  useEffect(() => {
    if (!taskId) return;

    const fetchStatus = async () => {
      try {
        // 若有 R2 覆蓋配置，使用 POST 傳送認證；否則退回 GET
        const hasR2Overrides = r2AccountId || r2AccessKeyId || r2SecretAccessKey;
        const res = hasR2Overrides
          ? await fetch(`/api/status/${taskId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              r2AccountId: r2AccountId || undefined,
              r2AccessKeyId: r2AccessKeyId || undefined,
              r2SecretAccessKey: r2SecretAccessKey || undefined,
              r2BucketName: r2BucketName || undefined,
            }),
          })
          : await fetch(`/api/status/${taskId}`);

        if (res.ok) {
          const data = await res.json();
          setTaskStatus(data);

          if (data.status === 'completed' || data.status === 'failed') {
            // Task is completely finished, you could stop polling here if desired.
          }
        }
      } catch (e) {
        console.error("Failed to fetch task status", e);
      }
    };

    const interval = setInterval(fetchStatus, 3000);
    fetchStatus(); // initial call

    return () => clearInterval(interval);
  }, [taskId]);

  // Fetch History Tasks
  useEffect(() => {
    if (activeTab === 'tasks') {
      const loadTasks = async () => {
        setIsTasksLoading(true);
        try {
          const hasR2Overrides = r2AccountId || r2AccessKeyId || r2SecretAccessKey;
          const res = hasR2Overrides
            ? await fetch(`/api/tasks`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                r2AccountId: r2AccountId || undefined,
                r2AccessKeyId: r2AccessKeyId || undefined,
                r2SecretAccessKey: r2SecretAccessKey || undefined,
                r2BucketName: r2BucketName || undefined,
              }),
            })
            : await fetch(`/api/tasks`);
          if (res.ok) {
            const data = await res.json();
            setTasksList(data.tasks || []);
          }
        } catch (e) {
          console.error("Failed to load tasks", e);
        } finally {
          setIsTasksLoading(false);
        }
      };
      loadTasks();
    }
  }, [activeTab, r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName]);

  const handleSubmit = async (customInput?: string) => {
    const activeInput = customInput || inputValue;
    if (!activeInput.trim()) {
      setErrorMsg("Please provide a Sitemap URL or a list of URLs.");
      return;
    }

    setErrorMsg('');
    setIsSubmitting(true);
    setTaskStatus(null);
    setTaskId(null);

    try {
      const engineSettings = {
        maxUrls,
        maxRetries,
        enableClean,
        firecrawlKey: firecrawlKey || undefined,
        // Content Cleaner
        llmApiKey: llmApiKey || undefined,
        llmModel: llmModelName || undefined,
        llmBaseUrl: llmBaseUrl || undefined,
        cleaningPrompt: cleaningPrompt !== DEFAULT_CLEANING_PROMPT ? cleaningPrompt : undefined,
        // URL Extractor
        urlExtractorApiKey: urlExtractorApiKey || undefined,
        urlExtractorBaseUrl: urlExtractorBaseUrl || undefined,
        urlExtractorModel: urlExtractorModel || undefined,
        urlExtractorPrompt: urlExtractorPrompt !== DEFAULT_URL_EXTRACTOR_PROMPT ? urlExtractorPrompt : undefined,
        // Cloudflare R2 Storage
        r2AccountId: r2AccountId || undefined,
        r2AccessKeyId: r2AccessKeyId || undefined,
        r2SecretAccessKey: r2SecretAccessKey || undefined,
        r2BucketName: r2BucketName || undefined,
      };

      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: activeInput, engineSettings }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.details || "Submitting failed");
      }

      setTaskId(data.taskId);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setErrorMsg(e.message || "Failed to submit task.");
      } else {
        setErrorMsg("Failed to submit task.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Firecrawl Map 擷取功能
  const handleMapFetch = async () => {
    if (!mapUrl.trim()) {
      setErrorMsg('Please provide a domain or URL to map.');
      return;
    }

    setErrorMsg('');
    setIsMapping(true);
    setMapResultCount(null);

    try {
      const res = await fetch('/api/map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: mapUrl.trim(),
          search: mapSearch.trim() || undefined,
          limit: mapLimit,
          firecrawlKey: firecrawlKey || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.details || 'Map request failed');
      }

      if (data.urls && data.urls.length > 0) {
        // 如果目前已有手動輸入的內容，將 Map 結果附加到後方
        const existingUrls = inputValue.trim();
        const mappedUrls = data.urls.join('\n');
        setInputValue(existingUrls ? `${existingUrls}\n${mappedUrls}` : mappedUrls);
        setMapResultCount(data.count);
      } else {
        setErrorMsg('No URLs found for the provided domain.');
      }
    } catch (e: unknown) {
      if (e instanceof Error) {
        setErrorMsg(e.message || 'Failed to map domain.');
      } else {
        setErrorMsg('Failed to map domain.');
      }
    } finally {
      setIsMapping(false);
    }
  };

  // Firecrawl Scrape 即時抓取功能 / 批次抓取
  const handleScrape = async () => {
    if (!inputValue.trim()) {
      setScrapeError('Please provide a URL or Sitemap to scrape.');
      return;
    }

    const text = inputValue.trim();
    // 判斷是否為單一網址
    const isMultiple = text.includes('\n') || text.includes(',');
    const isSitemap = text.endsWith('.xml');

    if (isMultiple || isSitemap) {
      // 走批次 Queue 邏輯
      handleSubmit(text);
      return;
    }

    // 單筆直接預覽
    setScrapeError('');
    setIsScraping(true);
    setScrapeResult(null);

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: text,
          firecrawlKey: firecrawlKey || undefined,
          waitFor: scrapeWaitFor || undefined,
          timeout: scrapeTimeout || undefined,
          onlyMainContent: scrapeOnlyMainContent,
          mobile: scrapeMobile,
          includeTags: scrapeIncludeTags.trim() || undefined,
          excludeTags: scrapeExcludeTags.trim() || undefined,
          saveToR2: scrapeSaveToR2,
          enableClean: scrapeEnableClean,
          llmApiKey: llmApiKey || undefined,
          llmBaseUrl: llmBaseUrl || undefined,
          llmModel: llmModelName || undefined,
          cleaningPrompt: cleaningPrompt !== DEFAULT_CLEANING_PROMPT ? cleaningPrompt : undefined,
          r2AccountId: r2AccountId || undefined,
          r2AccessKeyId: r2AccessKeyId || undefined,
          r2SecretAccessKey: r2SecretAccessKey || undefined,
          r2BucketName: r2BucketName || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.details || 'Scrape request failed');
      }

      setScrapeResult({
        markdown: data.markdown,
        cleanedMarkdown: data.cleanedMarkdown,
        metadata: data.metadata,
        charCount: data.charCount,
        cleanedCharCount: data.cleanedCharCount,
        r2: data.r2,
      });
    } catch (e: unknown) {
      if (e instanceof Error) {
        setScrapeError(e.message || 'Failed to scrape URL.');
      } else {
        setScrapeError('Failed to scrape URL.');
      }
    } finally {
      setIsScraping(false);
    }
  };

  // Firecrawl Crawl (探索並放入 Queue)
  const handleCrawl = async () => {
    if (!crawlUrl.trim()) {
      setErrorMsg('Please provide a Base URL for crawling.');
      return;
    }
    setErrorMsg('');
    setIsCrawlingJob(true);
    setCrawlStatusText('Starting crawl exploration...');

    try {
      // 1. Start Crawl Job
      const startRes = await fetch('/api/crawl-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: crawlUrl.trim(),
          limit: Number(crawlLimit),
          engineSettings: { firecrawlApiKey: firecrawlKey || undefined }
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || 'Failed to start crawl');

      const jobId = startData.jobId;

      // 2. Poll until completed
      let isCompleted = false;
      let links: string[] = [];
      while (!isCompleted) {
        setCrawlStatusText('Exploring website... gathering links...');
        await new Promise(r => setTimeout(r, 4000)); // wait 4 seconds

        const pollUrl = new URL(window.location.origin + '/api/crawl-job');
        pollUrl.searchParams.append('jobId', jobId);
        if (firecrawlKey) {
          pollUrl.searchParams.append('apiKey', firecrawlKey);
        }
        const pollRes = await fetch(pollUrl.toString());
        const pollData = await pollRes.json();

        if (!pollRes.ok) throw new Error(pollData.error || 'Polling failed');

        if (pollData.status === 'completed') {
          isCompleted = true;
          links = pollData.links || [];
        } else if (pollData.status === 'failed' || pollData.status === 'cancelled') {
          throw new Error(`Crawl job ${pollData.status}`);
        } else {
          // 'scraping'
          setCrawlStatusText(`Exploring... crawled ${pollData.completed || 0} pages so far.`);
        }
      }

      if (links.length === 0) {
        throw new Error('Crawl finished but no valid links found.');
      }

      setCrawlStatusText(`Found ${links.length} links! Forwarding to queue...`);

      // 3. Forward to Queue
      const queueInput = links.join('\n');
      await handleSubmit(queueInput);
    } catch (e: any) {
      setErrorMsg(e.message || 'Error occurred during crawl operation.');
    } finally {
      setIsCrawlingJob(false);
      setCrawlStatusText('');
    }
  };

  const calculateProgress = () => {
    if (!taskStatus || taskStatus.total === 0) return 0;
    return Math.round(((taskStatus.completed + taskStatus.failed) / taskStatus.total) * 100);
  };

  return (
    <div className="text-gray-800 antialiased min-h-screen pb-16">
      {/* Header */}
      <header className="w-full flex justify-between items-center px-8 py-6 max-w-5xl mx-auto">
        <div className="text-2xl font-bold tracking-tight text-gray-900">
          CrawlDocs
        </div>
        <nav className="flex space-x-1 text-sm font-medium bg-[#F1EBE0] p-1 rounded-xl">
          {(['tasks', 'create', 'storage', 'settings'] as const).map((tab) => {
            const labels = { tasks: 'Tasks', create: 'Create', storage: 'Storage (R2)', settings: 'Settings' };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-lg transition-all text-sm font-medium ${activeTab === tab
                  ? 'bg-white shadow-sm border border-orange-100/50 text-amber-900'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 mt-4 relative z-10">

        {/* ==================== CREATE TAB ==================== */}
        {activeTab === 'create' && (
          <div className="bg-white rounded-[2rem] p-8 custom-shadow stacked-card relative border border-gray-100/50">
            <h1 className="text-3xl font-bold text-gray-900 mb-8 tracking-tight">Create Crawling Task</h1>

            {/* Source Toggle — 三個選項 */}
            <div className="flex bg-[#F1EBE0] p-1 rounded-xl mb-6 relative">
              <button
                onClick={() => setSourceType('scrape')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg relative overflow-hidden transition-all ${sourceType === 'scrape' ? 'bg-white shadow-sm border border-orange-100/50 text-amber-900' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <span className="relative z-10 flex items-center justify-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                  Scrape
                </span>
                {sourceType === 'scrape' && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-orange-100/30 to-transparent"></div>}
              </button>
              <button
                onClick={() => setSourceType('crawl')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg relative overflow-hidden transition-all ${sourceType === 'crawl' ? 'bg-white shadow-sm border border-orange-100/50 text-amber-900' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <span className="relative z-10 flex items-center justify-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"></path></svg>
                  Crawl
                </span>
                {sourceType === 'crawl' && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-orange-100/30 to-transparent"></div>}
              </button>
              <button
                onClick={() => setSourceType('map')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg relative overflow-hidden transition-all ${sourceType === 'map' ? 'bg-white shadow-sm border border-orange-100/50 text-amber-900' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <span className="relative z-10 flex items-center justify-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>
                  Map
                </span>
                {sourceType === 'map' && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-orange-100/30 to-transparent"></div>}
              </button>
            </div>
            {/* Input Box — 根據模式切換 */}
            <div className="mb-6">
              {sourceType === 'scrape' ? (
                <>
                  {/* Scrape 模式：URL / Sitemap / URL 清單 + 進階參數 */}
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="scrape-url-input">
                    URL / Sitemap / URL List
                  </label>
                  <textarea
                    id="scrape-url-input"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="w-full bg-white border border-[#D5C5B5] rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:ring-amber-500 focus:border-amber-500 shadow-sm outline-none resize-y min-h-[80px]"
                    placeholder={"https://example.com/page\nhttps://example.com/sitemap.xml\nhttps://example.com/page2"}
                    rows={3}
                  />
                  <p className="text-xs text-gray-400 mt-1">Single URL = instant preview · Multiple URLs or Sitemap = batch queue processing</p>

                  {/* 進階 Scrape 參數 */}
                  <div className="mt-4 bg-[#F8F5EE] rounded-xl p-4 border border-[#E5D5C5] space-y-3">
                    <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Advanced Scrape Options</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Wait For (ms)</label>
                        <input
                          value={scrapeWaitFor}
                          onChange={(e) => setScrapeWaitFor(e.target.value)}
                          className="w-full bg-white border border-[#E5D5C5] rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                          placeholder="0"
                          type="number"
                          min="0"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Timeout (ms)</label>
                        <input
                          value={scrapeTimeout}
                          onChange={(e) => setScrapeTimeout(e.target.value)}
                          className="w-full bg-white border border-[#E5D5C5] rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                          placeholder="30000"
                          type="number"
                          min="0"
                          max="300000"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Include Tags</label>
                        <input
                          value={scrapeIncludeTags}
                          onChange={(e) => setScrapeIncludeTags(e.target.value)}
                          className="w-full bg-white border border-[#E5D5C5] rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                          placeholder="h1, p, .main-content"
                          type="text"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Exclude Tags</label>
                        <input
                          value={scrapeExcludeTags}
                          onChange={(e) => setScrapeExcludeTags(e.target.value)}
                          className="w-full bg-white border border-[#E5D5C5] rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                          placeholder="#ad, nav, footer"
                          type="text"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-6 pt-1">
                      <label className="flex items-center group cursor-pointer">
                        <input
                          type="checkbox"
                          checked={scrapeOnlyMainContent}
                          onChange={(e) => setScrapeOnlyMainContent(e.target.checked)}
                          className="w-4 h-4 rounded border-[#E5D5C5] text-[#845400] focus:ring-[#845400] transition-colors cursor-pointer accent-[#845400]"
                        />
                        <span className="ml-2 text-sm text-gray-600 group-hover:text-gray-900 transition-colors">Only Main Content</span>
                      </label>
                      <label className="flex items-center group cursor-pointer">
                        <input
                          type="checkbox"
                          checked={scrapeMobile}
                          onChange={(e) => setScrapeMobile(e.target.checked)}
                          className="w-4 h-4 rounded border-[#E5D5C5] text-[#845400] focus:ring-[#845400] transition-colors cursor-pointer accent-[#845400]"
                        />
                        <span className="ml-2 text-sm text-gray-600 group-hover:text-gray-900 transition-colors">Mobile Emulation</span>
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-6 border-t border-[#E5D5C5] pt-3">
                      <label className="flex items-center group cursor-pointer">
                        <input
                          type="checkbox"
                          checked={scrapeEnableClean}
                          onChange={(e) => setScrapeEnableClean(e.target.checked)}
                          className="w-4 h-4 rounded border-[#E5D5C5] text-[#845400] focus:ring-[#845400] transition-colors cursor-pointer accent-[#845400]"
                        />
                        <span className="ml-2 text-sm text-gray-600 group-hover:text-gray-900 transition-colors">LLM Content Cleaner</span>
                      </label>
                      <label className="flex items-center group cursor-pointer">
                        <input
                          type="checkbox"
                          checked={scrapeSaveToR2}
                          onChange={(e) => setScrapeSaveToR2(e.target.checked)}
                          className="w-4 h-4 rounded border-[#E5D5C5] text-[#845400] focus:ring-[#845400] transition-colors cursor-pointer accent-[#845400]"
                        />
                        <span className="ml-2 text-sm text-gray-600 group-hover:text-gray-900 transition-colors">Save to R2</span>
                      </label>
                    </div>
                  </div>

                  {/* Scrape Now 按鈕 */}
                  <button
                    onClick={handleScrape}
                    disabled={isScraping}
                    className={`w-full mt-4 py-2.5 rounded-xl text-sm font-medium transition-all ${isScraping
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-700 hover:to-amber-600 text-white shadow-sm'
                      }`}
                  >
                    {isScraping ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Scraping...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                        Scrape Now
                      </span>
                    )}
                  </button>

                  {/* Scrape 錯誤訊息 */}
                  {scrapeError && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                      <span className="font-bold">Error:</span> {scrapeError}
                    </div>
                  )}
                </>
              ) : sourceType === 'crawl' ? (
                <>
                  {/* Crawl 模式：Base URL + Max Links + Start 按鈕 */}
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="crawl-url-input">
                    Base URL (Entry Point)
                  </label>
                  <input
                    id="crawl-url-input"
                    value={crawlUrl}
                    onChange={(e) => setCrawlUrl(e.target.value)}
                    className="w-full bg-white border border-[#D5C5B5] rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:ring-amber-500 focus:border-amber-500 shadow-sm outline-none"
                    placeholder="https://docs.example.com"
                    type="text"
                  />
                  <p className="text-xs text-gray-400 mt-1">Firecrawl will automatically discover and follow all sub-pages from this URL.</p>

                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Max Links to Crawl</label>
                    <input
                      value={crawlLimit}
                      onChange={(e) => setCrawlLimit(e.target.value)}
                      className="w-32 bg-white border border-[#E5D5C5] rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                      placeholder="100"
                      type="number"
                      min="1"
                      max="10000"
                    />
                  </div>

                  {/* Start Crawl 按鈕 */}
                  <button
                    onClick={handleCrawl}
                    disabled={isCrawlingJob}
                    className={`w-full mt-4 py-2.5 rounded-xl text-sm font-medium transition-all ${isCrawlingJob
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-700 hover:to-purple-600 text-white shadow-sm'
                      }`}
                  >
                    {isCrawlingJob ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {crawlStatusText || 'Crawling...'}
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Start Crawl &amp; Process
                      </span>
                    )}
                  </button>

                  {/* Crawl 錯誤顯示 */}
                  {errorMsg && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                      <span className="font-bold">Error:</span> {errorMsg}
                    </div>
                  )}
                </>
              ) : sourceType === 'map' ? (
                <>
                  {/* Map 模式：域名輸入 + 可選選項 + Fetch 按鈕 */}
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="map-url-input">
                    Domain / Base URL
                  </label>
                  <input
                    id="map-url-input"
                    value={mapUrl}
                    onChange={(e) => setMapUrl(e.target.value)}
                    className="w-full bg-white border border-[#D5C5B5] rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:ring-amber-500 focus:border-amber-500 shadow-sm outline-none"
                    placeholder="https://docs.example.com"
                    type="text"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Enter a domain or base URL. Firecrawl will discover all accessible pages under it.
                  </p>

                  {/* Map 可選篩選參數 */}
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Search Filter (optional)</label>
                      <input
                        value={mapSearch}
                        onChange={(e) => setMapSearch(e.target.value)}
                        className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                        placeholder="e.g. docs, api, guide"
                        type="text"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">URL Limit</label>
                      <input
                        value={mapLimit}
                        onChange={(e) => setMapLimit(e.target.value)}
                        className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-lg px-3 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                        placeholder="5000"
                        type="number"
                        min="1"
                        max="100000"
                      />
                    </div>
                  </div>

                  {/* Fetch & Map 按鈕 */}
                  <button
                    onClick={handleMapFetch}
                    disabled={isMapping}
                    className={`w-full mt-4 py-2.5 rounded-xl text-sm font-medium transition-all ${isMapping
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-700 hover:to-amber-600 text-white shadow-sm'
                      }`}
                  >
                    {isMapping ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Mapping domain...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>
                        Fetch &amp; Map URLs
                      </span>
                    )}
                  </button>

                  {/* Map 成功提示 */}
                  {mapResultCount !== null && (
                    <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm flex items-center gap-2">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                      <span>Found <strong>{mapResultCount}</strong> URLs.</span>
                    </div>
                  )}
                  {/* Map 結果轉移按鈕 */}
                  {inputValue.trim() && (
                    <div className="flex gap-3 mt-3">
                      <button
                        onClick={() => { setSourceType('scrape'); }}
                        className="flex-1 py-2 rounded-xl text-sm font-medium bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 transition-all flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                        Use in Scrape
                      </button>
                      <button
                        onClick={() => { setCrawlUrl(inputValue.split('\n')[0]); setSourceType('crawl'); }}
                        className="flex-1 py-2 rounded-xl text-sm font-medium bg-purple-50 border border-purple-200 text-purple-800 hover:bg-purple-100 transition-all flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Use in Crawl
                      </button>
                    </div>
                  )}
                </>
              ) : null}
            </div>



            {/* Tracker Board / Scrape Result Preview */}
            {/* 當有 taskId 時，優先顯示 Queue Tracker；否則 scrape 模式顯示即時預覽 */}
            {sourceType === 'scrape' && !taskId ? (
              /* ===== Scrape 結果預覽面板 ===== */
              <div className="bg-black rounded-2xl overflow-hidden mb-8 relative flex flex-col shadow-inner border border-gray-900 border-opacity-50" style={{ minHeight: '280px' }}>
                {!scrapeResult && !isScraping ? (
                  <div className="flex-1 flex items-center justify-center text-center w-full px-8 opacity-60">
                    <div>
                      <div className="mx-auto w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mb-4 border border-white/20">
                        <svg className="w-8 h-8 text-amber-500/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                      </div>
                      <h3 className="text-amber-500/60 font-semibold tracking-widest text-sm uppercase">Scrape Ready</h3>
                      <p className="text-gray-400 text-xs mt-2 max-w-sm mx-auto">Enter a URL and click &quot;Scrape Now&quot; to instantly fetch and preview the page content.</p>
                    </div>
                  </div>
                ) : isScraping ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                      <svg className="animate-spin w-10 h-10 text-amber-500 mx-auto mb-4" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle>
                        <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor" className="opacity-75"></path>
                      </svg>
                      <h3 className="text-amber-500 font-semibold text-sm uppercase tracking-widest">Scraping...</h3>
                      <p className="text-gray-500 text-xs mt-1">{inputValue}</p>
                    </div>
                  </div>
                ) : scrapeResult ? (
                  <div className="flex flex-col h-full">
                    {/* 頂部狀態列 */}
                    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 bg-gray-900/50">
                      <div className="flex items-center gap-3">
                        <span className="bg-green-600/20 text-green-400 text-xs px-3 py-1 rounded-full uppercase tracking-wider font-semibold border border-green-600/40">
                          Success
                        </span>
                        {scrapeResult.r2 && (
                          <span className="bg-blue-600/20 text-blue-400 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold border border-blue-600/40">
                            Saved to R2
                          </span>
                        )}
                      </div>
                      {/* Raw / Cleaned 切換 */}
                      {scrapeResult.cleanedMarkdown && (
                        <div className="flex bg-gray-800 rounded-lg p-0.5 text-[10px]">
                          <button
                            onClick={() => setScrapeShowRaw(true)}
                            className={`px-3 py-1 rounded-md transition-all font-medium ${scrapeShowRaw ? 'bg-amber-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                          >
                            Raw
                          </button>
                          <button
                            onClick={() => setScrapeShowRaw(false)}
                            className={`px-3 py-1 rounded-md transition-all font-medium ${!scrapeShowRaw ? 'bg-amber-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                          >
                            Cleaned
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 統計指標列 */}
                    <div className="grid grid-cols-3 gap-3 px-5 py-3 border-b border-gray-800">
                      <div className="bg-gray-900/80 rounded-lg p-2.5 border border-gray-800">
                        <div className="text-gray-500 text-[10px] uppercase font-bold tracking-widest">Raw Chars</div>
                        <div className="text-gray-200 text-lg font-light mt-0.5">{scrapeResult.charCount.toLocaleString()}</div>
                      </div>
                      <div className="bg-gray-900/80 rounded-lg p-2.5 border border-amber-900/30">
                        <div className="text-amber-500 text-[10px] uppercase font-bold tracking-widest">Cleaned</div>
                        <div className="text-amber-100 text-lg font-light mt-0.5">{scrapeResult.cleanedCharCount?.toLocaleString() ?? '—'}</div>
                      </div>
                      <div className="bg-gray-900/80 rounded-lg p-2.5 border border-gray-800">
                        <div className="text-gray-500 text-[10px] uppercase font-bold tracking-widest">Status</div>
                        <div className="text-gray-200 text-lg font-light mt-0.5">{(scrapeResult.metadata as Record<string, unknown>)?.statusCode?.toString() ?? '200'}</div>
                      </div>
                    </div>

                    {/* Markdown 內容預覽 */}
                    <div className="flex-1 overflow-y-auto px-5 py-3 custom-scrollbar" style={{ maxHeight: '300px' }}>
                      <pre className="text-gray-300 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed">
                        {scrapeShowRaw ? scrapeResult.markdown : (scrapeResult.cleanedMarkdown || scrapeResult.markdown)}
                      </pre>
                    </div>

                    {/* R2 路徑資訊 */}
                    {scrapeResult.r2 && (
                      <div className="px-5 py-2.5 border-t border-gray-800 bg-gray-900/30 text-[10px] font-mono text-gray-500 space-y-0.5">
                        {scrapeResult.r2.rawKey && <div><span className="text-gray-600">RAW:</span> {scrapeResult.r2.rawKey}</div>}
                        {scrapeResult.r2.cleanedKey && <div><span className="text-gray-600">CLEANED:</span> {scrapeResult.r2.cleanedKey}</div>}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              /* ===== 原始 Queue Tracker Board ===== */
              <div className="bg-black rounded-2xl overflow-hidden mb-8 relative aspect-video flex flex-col justify-center items-center shadow-inner border border-gray-900 border-opacity-50">

                {!taskId ? (
                  <div className="text-center w-full px-8 opacity-60">
                    <div className="mx-auto w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mb-4 border border-white/20">
                      <svg className="w-8 h-8 text-amber-500/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
                    </div>
                    <h3 className="text-amber-500/60 font-semibold tracking-widest text-sm uppercase">Engine Ready</h3>
                    <p className="text-gray-400 text-xs mt-2 max-w-sm mx-auto">Create a task to monitor real-time queue ingestion, LLM scraping processes, and direct R2 delivery states.</p>
                  </div>
                ) : (
                  <div className="absolute inset-0 bg-black flex flex-col p-8 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
                    {/* Background Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black to-black opacity-90"></div>

                    <div className="relative z-10 flex-1 flex flex-col">
                      <div className="flex justify-between items-center mb-auto pt-2">
                        <div className="flex items-center gap-3">
                          <span className="bg-amber-600/20 text-amber-500 text-xs px-3 py-1 rounded-full uppercase tracking-wider font-semibold border border-amber-600/40">
                            {taskStatus?.status === 'completed' ? 'Finished' : taskStatus?.status === 'failed' ? 'Failed' : 'Processing'}
                          </span>
                          {taskStatus?.date && (
                            <span className="text-gray-500 text-xs font-mono border border-gray-700 bg-gray-800/50 px-2 py-0.5 rounded">
                              {new Date(taskStatus.date).toLocaleString()}
                            </span>
                          )}
                        </div>
                        <span className="text-gray-400 text-xs font-mono">ID: {taskId}</span>
                      </div>

                      <div className="flex-1 flex flex-col justify-center items-center">
                        <div className="text-5xl font-light text-white mb-2">
                          {calculateProgress()}%
                        </div>

                        <div className="w-64 h-2 bg-gray-800 rounded-full mt-4 overflow-hidden border border-gray-700">
                          <div
                            className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(245,158,11,0.6)]"
                            style={{ width: `${calculateProgress()}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Lower Metrics box */}
                      <div className="mt-auto flex flex-col gap-4 pb-2">
                        <div className="grid grid-cols-3 gap-4">
                          <div className="bg-gray-900/80 rounded-lg p-3 border border-gray-800">
                            <div className="text-gray-500 text-[10px] uppercase font-bold tracking-widest">Total Found</div>
                            <div className="text-gray-200 text-xl font-light mt-1">{taskStatus?.total || 0}</div>
                          </div>
                          <div className="bg-gray-900/80 rounded-lg p-3 border border-amber-900/30">
                            <div className="text-amber-500 text-[10px] uppercase font-bold tracking-widest">Completed</div>
                            <div className="text-amber-100 text-xl font-light mt-1">{taskStatus?.completed || 0}</div>
                          </div>
                          <div className="bg-gray-900/80 rounded-lg p-3 border border-red-900/30">
                            <div className="text-red-500 text-[10px] uppercase font-bold tracking-widest">Failures</div>
                            <div className="text-red-100 text-xl font-light mt-1">{taskStatus?.failed || 0}</div>
                          </div>
                        </div>

                        {/* Failed URLs List */}
                        {taskStatus?.failedUrls && taskStatus.failedUrls.length > 0 && (
                          <div className="mt-2 text-left bg-red-950/30 border border-red-900/50 rounded-lg p-3 max-h-32 overflow-y-auto custom-scrollbar">
                            <div className="text-red-400 text-[10px] uppercase font-bold tracking-widest mb-2 sticky top-0 bg-red-950/80 backdrop-blur-sm py-1">Failed URLs Log</div>
                            <ul className="space-y-2">
                              {taskStatus.failedUrls.map((item, idx) => (
                                <li key={idx} className="text-xs text-red-200/80 truncate font-mono">
                                  <span className="text-red-500 mr-2">[{idx + 1}]</span>
                                  <span className="opacity-80" title={item.url}>{item.url}</span>
                                  <div className="text-red-400/60 text-[10px] mt-0.5 ml-6 truncate" title={item.error}>{item.error}</div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Retrying URLs List */}
                        {taskStatus?.retryingUrls && taskStatus.retryingUrls.length > 0 && (
                          <div className="mt-2 text-left bg-amber-950/30 border border-amber-800/50 rounded-lg p-3 max-h-32 overflow-y-auto custom-scrollbar">
                            <div className="text-amber-500 text-[10px] uppercase font-bold tracking-widest mb-2 sticky top-0 bg-amber-950/80 backdrop-blur-sm py-1">Currently Retrying...</div>
                            <ul className="space-y-2">
                              {taskStatus.retryingUrls.map((item, idx) => (
                                <li key={idx} className="text-xs text-amber-200/80 truncate font-mono">
                                  <span className="text-amber-500 mr-2">[{item.attempts}/{item.maxRetries}]</span>
                                  <span className="opacity-80" title={item.url}>{item.url}</span>
                                  <div className="text-amber-400/60 text-[10px] mt-0.5 ml-8 truncate" title={item.error}>{item.error}</div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {errorMsg && (
              <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                <span className="font-bold">Error:</span> {errorMsg}
              </div>
            )}

            {/* Advanced Settings — 僅在非 scrape 模式下顯示 */}
            {sourceType !== 'scrape' && (
              <>
                <div className="bg-[#F8F5EE] rounded-2xl p-6 border border-[#E5D5C5]">
                  <div className="flex justify-between items-center mb-6 cursor-pointer">
                    <h2 className="text-lg font-semibold text-gray-800">Advanced Engine Settings</h2>
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path></svg>
                  </div>

                  <div className="grid grid-cols-2 gap-8">
                    {/* Concurrency & URL Cap */}
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Max Vercel Concurrency</label>
                        <div className="flex items-center space-x-3">
                          <input
                            type="range"
                            min="1"
                            max="10"
                            value={maxConcurrency}
                            onChange={(e) => setMaxConcurrency(e.target.value)}
                            className="w-full appearance-none bg-transparent"
                          />
                          <span className="text-sm font-medium text-gray-700 w-6">{maxConcurrency}.0</span>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">Warning: High concurrency triggers proxy Rate Limiting</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Hard URL Cap</label>
                        <div className="flex items-center space-x-4">
                          <input
                            type="range"
                            min="100"
                            max="5000"
                            step="100"
                            value={maxUrls}
                            onChange={(e) => setMaxUrls(e.target.value)}
                            className="w-24 appearance-none bg-transparent"
                          />
                          <div className="flex space-x-2 text-sm text-gray-700 font-mono font-bold bg-[#FDF8EB] px-2 py-1 rounded border border-gray-200">
                            {maxUrls}
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Queue Max Retries</label>
                        <div className="flex items-center space-x-4">
                          <input
                            type="range"
                            min="0"
                            max="10"
                            step="1"
                            value={maxRetries}
                            onChange={(e) => setMaxRetries(e.target.value)}
                            className="w-24 appearance-none bg-transparent"
                          />
                          <div className="flex space-x-2 text-sm text-gray-700 font-mono font-bold bg-[#FDF8EB] px-2 py-1 rounded border border-gray-200">
                            {maxRetries}
                          </div>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-[#E5D5C5] mt-6">
                        <label className="block text-sm font-medium text-gray-700 mb-3">Processor Flags</label>
                        <div className="space-y-3">
                          <label className="flex items-center group cursor-pointer">
                            <input
                              type="checkbox"
                              checked={enableClean}
                              onChange={(e) => setEnableClean(e.target.checked)}
                              className="w-4 h-4 rounded border-[#E5D5C5] text-[#845400] focus:ring-[#845400] transition-colors cursor-pointer accent-[#845400]"
                            />
                            <span className="ml-3 text-sm text-gray-600 group-hover:text-gray-900 transition-colors">Enabled LLM content cleaning</span>
                          </label>
                          <label className="flex items-center group cursor-pointer">
                            <input type="checkbox" className="w-4 h-4 rounded border-[#E5D5C5] text-[#845400] focus:ring-[#845400] transition-colors cursor-pointer accent-[#845400]" />
                            <span className="ml-3 text-sm text-gray-600 group-hover:text-gray-900 transition-colors">Skip index pages (e.g. /category)</span>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Status Configs */}
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Max Depth Limit</label>
                        <select
                          value={depthLimit}
                          onChange={(e) => setDepthLimit(e.target.value)}
                          className="w-full bg-white border border-[#E5D5C5] rounded-xl px-4 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                        >
                          <option value="0">0 (Infinite)</option>
                          <option value="1">1 Layer</option>
                          <option value="2">2 Layers</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Save Format</label>
                        <select className="w-full bg-white border border-[#E5D5C5] rounded-xl px-4 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none">
                          <option>Markdown (RAG)</option>
                          <option disabled>JSON (Metadata)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Target Storage</label>
                        <select className="w-full bg-white border border-[#E5D5C5] rounded-xl px-4 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none">
                          <option>Cloudflare R2</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ==================== STORAGE (R2) TAB ==================== */}
        {activeTab === 'storage' && (
          <div className="bg-white rounded-[2rem] p-8 custom-shadow stacked-card relative border border-gray-100/50">
            <h1 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">Storage (R2)</h1>
            <p className="text-sm text-gray-500 mb-8">Configure Cloudflare R2 bucket credentials for storing crawl results. Leave blank to use server environment defaults.</p>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account ID</label>
                  <input
                    value={r2AccountId}
                    onChange={(e) => setR2AccountId(e.target.value)}
                    placeholder="Cloudflare Account ID"
                    className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                    type="text"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bucket Name</label>
                  <input
                    value={r2BucketName}
                    onChange={(e) => setR2BucketName(e.target.value)}
                    placeholder="crawldocs"
                    className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                    type="text"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Access Key ID</label>
                <input
                  value={r2AccessKeyId}
                  onChange={(e) => setR2AccessKeyId(e.target.value)}
                  placeholder="R2 Access Key ID"
                  className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  type="password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Secret Access Key</label>
                <input
                  value={r2SecretAccessKey}
                  onChange={(e) => setR2SecretAccessKey(e.target.value)}
                  placeholder="R2 Secret Access Key"
                  className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  type="password"
                />
              </div>

              {/* 連線狀態指示 */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <div className={`w-2 h-2 rounded-full ${r2AccountId && r2AccessKeyId && r2SecretAccessKey ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                <span className="text-xs text-gray-500">
                  {r2AccountId && r2AccessKeyId && r2SecretAccessKey
                    ? 'Credentials configured (using custom)'
                    : 'No custom credentials — will use server environment defaults'
                  }
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ==================== SETTINGS TAB ==================== */}
        {activeTab === 'settings' && (
          <div className="bg-white rounded-[2rem] p-8 custom-shadow stacked-card relative border border-gray-100/50">
            <h1 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">Settings</h1>
            <p className="text-sm text-gray-500 mb-8">Configure API keys and models for scraping, content cleaning, and URL extraction.</p>

            <div className="space-y-6">
              {/* Scraping Processor */}
              <div className="bg-[#F8F5EE] rounded-2xl p-6 border border-[#E5D5C5]">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">Scraping Processor</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">API Key</label>
                    <input
                      value={firecrawlKey}
                      onChange={(e) => setFirecrawlKey(e.target.value)}
                      placeholder="Firecrawl API Key (Leave blank for default env)"
                      className="w-full bg-white border border-[#E5D5C5] rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                      type="password"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Provider Engine</label>
                    <select className="w-full bg-white border border-[#E5D5C5] rounded-xl px-4 py-2.5 text-sm text-gray-700 appearance-none outline-none">
                      <option>Firecrawl (mendable)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* LLM Content Cleaner */}
              <div className="bg-[#F8F5EE] rounded-2xl p-6 border border-[#E5D5C5]">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">LLM Content Cleaner</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">API Key</label>
                    <input
                      value={llmApiKey}
                      onChange={(e) => setLlmApiKey(e.target.value)}
                      placeholder="API Key (Leave blank for default env)"
                      className="w-full bg-white border border-[#E5D5C5] rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                      type="password"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Base URL</label>
                      <input
                        value={llmBaseUrl}
                        onChange={(e) => setLlmBaseUrl(e.target.value)}
                        placeholder="e.g. https://open.bigmodel.cn/api/paas/v4/"
                        className="w-full bg-white border border-[#E5D5C5] rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                        type="text"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Model</label>
                      <input
                        list="cleaner-model-suggestions"
                        value={llmModelName}
                        onChange={(e) => setLlmModelName(e.target.value)}
                        placeholder="Enter model name..."
                        className="w-full bg-white border border-[#E5D5C5] rounded-xl px-4 py-2.5 text-sm text-gray-700 appearance-none outline-none focus:ring-amber-500 focus:border-amber-500"
                      />
                      <datalist id="cleaner-model-suggestions">
                        <option value="glm-4-flash" />
                        <option value="deepseek-chat" />
                        <option value="gpt-4o-mini" />
                        <option value="qwen-turbo" />
                        <option value="claude-3-haiku-20240307" />
                      </datalist>
                    </div>
                  </div>

                  {/* 可折疊的自訂 Prompt */}
                  <div className="border-t border-[#E5D5C5] pt-4">
                    <button
                      type="button"
                      onClick={() => setShowCleaningPrompt(!showCleaningPrompt)}
                      className="flex items-center justify-between w-full text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
                    >
                      <span>Custom Cleaning Prompt</span>
                      <svg className={`w-4 h-4 transition-transform ${showCleaningPrompt ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    {showCleaningPrompt && (
                      <div className="mt-2">
                        <textarea
                          value={cleaningPrompt}
                          onChange={(e) => setCleaningPrompt(e.target.value)}
                          className="w-full bg-white border border-[#E5D5C5] rounded-lg px-3 py-2 text-xs text-gray-700 outline-none focus:ring-amber-500 focus:border-amber-500 resize-y min-h-[120px] max-h-[300px] font-mono leading-relaxed"
                          rows={8}
                        />
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-[10px] text-gray-400">{cleaningPrompt.length} chars</span>
                          <button
                            type="button"
                            onClick={() => setCleaningPrompt(DEFAULT_CLEANING_PROMPT)}
                            className="text-[10px] text-amber-700 hover:text-amber-900 transition-colors underline"
                          >
                            Reset to default
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* URL Extractor */}
              <div className="bg-[#F8F5EE] rounded-2xl p-6 border border-[#E5D5C5]">
                <h2 className="text-lg font-semibold text-gray-800 mb-1">URL Extractor (LLM)</h2>
                <p className="text-xs text-gray-400 mb-4">Used when extracting URLs from raw text input. Not needed for sitemap URLs.</p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">API Key</label>
                    <input
                      value={urlExtractorApiKey}
                      onChange={(e) => setUrlExtractorApiKey(e.target.value)}
                      placeholder="API Key (Leave blank for default env)"
                      className="w-full bg-white border border-[#E5D5C5] rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                      type="password"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Base URL</label>
                      <input
                        value={urlExtractorBaseUrl}
                        onChange={(e) => setUrlExtractorBaseUrl(e.target.value)}
                        placeholder="e.g. https://api.deepseek.com/v1"
                        className="w-full bg-white border border-[#E5D5C5] rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                        type="text"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Model</label>
                      <input
                        list="extractor-model-suggestions"
                        value={urlExtractorModel}
                        onChange={(e) => setUrlExtractorModel(e.target.value)}
                        placeholder="e.g. deepseek-chat"
                        className="w-full bg-white border border-[#E5D5C5] rounded-xl px-4 py-2.5 text-sm text-gray-700 appearance-none outline-none focus:ring-amber-500 focus:border-amber-500"
                      />
                      <datalist id="extractor-model-suggestions">
                        <option value="deepseek-chat" />
                        <option value="glm-4-flash" />
                        <option value="gpt-4o-mini" />
                        <option value="qwen-turbo" />
                      </datalist>
                    </div>
                  </div>

                  {/* 可折疊的自訂 Prompt */}
                  <div className="border-t border-[#E5D5C5] pt-4">
                    <button
                      type="button"
                      onClick={() => setShowUrlExtractorPrompt(!showUrlExtractorPrompt)}
                      className="flex items-center justify-between w-full text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
                    >
                      <span>Custom Extractor Prompt</span>
                      <svg className={`w-4 h-4 transition-transform ${showUrlExtractorPrompt ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    {showUrlExtractorPrompt && (
                      <div className="mt-2">
                        <textarea
                          value={urlExtractorPrompt}
                          onChange={(e) => setUrlExtractorPrompt(e.target.value)}
                          className="w-full bg-white border border-[#E5D5C5] rounded-lg px-3 py-2 text-xs text-gray-700 outline-none focus:ring-amber-500 focus:border-amber-500 resize-y min-h-[80px] max-h-[200px] font-mono leading-relaxed"
                          rows={4}
                        />
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-[10px] text-gray-400">{urlExtractorPrompt.length} chars</span>
                          <button
                            type="button"
                            onClick={() => setUrlExtractorPrompt(DEFAULT_URL_EXTRACTOR_PROMPT)}
                            className="text-[10px] text-amber-700 hover:text-amber-900 transition-colors underline"
                          >
                            Reset to default
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TASKS TAB ==================== */}
        {activeTab === 'tasks' && (
          <div className="bg-white rounded-[2rem] p-8 custom-shadow stacked-card relative border border-gray-100/50">
            <h1 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">Tasks</h1>
            <p className="text-sm text-gray-500 mb-8">View and manage your crawling tasks.</p>

            {isTasksLoading ? (
              <div className="text-center py-16 opacity-60">
                <svg className="animate-spin w-8 h-8 text-amber-500 mx-auto mb-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle>
                  <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor" className="opacity-75"></path>
                </svg>
                <h3 className="text-gray-600 font-semibold text-sm">Loading task history...</h3>
              </div>
            ) : tasksList.length === 0 ? (
              <div className="text-center py-16 opacity-60">
                <div className="mx-auto w-16 h-16 bg-[#F8F5EE] rounded-full flex items-center justify-center mb-4 border border-[#E5D5C5]">
                  <svg className="w-8 h-8 text-amber-500/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                </div>
                <h3 className="text-gray-600 font-semibold text-sm">No task history yet</h3>
                <p className="text-gray-400 text-xs mt-2">Tasks created from the Create tab will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {tasksList.map((t) => {
                  const progress = t.total ? Math.round(((t.completed + t.failed) / t.total) * 100) : 0;
                  return (
                    <div key={t.taskId} className="bg-[#F8F5EE] rounded-2xl p-5 border border-[#E5D5C5] flex items-center justify-between transition-all hover:shadow-sm">
                      <div className="flex-1 min-w-0 mr-4">
                        <div className="flex items-center gap-3 mb-2">
                          <span className={`text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-wider font-bold border ${t.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' :
                            t.status === 'failed' ? 'bg-red-100 text-red-700 border-red-200' :
                              'bg-amber-100 text-amber-700 border-amber-200'
                            }`}>
                            {t.status}
                          </span>
                          {t.date && (
                            <span className="text-xs text-gray-500 font-mono">
                              {new Date(t.date).toLocaleString()}
                            </span>
                          )}
                          <span className="text-[10px] text-gray-400 font-mono hidden sm:inline-block">ID: {t.taskId}</span>
                        </div>

                        <div className="w-full max-w-sm h-1.5 bg-white rounded-full mt-3 overflow-hidden border border-[#E5D5C5]">
                          <div
                            className="h-full bg-amber-500 rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          ></div>
                        </div>
                        <div className="flex gap-4 mt-2 text-xs">
                          <span className="text-gray-600 font-medium">{t.completed} <span className="text-gray-400 font-normal">done</span></span>
                          {t.failed > 0 && <span className="text-red-500 font-medium">{t.failed} <span className="text-red-400 font-normal">fail</span></span>}
                          <span className="text-gray-500 font-medium">{t.total} <span className="text-gray-400 font-normal">total</span></span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setTaskId(t.taskId);
                          setActiveTab('create');
                        }}
                        className="shrink-0 bg-white border border-[#D5C5B5] text-[#845400] hover:bg-[#FDF8EB] hover:border-[#845400] px-4 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all"
                      >
                        View Monitor
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}

