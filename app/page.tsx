"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { checkCrawlJob, startCrawlJob } from '@/lib/services/crawler';
import { downloadSingleFile, downloadFolderAsZip } from '@/lib/utils/download';
import { buildR2Key } from '@/lib/utils/helpers';
import { formatStoredDate, getTaskDisplayDate } from '@/lib/utils/task-metadata';

import type { SkillTaskStatus } from '@/app/api/generate-skill/route';

// pi-ai Provider/Model Registry（由 /api/pi-models 提供）
interface PiModelInfo {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
}

interface PiProviderInfo {
  id: string;
  apis: string[];
  supportsCustomModel: boolean;
  modelCount: number;
  models: PiModelInfo[];
}

// Defines the shape of standard Crawl Task metrics
interface JobTask {
  taskId: string;
  status: 'processing' | 'completed' | 'failed';
  total: number;
  completed: number;
  failed: number;
  failedUrls: { url: string; error: string }[];
  retryingUrls?: { url: string; attempts: number; maxRetries: number; error: string }[];
  urls?: { url: string; status: 'pending' | 'processing' | 'success' | 'failed'; error?: string }[];
  date: string;
  createdAt?: string;
  updatedAt?: string;
  domains?: string[];
  domainSummary?: string;
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

export default function DocEngineFrontend() {
  const [activeTab, setActiveTab] = useState<'tasks' | 'create' | 'skill' | 'storage' | 'settings'>('create');
  const [sourceType, setSourceType] = useState<'scrape' | 'crawl' | 'map'>('scrape');
  const [inputValue, setInputValue] = useState('');

  // Advanced parameters
  const [depthLimit, setDepthLimit] = useState('0');
  const [maxConcurrency, setMaxConcurrency] = useState('2');
  const [maxUrls, setMaxUrls] = useState('1000');
  const [maxRetries, setMaxRetries] = useState('3');
  const [urlTimeout, setUrlTimeout] = useState('300');
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

  // Task Progress Drawer 狀態
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [retryingUrls, setRetryingUrls] = useState<Set<string>>(new Set());
  const [abortingUrls, setAbortingUrls] = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [fileSizes, setFileSizes] = useState<Record<string, number>>({});
  const [isLocalActionLoading, setIsLocalActionLoading] = useState<Set<string>>(new Set());

  // History tasks state
  const [tasksList, setTasksList] = useState<JobTask[]>([]);
  const [isTasksLoading, setIsTasksLoading] = useState(false);

  // ====== Skill Generator State ======
  const [skillAuthMode, setSkillAuthMode] = useState<'oauth' | 'apikey'>('apikey');
  const [codexAuth, setCodexAuth] = useState<{ loggedIn: boolean; expires?: number } | null>(null);
  const [skillProvider, setSkillProvider] = useState('openai');
  const [skillApiKey, setSkillApiKey] = useState('');
  // 空字串代表不覆蓋，使用 pi-ai registry 內建的 baseUrl
  const [skillBaseUrl, setSkillBaseUrl] = useState('');
  const [skillModel, setSkillModel] = useState('gpt-4o');
  const [skillUseCustomModel, setSkillUseCustomModel] = useState(false);
  const [skillCustomModelId, setSkillCustomModelId] = useState('');

  const [piProviders, setPiProviders] = useState<PiProviderInfo[]>([]);
  const [isPiProvidersLoading, setIsPiProvidersLoading] = useState(false);
  const [piProvidersError, setPiProvidersError] = useState('');
  const [availableFolders, setAvailableFolders] = useState<{ date: string; domain: string; prefix: string; fileCount: number; emptyFileCount: number }[]>([]);

  // === LLM 連線測試狀態 ===
  const [cleanerTestResult, setCleanerTestResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null);
  const [isCleanerTesting, setIsCleanerTesting] = useState(false);
  const [skillTestResult, setSkillTestResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null);
  const [isSkillTesting, setIsSkillTesting] = useState(false);
  const [extractorTestResult, setExtractorTestResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null);
  const [isExtractorTesting, setIsExtractorTesting] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [skillCustomPrompt, setSkillCustomPrompt] = useState('');
  const [showSkillPrompt, setShowSkillPrompt] = useState(false);
  const [skillTaskId, setSkillTaskId] = useState<string | null>(null);
  const [skillStatus, setSkillStatus] = useState<SkillTaskStatus | null>(null);
  const [isSkillSubmitting, setIsSkillSubmitting] = useState(false);
  const [skillError, setSkillError] = useState('');
  const [isFoldersLoading, setIsFoldersLoading] = useState(false);
  const [skillHistory, setSkillHistory] = useState<SkillTaskStatus[]>([]);
  const [isSkillHistoryLoading, setIsSkillHistoryLoading] = useState(false);
  const [retryingSkillTaskIds, setRetryingSkillTaskIds] = useState<Set<string>>(new Set());
  const [downloadingSkillTaskIds, setDownloadingSkillTaskIds] = useState<Set<string>>(new Set());
  const skillPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hydration state for localStorage
  const [isMounted, setIsMounted] = useState(false);

  // === Skill Generator 的 Provider/Model 快取 ===
  const selectedSkillProviderInfo = piProviders.find((p) => p.id === skillProvider);
  const selectedSkillProviderModels = selectedSkillProviderInfo?.models || [];
  const selectedSkillModelInfo = selectedSkillProviderModels.find((m) => m.id === skillModel);

  const loadSkillHistory = useCallback(async () => {
    setIsSkillHistoryLoading(true);
    try {
      const hasR2Overrides = r2AccountId || r2AccessKeyId || r2SecretAccessKey || r2BucketName;
      const res = hasR2Overrides
        ? await fetch('/api/skill-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            r2AccountId: r2AccountId || undefined,
            r2AccessKeyId: r2AccessKeyId || undefined,
            r2SecretAccessKey: r2SecretAccessKey || undefined,
            r2BucketName: r2BucketName || undefined,
          }),
        })
        : await fetch('/api/skill-tasks');

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load skill history');
      }

      setSkillHistory(data.tasks || []);
    } catch (err: unknown) {
      setSkillError(err instanceof Error ? err.message : 'Failed to load skill history');
    } finally {
      setIsSkillHistoryLoading(false);
    }
  }, [r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName]);

  const startSkillPolling = useCallback(async (nextTaskId: string) => {
    if (skillPollRef.current) clearInterval(skillPollRef.current);

    const poll = async () => {
      try {
        const statusRes = await fetch(`/api/skill-status/${nextTaskId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName }),
        });
        const statusData = await statusRes.json();
        if (!statusRes.ok) {
          throw new Error(statusData.error || 'Failed to fetch skill status');
        }
        setSkillStatus(statusData);

        if (statusData.status === 'completed' || statusData.status === 'failed') {
          if (skillPollRef.current) clearInterval(skillPollRef.current);
          await loadSkillHistory();
        }
      } catch {
        // 忽略輪詢錯誤，避免中斷前端使用
      }
    };

    await poll();
    skillPollRef.current = setInterval(poll, 3000);
  }, [loadSkillHistory, r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName]);

  const submitSkillGeneration = useCallback(async (params: {
    date: string;
    domain: string;
    provider: string;
    modelId: string;
    baseUrl?: string;
    customPrompt?: string;
  }) => {
    if (params.provider === 'openai-codex' && !codexAuth) {
      throw new Error('Please sign in with ChatGPT first');
    }
    if (params.provider !== 'openai-codex' && !skillApiKey) {
      throw new Error('Please enter an API key');
    }

    setSkillError('');
    setIsSkillSubmitting(true);
    setSkillStatus(null);
    setSelectedFolder(`${params.date}|${params.domain}`);

    try {
      const res = await fetch('/api/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: params.date,
          domain: params.domain,
          provider: params.provider,
          modelId: params.modelId,
          apiKey: params.provider === 'openai-codex' ? undefined : skillApiKey,
          baseUrl: params.provider === 'openai-codex' ? undefined : params.baseUrl,
          customPrompt: params.customPrompt || undefined,
          r2AccountId,
          r2AccessKeyId,
          r2SecretAccessKey,
          r2BucketName,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit');

      setSkillTaskId(data.taskId);
      await loadSkillHistory();
      await startSkillPolling(data.taskId);
      return data.taskId as string;
    } finally {
      setIsSkillSubmitting(false);
    }
  }, [codexAuth, loadSkillHistory, r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName, skillApiKey, startSkillPolling]);

  // Load configuration from localStorage on mount
  useEffect(() => {
    setIsMounted(true);
    const savedConfig = localStorage.getItem('docengineConfig');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        if (parsed.depthLimit !== undefined) setDepthLimit(parsed.depthLimit);
        if (parsed.maxConcurrency !== undefined) setMaxConcurrency(parsed.maxConcurrency);
        if (parsed.maxUrls !== undefined) setMaxUrls(parsed.maxUrls);
        if (parsed.maxRetries !== undefined) setMaxRetries(parsed.maxRetries);
        if (parsed.urlTimeout !== undefined) setUrlTimeout(parsed.urlTimeout);
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

        // Skill Generator API 配置
        if (parsed.skillAuthMode !== undefined) setSkillAuthMode(parsed.skillAuthMode);
        if (parsed.skillProvider !== undefined) setSkillProvider(parsed.skillProvider);
        if (parsed.skillModel !== undefined) setSkillModel(parsed.skillModel);
        if (parsed.skillApiKey !== undefined) setSkillApiKey(parsed.skillApiKey);
        if (parsed.skillBaseUrl !== undefined) setSkillBaseUrl(parsed.skillBaseUrl);
        if (parsed.skillUseCustomModel !== undefined) setSkillUseCustomModel(parsed.skillUseCustomModel);
        if (parsed.skillCustomModelId !== undefined) setSkillCustomModelId(parsed.skillCustomModelId);
      } catch (e) {
        console.error("Failed to parse config from localStorage", e);
      }
    }
  }, []);

  // registry 載入後，確保目前選擇的 provider / model 存在
  useEffect(() => {
    if (!piProviders || piProviders.length === 0) return;

    const providerInfo =
      piProviders.find((p) => p.id === skillProvider) ||
      piProviders.find((p) => p.id === 'openai') ||
      piProviders[0];

    if (!providerInfo) return;

    if (providerInfo.id !== skillProvider) {
      setSkillProvider(providerInfo.id);
      setSkillUseCustomModel(false);
      setSkillCustomModelId('');
      setSkillBaseUrl('');
    }

    const modelIds = new Set(providerInfo.models.map((m) => m.id));
    if (!modelIds.has(skillModel)) {
      const fallbackModel = providerInfo.models[0]?.id || '';
      setSkillModel(fallbackModel);
      setSkillUseCustomModel(false);
      setSkillCustomModelId('');
      setSkillBaseUrl('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piProviders]);

  // 載入 pi-ai 內建的 Provider / Model registry（用於 Skill Generator 下拉選單）
  useEffect(() => {
    let ignore = false;

    const loadPiModels = async () => {
      setIsPiProvidersLoading(true);
      setPiProvidersError('');
      try {
        const res = await fetch('/api/pi-models');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load pi-ai models');

        const providers = (data.providers || []) as PiProviderInfo[];
        if (!ignore) {
          setPiProviders(providers);
        }
      } catch (e: unknown) {
        if (!ignore) {
          setPiProvidersError(e instanceof Error ? e.message : 'Failed to load pi-ai models');
        }
      } finally {
        if (!ignore) setIsPiProvidersLoading(false);
      }
    };

    loadPiModels();
    return () => {
      ignore = true;
    };
  }, []);

  // Save configuration to localStorage on change
  useEffect(() => {
    if (isMounted) {
      const configObj = {
        depthLimit, maxConcurrency, maxUrls, maxRetries, urlTimeout, enableClean,
        firecrawlKey, llmApiKey, llmModelName, llmBaseUrl, cleaningPrompt,
        urlExtractorApiKey, urlExtractorBaseUrl, urlExtractorModel, urlExtractorPrompt,
        r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName,

        // Skill Generator API 配置
        skillAuthMode,
        skillProvider,
        skillModel,
        skillApiKey,
        skillBaseUrl,
        skillUseCustomModel,
        skillCustomModelId,
      };
      localStorage.setItem('docengineConfig', JSON.stringify(configObj));
    }
  }, [
    isMounted, depthLimit, maxConcurrency, maxUrls, maxRetries, urlTimeout, enableClean,
    firecrawlKey, llmApiKey, llmModelName, llmBaseUrl, cleaningPrompt,
    urlExtractorApiKey, urlExtractorBaseUrl, urlExtractorModel, urlExtractorPrompt,
    r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName,

    // Skill Generator API 配置
    skillAuthMode,
    skillProvider,
    skillModel,
    skillApiKey,
    skillBaseUrl,
    skillUseCustomModel,
    skillCustomModelId,
  ]);

  // Polling Effect
  useEffect(() => {
    if (!taskId) return;

    const fetchStatus = async () => {
      try {
        // 若有 R2 覆蓋配置，使用 POST 傳送認證；否則退回 GET
        const hasR2Overrides = r2AccountId || r2AccessKeyId || r2SecretAccessKey || r2BucketName;
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

  // 當 taskId 被設定時自動打開 Drawer
  useEffect(() => {
    if (taskId && (!taskStatus || taskStatus.status === 'processing')) {
      setDrawerOpen(true);
    }
  }, [taskId, taskStatus]);

  // Fetch History Tasks
  useEffect(() => {
    if (activeTab === 'tasks') {
      const loadTasks = async () => {
        setIsTasksLoading(true);
        try {
          const hasR2Overrides = r2AccountId || r2AccessKeyId || r2SecretAccessKey || r2BucketName;
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

  useEffect(() => {
    if (activeTab === 'skill') {
      loadSkillHistory();
    }
  }, [activeTab, loadSkillHistory]);

  useEffect(() => {
    return () => {
      if (skillPollRef.current) {
        clearInterval(skillPollRef.current);
      }
    };
  }, []);

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
        urlTimeout: urlTimeout ? parseInt(urlTimeout) : undefined,
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
        if (data.taskId && data.task && (!taskId || taskStatus?.status !== 'processing')) {
          setTaskStatus(data.task);
          setTaskId(data.taskId);
        }
        throw new Error(data.error || data.details || 'Scrape request failed');
      }

      if (data.taskId && data.task && (!taskId || taskStatus?.status !== 'processing')) {
        setTaskStatus(data.task);
        setTaskId(data.taskId);
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
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error occurred during crawl operation.');
    } finally {
      setIsCrawlingJob(false);
      setCrawlStatusText('');
    }
  };

  const calculateProgress = () => {
    if (!taskStatus || taskStatus.total === 0) return 0;
    return Math.round(((taskStatus.completed + taskStatus.failed) / taskStatus.total) * 100);
  };

  // === 中斷處理函式 ===
  const handleAbortSingle = useCallback(async (url: string) => {
    if (!taskId || abortingUrls.has(url)) return;
    setAbortingUrls(prev => new Set(prev).add(url));
    try {
      const es = {
        r2AccountId: r2AccountId || undefined,
        r2AccessKeyId: r2AccessKeyId || undefined,
        r2SecretAccessKey: r2SecretAccessKey || undefined,
        r2BucketName: r2BucketName || undefined,
      };
      await fetch('/api/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, urls: [url], engineSettings: es }),
      });
    } catch (e) {
      console.error('Abort failed:', e);
    } finally {
      setAbortingUrls(prev => {
        const next = new Set(prev);
        next.delete(url);
        return next;
      });
    }
  }, [taskId, abortingUrls, r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName]);

  // === 重試處理函式 ===
  const handleRetrySingle = useCallback(async (url: string) => {
    if (!taskId || retryingUrls.has(url)) return;
    setRetryingUrls(prev => new Set(prev).add(url));
    try {
      const es = {
        firecrawlKey: firecrawlKey || undefined,
        llmApiKey: llmApiKey || undefined,
        llmModel: llmModelName || undefined,
        llmBaseUrl: llmBaseUrl || undefined,
        cleaningPrompt: cleaningPrompt !== DEFAULT_CLEANING_PROMPT ? cleaningPrompt : undefined,
        enableClean,
        r2AccountId: r2AccountId || undefined,
        r2AccessKeyId: r2AccessKeyId || undefined,
        r2SecretAccessKey: r2SecretAccessKey || undefined,
        r2BucketName: r2BucketName || undefined,
      };
      await fetch('/api/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, urls: [url], engineSettings: es }),
      });
    } catch (e) {
      console.error('Retry failed:', e);
    } finally {
      setRetryingUrls(prev => {
        const next = new Set(prev);
        next.delete(url);
        return next;
      });
    }
  }, [taskId, retryingUrls, firecrawlKey, llmApiKey, llmModelName, llmBaseUrl, cleaningPrompt, enableClean, r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName]);

  const handleRetryAllFailed = useCallback(async () => {
    if (!taskId || !taskStatus?.urls) return;
    const failedList = taskStatus.urls.filter(u => u.status === 'failed').map(u => u.url);
    if (failedList.length === 0) return;
    setRetryingUrls(new Set(failedList));
    try {
      const es = {
        firecrawlKey: firecrawlKey || undefined,
        llmApiKey: llmApiKey || undefined,
        llmModel: llmModelName || undefined,
        llmBaseUrl: llmBaseUrl || undefined,
        cleaningPrompt: cleaningPrompt !== DEFAULT_CLEANING_PROMPT ? cleaningPrompt : undefined,
        enableClean,
        r2AccountId: r2AccountId || undefined,
        r2AccessKeyId: r2AccessKeyId || undefined,
        r2SecretAccessKey: r2SecretAccessKey || undefined,
        r2BucketName: r2BucketName || undefined,
      };
      await fetch('/api/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, urls: failedList, engineSettings: es }),
      });
    } catch (e) {
      console.error('Retry all failed:', e);
    } finally {
      setRetryingUrls(new Set());
    }
  }, [taskId, taskStatus, firecrawlKey, llmApiKey, llmModelName, llmBaseUrl, cleaningPrompt, enableClean, r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName]);

  const handleRetryTask = useCallback(async () => {
    if (!taskId || !taskStatus?.urls || taskStatus.urls.length === 0) return;

    const allUrls = taskStatus.urls.map((item) => item.url);
    setRetryingUrls(new Set(allUrls));
    try {
      const es = {
        firecrawlKey: firecrawlKey || undefined,
        llmApiKey: llmApiKey || undefined,
        llmModel: llmModelName || undefined,
        llmBaseUrl: llmBaseUrl || undefined,
        cleaningPrompt: cleaningPrompt !== DEFAULT_CLEANING_PROMPT ? cleaningPrompt : undefined,
        enableClean,
        r2AccountId: r2AccountId || undefined,
        r2AccessKeyId: r2AccessKeyId || undefined,
        r2SecretAccessKey: r2SecretAccessKey || undefined,
        r2BucketName: r2BucketName || undefined,
      };
      await fetch('/api/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, retryAll: true, engineSettings: es }),
      });
    } catch (e) {
      console.error('Retry task failed:', e);
    } finally {
      setRetryingUrls(new Set());
    }
  }, [taskId, taskStatus, firecrawlKey, llmApiKey, llmModelName, llmBaseUrl, cleaningPrompt, enableClean, r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName]);

  // 輔助函式：將異常或 0B 的檔案標示為失敗，以便重試
  const markKeysAsFailed = (failedList: { key: string, reason: string }[]) => {
    setTaskStatus(prev => {
      if (!prev || !prev.date || !prev.urls) return prev;
      const newUrls = prev.urls.map(item => {
        const keyCleaned = buildR2Key(item.url, 'cleaned', prev.date!);
        const keyRaw = buildR2Key(item.url, 'raw', prev.date!);
        const hit = failedList.find(f => f.key === keyCleaned || f.key === keyRaw);
        if (hit) {
          return { ...item, status: 'failed' as const, error: hit.reason };
        }
        return item;
      });
      return { ...prev, urls: newUrls };
    });
  };

  const fetchFileSizes = async () => {
    if (!taskStatus?.date) return;
    const firstSuccessUrl = taskStatus.urls?.find(u => u.status === 'success')?.url;
    if (!firstSuccessUrl) return;

    try {
      const domain = new URL(firstSuccessUrl).hostname;
       const hasR2Overrides = r2AccountId || r2AccessKeyId || r2SecretAccessKey || r2BucketName;
       const fetchOpts = {
         method: hasR2Overrides ? 'POST' : 'GET',
         headers: { 'Content-Type': 'application/json' },
         body: hasR2Overrides ? JSON.stringify({ r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName }) : undefined
       };

      const rawRes = await fetch(`/api/files?prefix=${encodeURIComponent(`raw/${taskStatus.date}/${domain}/`)}&limit=1000`, fetchOpts);
      const clnRes = await fetch(`/api/files?prefix=${encodeURIComponent(`cleaned/${taskStatus.date}/${domain}/`)}&limit=1000`, fetchOpts);

      const sizes: Record<string, number> = {};

      if (rawRes.ok) {
        const { files } = await rawRes.json();
        for (const file of files || []) sizes[file.key] = file.size;
      }
      if (clnRes.ok) {
        const { files } = await clnRes.json();
        for (const file of files || []) sizes[file.key] = file.size;
      }

      setFileSizes(prev => ({ ...prev, ...sizes }));
    } catch (e) {
      console.error('Failed to fetch file sizes', e);
    }
  };

  // 自動在 Drawer 開啟且有成功項目時 fetch 檔案大小
  useEffect(() => {
    if (drawerOpen && taskStatus?.urls?.some(u => u.status === 'success')) {
      fetchFileSizes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen, taskStatus?.status]);

  // === 檔案下載處理函式 ===
  const handleDownloadSingle = async (url: string, type: 'raw' | 'cleaned') => {
    if (!taskStatus?.date) return;
    const r2Config = { r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName };
    try {
      const key = buildR2Key(url, type, taskStatus.date);
      await downloadSingleFile(key, r2Config);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'File is empty or not found';
      console.error(`Download ${type} single failed:`, e);
      markKeysAsFailed([{ key: buildR2Key(url, type, taskStatus.date), reason: message }]);
      alert(`下載失敗: ${message || '檔案為空或無法存取'}`);
    }
  };

  const handleDownloadAll = async (type: 'raw' | 'cleaned') => {
    if (!taskStatus?.date) return;
    const firstSuccessUrl = taskStatus.urls?.find(u => u.status === 'success')?.url;
    if (!firstSuccessUrl) {
      alert('無成功解析的檔案可供下載。');
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      const parsed = new URL(firstSuccessUrl);
      const domain = parsed.hostname;
      const prefix = `${type}/${taskStatus.date}/${domain}/`;

      const r2Config = { r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName };

      const { failedKeys } = await downloadFolderAsZip(prefix, `Task-${taskId}-${domain}-${type}`, r2Config, (pct: number) => {
        setDownloadProgress(pct);
      });

      if (failedKeys && failedKeys.length > 0) {
        setTimeout(() => {
          alert(`下載完成，但有 ${failedKeys.length} 個檔案異常(如空檔 0B)。\n異常紀錄已寫入 ZIP 內的 download_errors.txt，並在原畫面上標示為 Failed 以利您後續點擊重試。`);
          markKeysAsFailed(failedKeys);
        }, 300);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '';
      console.error(`Download All ${type} failed:`, e);
      alert('批次下載發生錯誤，請稍後再試。\n' + message);
    } finally {
      setIsDownloading(false);
      setTimeout(() => setDownloadProgress(0), 1500);
    }
  };

  const handleCleanSingle = async (url: string) => {
    if (!taskStatus?.date) return;

    setIsLocalActionLoading(prev => { const n = new Set(prev); n.add(url); return n; });
    try {
      const engineSettings = { llmApiKey, llmModelName, llmBaseUrl, cleaningPrompt };
      const r2Overrides = { r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName };
      const res = await fetch('/api/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, date: taskStatus.date, engineSettings, r2Overrides })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to clean');
      alert(`LLM 清洗完成！結果大小: ${data.size} bytes`);
      fetchFileSizes();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown network error.';
      alert('清洗服務發生錯誤: ' + message);
    } finally {
      setIsLocalActionLoading(prev => { const n = new Set(prev); n.delete(url); return n; });
    }
  };

  return (
    <div className="text-gray-800 antialiased min-h-screen pb-16">
      {/* Header */}
      <header className="w-full flex justify-between items-center px-8 py-6 max-w-5xl mx-auto">
        <div className="text-2xl font-bold tracking-tight text-gray-900">
          DocEngine
        </div>
        <nav className="flex space-x-1 text-sm font-medium bg-[#F1EBE0] p-1 rounded-xl">
          {(['tasks', 'create', 'skill', 'storage', 'settings'] as const).map((tab) => {
            const labels = { tasks: 'Tasks', create: 'Create', skill: 'Skill', storage: 'Storage (R2)', settings: 'Settings' };
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
                              {getTaskDisplayDate(taskStatus)}
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

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Per-URL Timeout (sec)</label>
                        <input
                          value={urlTimeout}
                          onChange={(e) => setUrlTimeout(e.target.value)}
                          className="w-full bg-white border border-[#E5D5C5] rounded-xl px-4 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
                          placeholder="300"
                          type="number"
                          min="0"
                        />
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

        {/* ==================== SKILL GENERATOR TAB ==================== */}
        {activeTab === 'skill' && (
          <div className="bg-white rounded-[2rem] p-8 custom-shadow stacked-card relative border border-gray-100/50">
            <h1 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">Generate Skill</h1>
            <p className="text-sm text-gray-500 mb-8">Transform cleaned documentation into an Antigravity-compatible SKILL.md with references.</p>

            <div className="space-y-6">
              {/* === 認證模式選擇器 === */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">Authentication</label>
                <div className="flex space-x-3 mb-4">
                  <button
                    onClick={() => setSkillAuthMode('oauth')}
                    className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all border ${
                      skillAuthMode === 'oauth'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800 shadow-sm'
                        : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    🔐 Sign in with ChatGPT
                  </button>
                  <button
                    onClick={() => setSkillAuthMode('apikey')}
                    className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all border ${
                      skillAuthMode === 'apikey'
                        ? 'bg-amber-50 border-amber-200 text-amber-800 shadow-sm'
                        : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    🔑 Use API Key
                  </button>
                </div>

                {/* OAuth 模式 */}
                {skillAuthMode === 'oauth' && (
                  <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4">
                    {codexAuth?.loggedIn ? (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="inline-block w-2 h-2 bg-emerald-500 rounded-full" />
                          <span className="text-sm text-emerald-700 font-medium">Connected to ChatGPT (Codex)</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-emerald-800">
                        <p className="mb-2 font-semibold">⚠️ 未偵測到授權狀態</p>
                        <p>系統將無法自動打通 OpenAI，請確認：</p>
                        <ol className="list-decimal ml-4 mt-2 space-y-1 mb-3 text-xs opacity-90">
                          <li>在伺服器端執行 <code className="bg-white/50 px-1 rounded">npx @mariozechner/pi-ai login openai-codex</code></li>
                          <li>將產生的 <code>auth.json</code> 掛載至 <code>PI_AUTH_JSON_PATH</code> 路徑。</li>
                        </ol>
                        <button
                          onClick={async () => {
                            setSkillError('');
                            try {
                              const res = await fetch('/api/codex-auth');
                              if (res.ok) {
                                const data = await res.json();
                                setCodexAuth(data);
                                if (!data.loggedIn) setSkillError('尚未偵測到有效憑證，請確保 auth.json 已正確掛載。');
                              }
                            } catch (err: unknown) {
                              setSkillError(err instanceof Error ? err.message : 'Failed to check auth status');
                            }
                          }}
                          className="mt-1 w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors cursor-pointer"
                        >
                          ↻ 重新檢查授權狀態
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* API Key 模式 */}
                {skillAuthMode === 'apikey' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Provider</label>
                        <select
                          value={skillProvider}
                          onChange={(e) => {
                            const nextProvider = e.target.value;
                            setSkillProvider(nextProvider);

                            const providerInfo = piProviders.find((p) => p.id === nextProvider);
                            const firstModel = providerInfo?.models?.[0]?.id;
                            if (firstModel) setSkillModel(firstModel);

                            if (providerInfo?.id === 'openai-compatible') {
                              // openai-compatible：預設走自訂 modelId + 可覆蓋 baseUrl
                              setSkillUseCustomModel(true);
                              setSkillCustomModelId('gpt-4o');
                              setSkillBaseUrl(providerInfo.models?.[0]?.baseUrl || '');
                            } else {
                              setSkillUseCustomModel(false);
                              setSkillCustomModelId('');
                              setSkillBaseUrl('');
                            }
                          }}
                          className="w-full bg-[#FAF6F0] text-sm rounded-xl px-4 py-2.5 border border-gray-200 focus:border-amber-300 focus:outline-none"
                          disabled={isPiProvidersLoading || piProviders.length === 0}
                        >
                          {piProviders.length === 0 ? (
                            <option value={skillProvider}>
                              {isPiProvidersLoading ? 'Loading providers...' : 'No providers loaded'}
                            </option>
                          ) : (
                            piProviders.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.id} ({p.modelCount}){p.supportsCustomModel ? ' - OpenAI-compatible' : ''}
                              </option>
                            ))
                          )}
                        </select>
                        {piProvidersError && (
                          <div className="mt-1 text-xs text-red-600">{piProvidersError}</div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Model</label>
                        {selectedSkillProviderInfo?.supportsCustomModel && (
                          <label className="flex items-center gap-2 mb-1 text-[11px] text-gray-600 select-none">
                            <input
                              type="checkbox"
                              checked={skillUseCustomModel}
                              onChange={(e) => {
                                const next = e.target.checked;
                                setSkillUseCustomModel(next);
                                setSkillCustomModelId(next ? skillModel : '');
                              }}
                              className="w-3.5 h-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500 accent-violet-600"
                            />
                            Use custom model ID
                          </label>
                        )}

                        {skillUseCustomModel ? (
                          <input
                            type="text"
                            value={skillCustomModelId}
                            onChange={(e) => setSkillCustomModelId(e.target.value)}
                            placeholder="e.g. gpt-4o, glm-5.1"
                            className="w-full bg-[#FAF6F0] text-sm rounded-xl px-4 py-2.5 border border-gray-200 focus:border-amber-300 focus:outline-none"
                          />
                        ) : (
                          <select
                            value={skillModel}
                            onChange={(e) => setSkillModel(e.target.value)}
                            className="w-full bg-[#FAF6F0] text-sm rounded-xl px-4 py-2.5 border border-gray-200 focus:border-amber-300 focus:outline-none"
                            disabled={piProviders.length === 0 || selectedSkillProviderModels.length === 0}
                          >
                            {selectedSkillProviderModels.length === 0 ? (
                              <option value={skillModel}>No models</option>
                            ) : (
                              selectedSkillProviderModels.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name} ({m.id})
                                </option>
                              ))
                            )}
                          </select>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">API Key</label>
                      <input
                        type="password"
                        value={skillApiKey}
                        onChange={(e) => setSkillApiKey(e.target.value)}
                        placeholder="sk-... or your API key"
                        className="w-full bg-[#FAF6F0] text-sm rounded-xl px-4 py-2.5 border border-gray-200 focus:border-amber-300 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Base URL (Optional)</label>
                      <input
                        type="text"
                        value={skillBaseUrl}
                        onChange={(e) => setSkillBaseUrl(e.target.value)}
                        placeholder={selectedSkillModelInfo?.baseUrl || ''}
                        className="w-full bg-[#FAF6F0] text-sm rounded-xl px-4 py-2.5 border border-gray-200 focus:border-amber-300 focus:outline-none"
                      />
                      <div className="mt-1 text-[11px] text-gray-500">
                        Leave blank to use the provider default.
                      </div>
                    </div>
                    {/* === Skill LLM 連線測試按鈕 === */}
                    <div>
                      <button
                        onClick={async () => {
                          setIsSkillTesting(true);
                          setSkillTestResult(null);
                          try {
                            const res = await fetch('/api/test-llm', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                provider: skillProvider,
                                modelId: skillUseCustomModel ? skillCustomModelId.trim() : skillModel,
                                apiKey: skillApiKey || undefined,
                                baseUrl: skillBaseUrl.trim() || undefined,
                              }),
                            });
                            const data = await res.json();
                            if (data.success) {
                              setSkillTestResult({ success: true, message: `✅ Connected (${data.latencyMs}ms) — Model: ${data.model}`, latencyMs: data.latencyMs });
                            } else {
                              setSkillTestResult({ success: false, message: `❌ ${data.error}`, latencyMs: data.latencyMs });
                            }
                          } catch (err: unknown) {
                            setSkillTestResult({ success: false, message: `❌ ${err instanceof Error ? err.message : 'Network error'}` });
                          } finally {
                            setIsSkillTesting(false);
                          }
                        }}
                        disabled={isSkillTesting || (!skillApiKey && skillProvider !== 'openai-codex')}
                        className="w-full py-2 rounded-xl text-xs font-medium border border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5"
                      >
                        {isSkillTesting ? (
                          <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75"></path></svg> Testing...</>
                        ) : '🔗 Test LLM Connection'}
                      </button>
                      {skillTestResult && (
                        <div className={`mt-2 text-xs px-3 py-2 rounded-lg border ${
                          skillTestResult.success
                            ? 'bg-green-50 border-green-200 text-green-700'
                            : 'bg-red-50 border-red-200 text-red-700'
                        }`}>
                          {skillTestResult.message}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* === 資料夾選擇器 === */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Cleaned Folder</label>
                  <button
                    onClick={async () => {
                      setIsFoldersLoading(true);
                      try {
                        const res = await fetch('/api/list-cleaned-folders', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName,
                          }),
                        });
                        const data = await res.json();
                        if (data.folders) setAvailableFolders(data.folders);
                      } catch (err: unknown) {
                        setSkillError(err instanceof Error ? err.message : 'Failed to load folders');
                      } finally {
                        setIsFoldersLoading(false);
                      }
                    }}
                    className="text-xs text-amber-700 hover:text-amber-900 font-medium transition-colors"
                    disabled={isFoldersLoading}
                  >
                    {isFoldersLoading ? 'Loading...' : '↻ Refresh'}
                  </button>
                </div>
                <select
                  value={selectedFolder}
                  onChange={(e) => setSelectedFolder(e.target.value)}
                  className="w-full bg-[#FAF6F0] text-sm rounded-xl px-4 py-2.5 border border-gray-200 focus:border-amber-300 focus:outline-none"
                >
                  <option value="">Select a cleaned folder...</option>
                  {availableFolders.map((f) => (
                    <option key={f.prefix} value={`${f.date}|${f.domain}`}>
                      {f.domain} ({f.date}) — {f.fileCount} files{f.emptyFileCount > 0 ? ` (⚠ ${f.emptyFileCount} empty)` : ''}
                    </option>
                  ))}
                </select>
                {/* 0B 檔案警告提示 */}
                {selectedFolder && (() => {
                  const [selDate, selDomain] = selectedFolder.split('|');
                  const folder = availableFolders.find(f => f.date === selDate && f.domain === selDomain);
                  if (folder && folder.emptyFileCount > 0) {
                    return (
                      <div className="mt-2 text-xs px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 flex items-start gap-2">
                        <span className="text-base leading-none">⚠️</span>
                        <span>This folder contains <strong>{folder.emptyFileCount}</strong> empty (0B) file{folder.emptyFileCount > 1 ? 's' : ''}. These likely failed LLM cleaning. Consider re-cleaning before generating a skill.</span>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* === 自訂 Prompt（可收合） === */}
              <div>
                <button
                  onClick={() => setShowSkillPrompt(!showSkillPrompt)}
                  className="text-sm text-gray-500 hover:text-gray-700 font-medium flex items-center space-x-1 transition-colors"
                >
                  <span>{showSkillPrompt ? '▾' : '▸'}</span>
                  <span>Custom Generation Prompt</span>
                </button>
                {showSkillPrompt && (
                  <textarea
                    value={skillCustomPrompt}
                    onChange={(e) => setSkillCustomPrompt(e.target.value)}
                    placeholder="Optional: Add additional instructions for the LLM when generating the SKILL.md..."
                    rows={4}
                    className="mt-2 w-full bg-[#FAF6F0] text-sm rounded-xl px-4 py-3 border border-gray-200 focus:border-amber-300 focus:outline-none resize-none"
                  />
                )}
              </div>

              {/* === 生成按鈕 === */}
              <button
                onClick={async () => {
                  if (!selectedFolder) {
                    setSkillError('Please select a cleaned folder');
                    return;
                  }
                  if (skillAuthMode === 'apikey' && !skillApiKey) {
                    setSkillError('Please enter an API key');
                    return;
                  }
                  if (skillAuthMode === 'apikey' && skillUseCustomModel && !skillCustomModelId.trim()) {
                    setSkillError('Please enter a custom model id');
                    return;
                  }
                  if (skillAuthMode === 'oauth' && !codexAuth) {
                    setSkillError('Please sign in with ChatGPT first');
                    return;
                  }

                  try {
                    const [date, domain] = selectedFolder.split('|');
                    const isOAuth = skillAuthMode === 'oauth';
                    await submitSkillGeneration({
                      date,
                      domain,
                      provider: isOAuth ? 'openai-codex' : skillProvider,
                      modelId: isOAuth ? 'gpt-4o' : (skillUseCustomModel ? skillCustomModelId.trim() : skillModel),
                      baseUrl: isOAuth ? undefined : (skillBaseUrl.trim() || undefined),
                      customPrompt: skillCustomPrompt || undefined,
                    });
                  } catch (err: unknown) {
                    setSkillError(err instanceof Error ? err.message : 'Unknown error');
                  }
                }}
                disabled={isSkillSubmitting || !selectedFolder}
                className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-violet-200/50"
              >
                {isSkillSubmitting ? '⏳ Submitting...' : '✨ Generate Skill'}
              </button>

              {/* === 錯誤訊息 === */}
              {skillError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                  {skillError}
                </div>
              )}

              {/* === 進度面板 === */}
              {skillStatus && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-700">Generation Progress</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      skillStatus.status === 'completed' ? 'bg-green-100 text-green-700'
                      : skillStatus.status === 'failed' ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {skillStatus.status}
                    </span>
                  </div>

                  {/* 三步進度指示器 */}
                  <div className="flex items-center space-x-2 text-xs">
                    {['summarize', 'generate', 'refine', 'writing'].map((step, i) => {
                      const phases = ['summarize', 'generate', 'refine', 'writing', 'done'];
                      const currentIdx = phases.indexOf(skillStatus.phase);
                      const stepIdx = phases.indexOf(step);
                      const isDone = stepIdx < currentIdx;
                      const isCurrent = stepIdx === currentIdx;
                      return (
                        <React.Fragment key={step}>
                          {i > 0 && <div className={`flex-1 h-0.5 ${isDone ? 'bg-violet-400' : 'bg-gray-200'}`} />}
                          <div className={`px-2 py-1 rounded-lg font-medium ${
                            isDone ? 'bg-violet-100 text-violet-700'
                            : isCurrent ? 'bg-violet-500 text-white animate-pulse'
                            : 'bg-gray-100 text-gray-400'
                          }`}>
                            {step.charAt(0).toUpperCase() + step.slice(1)}
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>

                  {skillStatus.error && (
                    <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{skillStatus.error}</div>
                  )}

                  {/* 預覽區域 */}
                  {skillStatus.skillPreview && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">SKILL.md Preview</span>
                        <span className="text-xs text-gray-400">{skillStatus.fileCount} reference files</span>
                      </div>
                      <pre className="bg-white border border-gray-200 rounded-xl p-4 text-xs text-gray-700 overflow-auto max-h-96 whitespace-pre-wrap font-mono">
                        {skillStatus.skillPreview}
                      </pre>
                    </div>
                  )}

                  {/* 下載按鈕 */}
                  {skillStatus.status === 'completed' && (
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch('/api/skill-download', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              date: skillStatus.date,
                              domain: skillStatus.domain,
                              taskId: skillStatus.taskId,
                              r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName,
                            }),
                          });
                          if (!res.ok) throw new Error('Download failed');
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${skillStatus.domain}-skill.zip`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (err: unknown) {
                          setSkillError(err instanceof Error ? err.message : 'Download error');
                        }
                      }}
                      className="w-full py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-xl text-sm font-semibold transition-all"
                    >
                      📦 Download Skill (.zip)
                    </button>
                  )}
                </div>
              )}

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-700">History</div>
                    <div className="text-xs text-gray-500 mt-0.5">Each run is stored as an isolated version.</div>
                  </div>
                  <button
                    onClick={loadSkillHistory}
                    disabled={isSkillHistoryLoading}
                    className="text-xs text-violet-700 hover:text-violet-900 font-medium disabled:opacity-50"
                  >
                    {isSkillHistoryLoading ? 'Loading...' : '↻ Refresh'}
                  </button>
                </div>

                {isSkillHistoryLoading ? (
                  <div className="text-xs text-gray-500 py-4">Loading skill history...</div>
                ) : skillHistory.length === 0 ? (
                  <div className="text-xs text-gray-500 py-4">No skill history yet.</div>
                ) : (
                  <div className="space-y-3">
                    {skillHistory.map((item) => (
                      <div key={item.taskId} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                                item.status === 'completed' ? 'bg-green-100 text-green-700'
                                  : item.status === 'failed' ? 'bg-red-100 text-red-700'
                                    : 'bg-yellow-100 text-yellow-700'
                              }`}>
                                {item.status}
                              </span>
                              <span className="text-xs font-medium text-gray-700">{item.domain}</span>
                              <span className="text-[10px] text-gray-400 font-mono">{formatStoredDate(item.createdAt, true)}</span>
                            </div>
                            <div className="text-[11px] text-gray-500 mt-1 break-all">
                              {item.modelId ? `${item.provider || 'provider'} / ${item.modelId}` : (item.provider || 'Skill run')}
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono mt-1">Version: {item.taskId}</div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={async () => {
                                setRetryingSkillTaskIds((prev) => new Set(prev).add(item.taskId));
                                try {
                                  await submitSkillGeneration({
                                    date: item.date,
                                    domain: item.domain,
                                    provider: item.provider || skillProvider,
                                    modelId: item.modelId || skillModel,
                                    baseUrl: item.baseUrl || undefined,
                                    customPrompt: item.customPrompt || undefined,
                                  });
                                } catch (err: unknown) {
                                  setSkillError(err instanceof Error ? err.message : 'Retry failed');
                                } finally {
                                  setRetryingSkillTaskIds((prev) => {
                                    const next = new Set(prev);
                                    next.delete(item.taskId);
                                    return next;
                                  });
                                }
                              }}
                              disabled={isSkillSubmitting || retryingSkillTaskIds.has(item.taskId)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50"
                            >
                              {retryingSkillTaskIds.has(item.taskId) ? 'Retrying...' : 'Retry'}
                            </button>

                            <button
                              onClick={async () => {
                                setDownloadingSkillTaskIds((prev) => new Set(prev).add(item.taskId));
                                try {
                                  const res = await fetch('/api/skill-download', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      date: item.date,
                                      domain: item.domain,
                                      taskId: item.taskId,
                                      r2AccountId,
                                      r2AccessKeyId,
                                      r2SecretAccessKey,
                                      r2BucketName,
                                    }),
                                  });
                                  if (!res.ok) throw new Error('Download failed');

                                  const blob = await res.blob();
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `${item.domain}-${item.taskId.slice(0, 8)}-skill.zip`;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                } catch (err: unknown) {
                                  setSkillError(err instanceof Error ? err.message : 'Download error');
                                } finally {
                                  setDownloadingSkillTaskIds((prev) => {
                                    const next = new Set(prev);
                                    next.delete(item.taskId);
                                    return next;
                                  });
                                }
                              }}
                              disabled={item.status !== 'completed' || downloadingSkillTaskIds.has(item.taskId)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50"
                            >
                              {downloadingSkillTaskIds.has(item.taskId) ? 'Downloading...' : 'Download'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
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
                  {/* === LLM Content Cleaner 連線測試按鈕 === */}
                  <div className="border-t border-[#E5D5C5] pt-4">
                    <button
                      onClick={async () => {
                        setIsCleanerTesting(true);
                        setCleanerTestResult(null);
                        try {
                          const res = await fetch('/api/test-llm', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              apiKey: llmApiKey || undefined,
                              baseUrl: llmBaseUrl || undefined,
                              model: llmModelName,
                            }),
                          });
                          const data = await res.json();
                          if (data.success) {
                            setCleanerTestResult({ success: true, message: `✅ Connected (${data.latencyMs}ms) — Model: ${data.model}`, latencyMs: data.latencyMs });
                          } else {
                            setCleanerTestResult({ success: false, message: `❌ ${data.error}`, latencyMs: data.latencyMs });
                          }
                        } catch (err: unknown) {
                          setCleanerTestResult({ success: false, message: `❌ ${err instanceof Error ? err.message : 'Network error'}` });
                        } finally {
                          setIsCleanerTesting(false);
                        }
                      }}
                      disabled={isCleanerTesting}
                      className="w-full py-2 rounded-xl text-xs font-medium border border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5"
                    >
                      {isCleanerTesting ? (
                        <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75"></path></svg> Testing...</>
                      ) : '🔗 Test Connection'}
                    </button>
                    {cleanerTestResult && (
                      <div className={`mt-2 text-xs px-3 py-2 rounded-lg border ${
                        cleanerTestResult.success
                          ? 'bg-green-50 border-green-200 text-green-700'
                          : 'bg-red-50 border-red-200 text-red-700'
                      }`}>
                        {cleanerTestResult.message}
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
                  {/* === URL Extractor 連線測試按鈕 === */}
                  <div className="border-t border-[#E5D5C5] pt-4">
                    <button
                      onClick={async () => {
                        setIsExtractorTesting(true);
                        setExtractorTestResult(null);
                        try {
                          const res = await fetch('/api/test-llm', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              apiKey: urlExtractorApiKey || undefined,
                              baseUrl: urlExtractorBaseUrl || undefined,
                              model: urlExtractorModel,
                            }),
                          });
                          const data = await res.json();
                          if (data.success) {
                            setExtractorTestResult({ success: true, message: `✅ Connected (${data.latencyMs}ms) — Model: ${data.model}`, latencyMs: data.latencyMs });
                          } else {
                            setExtractorTestResult({ success: false, message: `❌ ${data.error}`, latencyMs: data.latencyMs });
                          }
                        } catch (err: unknown) {
                          setExtractorTestResult({ success: false, message: `❌ ${err instanceof Error ? err.message : 'Network error'}` });
                        } finally {
                          setIsExtractorTesting(false);
                        }
                      }}
                      disabled={isExtractorTesting}
                      className="w-full py-2 rounded-xl text-xs font-medium border border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5"
                    >
                      {isExtractorTesting ? (
                        <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75"></path></svg> Testing...</>
                      ) : '🔗 Test Connection'}
                    </button>
                    {extractorTestResult && (
                      <div className={`mt-2 text-xs px-3 py-2 rounded-lg border ${
                        extractorTestResult.success
                          ? 'bg-green-50 border-green-200 text-green-700'
                          : 'bg-red-50 border-red-200 text-red-700'
                      }`}>
                        {extractorTestResult.message}
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
                          {t.domainSummary && (
                            <span className="text-[10px] px-2.5 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700 font-medium">
                              {t.domainSummary}
                            </span>
                          )}
                          {t.date && (
                            <span className="text-xs text-gray-500 font-mono">
                              {getTaskDisplayDate(t)}
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
                          setDrawerOpen(true);
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

      {/* 浮動開啟 Drawer 按鈕 — 當有 taskId 但 Drawer 關閉時顯示 */}
      {taskId && !drawerOpen && (
        <button
          onClick={() => setDrawerOpen(true)}
          className="fixed bottom-6 right-6 z-30 flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-700 hover:to-amber-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
          Task Progress
          {taskStatus && taskStatus.status === 'processing' && (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
          )}
        </button>
      )}

      {/* ==================== TASK PROGRESS DRAWER ==================== */}
      {drawerOpen && taskId && (
        <>
          {/* 遮罩 */}
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity"
            onClick={() => setDrawerOpen(false)}
          />
          {/* 抽屜面板 */}
          <div className="fixed inset-y-0 right-0 w-full sm:w-[880px] bg-[#F8F5EE] shadow-2xl z-50 flex flex-col" style={{ animation: 'slideIn 0.3s ease-out' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5D5C5] bg-white">
              <div>
                <h2 className="text-lg font-bold text-gray-900 tracking-tight">Task Progress</h2>
                <p className="text-[10px] text-gray-400 font-mono mt-0.5">ID: {taskId}</p>
              </div>
              <div className="flex items-center gap-2">
                {taskStatus?.urls?.length && taskStatus.status !== 'processing' ? (
                  <button
                    onClick={handleRetryTask}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100 transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                    Retry Task
                  </button>
                ) : null}
                {taskStatus?.urls?.some(u => u.status === 'failed') && (
                  <button
                    onClick={handleRetryAllFailed}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                    Retry All Failed
                  </button>
                )}
                {taskStatus?.urls?.some(u => u.status === 'success') && (
                  <>
                    <button
                      onClick={() => fetchFileSizes()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-100 transition-all"
                      title="Refresh File Sizes"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh Sizes
                    </button>
                    <button
                      onClick={() => handleDownloadAll('raw')}
                      disabled={isDownloading}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-50 border border-stone-200 text-stone-700 rounded-lg text-xs font-medium hover:bg-stone-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Download All Raw Files as ZIP"
                    >
                      {isDownloading ? (
                        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle>
                          <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor" className="opacity-75"></path>
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                      )}
                      {isDownloading ? `${Math.round(downloadProgress)}%` : 'Raw ZIP'}
                    </button>
                    <button
                      onClick={() => handleDownloadAll('cleaned')}
                      disabled={isDownloading}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Download All Cleaned Files as ZIP"
                    >
                      {isDownloading ? (
                        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle>
                          <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor" className="opacity-75"></path>
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                      )}
                      {isDownloading ? `${Math.round(downloadProgress)}%` : 'Cleaned ZIP'}
                    </button>
                  </>
                )}
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>
            </div>

            {/* 進度條與統計 */}
            <div className="px-6 py-4 bg-white border-b border-[#E5D5C5]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-700">
                  {taskStatus ? `${taskStatus.completed + taskStatus.failed} / ${taskStatus.total}` : '0 / 0'}
                </span>
                <span className={`text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-wider font-bold border ${taskStatus?.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' :
                  taskStatus?.status === 'failed' ? 'bg-red-100 text-red-700 border-red-200' :
                    'bg-amber-100 text-amber-700 border-amber-200'
                  }`}>
                  {taskStatus?.status || 'pending'}
                </span>
              </div>
              <div className="w-full h-2 bg-[#E5D5C5] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${calculateProgress()}%` }}
                ></div>
              </div>
              <div className="flex gap-4 mt-2.5 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  <span className="text-gray-600 font-medium">{taskStatus?.completed || 0} success</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <span className="text-gray-600 font-medium">{taskStatus?.failed || 0} failed</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-gray-300"></span>
                  <span className="text-gray-600 font-medium">{Math.max(0, (taskStatus?.total || 0) - (taskStatus?.completed || 0) - (taskStatus?.failed || 0))} pending</span>
                </span>
              </div>
            </div>

            {/* URL 清單 */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {taskStatus?.urls && taskStatus.urls.length > 0 ? (
                <ul className="divide-y divide-[#E5D5C5]">
                  {taskStatus.urls.map((item, idx) => (
                    <li key={`${item.url}-${idx}`} className="px-6 py-3 flex items-center gap-3 hover:bg-white/60 transition-colors">
                      {/* 狀態圖示 */}
                      <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                        {item.status === 'pending' ? (
                          <span className="w-2.5 h-2.5 rounded-full bg-gray-300 border border-gray-400"></span>
                        ) : item.status === 'processing' ? (
                          <svg className="animate-spin w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle>
                            <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor" className="opacity-75"></path>
                          </svg>
                        ) : item.status === 'success' ? (
                          <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
                        ) : (
                          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                        )}
                      </div>
                      {/* URL 與錯誤訊息與尺寸 */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 break-all font-mono leading-relaxed">{item.url}</p>
                        {item.status === 'failed' && item.error && (
                          <p className="text-[10px] text-red-500 break-all mt-0.5">{item.error}</p>
                        )}
                        {item.status === 'success' && taskStatus.date && (() => {
                          const rawSize = fileSizes[buildR2Key(item.url, 'raw', taskStatus.date)];
                          const clnSize = fileSizes[buildR2Key(item.url, 'cleaned', taskStatus.date)];
                          return (
                            <p className="text-[10px] font-mono mt-0.5 tracking-tight flex items-center gap-2">
                              <span className={rawSize === 0 ? 'text-red-500 font-bold' : 'text-gray-400'}>
                                Raw: {rawSize !== undefined ? (rawSize === 0 ? '⚠ 0 B' : `${(rawSize / 1024).toFixed(1)} KB`) : 'N/A'}
                              </span>
                              <span className="text-gray-300">|</span>
                              <span className={clnSize === 0 ? 'text-amber-500 font-bold' : 'text-gray-400'}>
                                Cleaned: {clnSize !== undefined ? (clnSize === 0 ? '⚠ 0 B' : `${(clnSize / 1024).toFixed(1)} KB`) : 'N/A'}
                              </span>
                            </p>
                          );
                        })()}
                      </div>
                      {/* 狀態標籤 */}
                      <span className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold ${item.status === 'pending' ? 'bg-gray-100 text-gray-500 border border-gray-200' :
                        item.status === 'processing' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                          item.status === 'success' ? 'bg-green-100 text-green-700 border border-green-200' :
                            'bg-red-100 text-red-700 border border-red-200'
                        }`}>
                        {item.status}
                      </span>
                      {/* 中斷按鈕（pending / processing） */}
                      {(item.status === 'pending' || item.status === 'processing') && (
                        <button
                          onClick={() => handleAbortSingle(item.url)}
                          disabled={abortingUrls.has(item.url)}
                          className="flex-shrink-0 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Abort this URL"
                        >
                          {abortingUrls.has(item.url) ? (
                            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle>
                              <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor" className="opacity-75"></path>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></rect></svg>
                          )}
                        </button>
                      )}
                      {/* 單筆重試按鈕 */}
                      {item.status === 'failed' && (
                        <button
                          onClick={() => handleRetrySingle(item.url)}
                          disabled={retryingUrls.has(item.url)}
                          className="flex-shrink-0 p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Retry this URL"
                        >
                          {retryingUrls.has(item.url) ? (
                            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle>
                              <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor" className="opacity-75"></path>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                          )}
                        </button>
                      )}
                      {/* 單筆資料操作：Cleaned, Raw 獨立按鈕與 LLM Clean */}
                      {item.status === 'success' && (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleCleanSingle(item.url)}
                            disabled={isLocalActionLoading.has(item.url)}
                            className="flex-shrink-0 text-[10px] font-medium px-2 py-1 text-purple-600 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-md transition-all disabled:opacity-50"
                            title="Force LLM Clean on this raw file"
                          >
                            {isLocalActionLoading.has(item.url) ? '...' : '✨ Clean'}
                          </button>
                          <div className="h-4 w-px bg-gray-200 mx-0.5"></div>
                          <button
                            onClick={() => handleDownloadSingle(item.url, 'raw')}
                            className="flex-shrink-0 text-[10px] font-medium px-2 py-1 text-stone-600 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-md transition-all"
                            title="Download Raw MD"
                          >
                            Raw
                          </button>
                          <button
                            onClick={() => handleDownloadSingle(item.url, 'cleaned')}
                            className="flex-shrink-0 text-[10px] font-medium px-2 py-1 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md transition-all"
                            title="Download Cleaned MD"
                          >
                            Cleaned
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex items-center justify-center h-full py-16 opacity-50">
                  <div className="text-center">
                    <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                    <p className="text-sm text-gray-400">Waiting for URL data...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Drawer 底部 */}
            <div className="px-6 py-3 border-t border-[#E5D5C5] bg-white flex items-center justify-between">
              <span className="text-[10px] text-gray-400">
                {taskStatus ? getTaskDisplayDate(taskStatus) : ''}
              </span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="px-4 py-1.5 text-xs font-medium text-gray-600 bg-[#F1EBE0] hover:bg-[#E5D5C5] rounded-lg transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
