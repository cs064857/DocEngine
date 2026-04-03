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
  date: string;
}

export default function CrawlDocsFrontend() {
  const [sourceType, setSourceType] = useState<'sitemap' | 'manual'>('sitemap');
  const [inputValue, setInputValue] = useState('');
  
  // Advanced parameters
  const [depthLimit, setDepthLimit] = useState('0');
  const [maxConcurrency, setMaxConcurrency] = useState('2');
  const [maxUrls, setMaxUrls] = useState('1000');
  const [enableClean, setEnableClean] = useState(true);
  
  // Job Tracking
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<JobTask | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Polling Effect
  useEffect(() => {
    if (!taskId) return;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/status/${taskId}`);
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

    // Poll every 3 seconds
    const interval = setInterval(fetchStatus, 3000);
    fetchStatus(); // initial call

    return () => clearInterval(interval);
  }, [taskId]);

  const handleSubmit = async () => {
    if (!inputValue.trim()) {
      setErrorMsg("Please provide a Sitemap URL or a list of URLs.");
      return;
    }

    setErrorMsg('');
    setIsSubmitting(true);
    setTaskStatus(null);
    setTaskId(null);

    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputValue }),
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
        <nav className="flex space-x-6 text-sm font-medium">
          <a className="text-gray-500 hover:text-gray-900 transition-colors" href="#">Tasks</a>
          <a className="text-amber-700 border-b-2 border-amber-700 pb-1" href="#">Create</a>
          <a className="text-gray-500 hover:text-gray-900 transition-colors" href="#">Storage (R2)</a>
          <a className="text-gray-500 hover:text-gray-900 transition-colors" href="#">Settings</a>
        </nav>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 mt-4 relative z-10">
        
        {/* Main Card */}
        <div className="bg-white rounded-[2rem] p-8 custom-shadow stacked-card relative border border-gray-100/50">
          <h1 className="text-3xl font-bold text-gray-900 mb-8 tracking-tight">Create Crawling Task</h1>
          
          {/* Source Toggle */}
          <div className="flex bg-[#F1EBE0] p-1 rounded-xl mb-6 relative">
            <button 
              onClick={() => setSourceType('sitemap')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg relative overflow-hidden transition-all ${sourceType === 'sitemap' ? 'bg-white shadow-sm border border-orange-100/50 text-amber-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <span className="relative z-10">Sitemap URL</span>
              {sourceType === 'sitemap' && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-orange-100/30 to-transparent"></div>}
            </button>
            <button 
              onClick={() => setSourceType('manual')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg relative overflow-hidden transition-all ${sourceType === 'manual' ? 'bg-white shadow-sm border border-orange-100/50 text-amber-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <span className="relative z-10">Manual URLs List</span>
              {sourceType === 'manual' && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-orange-100/30 to-transparent"></div>}
            </button>
          </div>

          {/* Input Box */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="source-input">
              {sourceType === 'sitemap' ? 'Sitemap / Target URL' : 'List of URLs (comma or newline separated)'}
            </label>
            
            {sourceType === 'sitemap' ? (
               <input 
                 id="source-input"
                 value={inputValue}
                 onChange={(e) => setInputValue(e.target.value)}
                 className="w-full bg-white border border-[#D5C5B5] rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:ring-amber-500 focus:border-amber-500 shadow-sm outline-none" 
                 placeholder="https://example.com/sitemap.xml" 
                 type="text"
               />
            ) : (
               <textarea 
                 id="source-input"
                 value={inputValue}
                 onChange={(e) => setInputValue(e.target.value)}
                 className="w-full bg-white border border-[#D5C5B5] rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:ring-amber-500 focus:border-amber-500 shadow-sm outline-none resize-y min-h-[100px]" 
                 placeholder="https://example.com/page1&#10;https://example.com/page2" 
               />
            )}
            
            <p className="text-xs text-gray-400 mt-1">
               {sourceType === 'sitemap' ? 'Target XML mapping for full site extraction' : 'Provide exact links to be processed instantly.'}
            </p>
          </div>

          {/* Status Configuration Layout */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Depth Limit</label>
              <select 
                value={depthLimit}
                onChange={(e) => setDepthLimit(e.target.value)}
                className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-xl px-4 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none"
              >
                <option value="0">0 (Infinite)</option>
                <option value="1">1 Layer</option>
                <option value="2">2 Layers</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Save Format</label>
              <select className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-xl px-4 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none">
                <option>Markdown (RAG)</option>
                <option disabled>JSON (Metadata)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Storage</label>
              <select className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-xl px-4 py-2 text-sm text-gray-700 focus:ring-amber-500 focus:border-amber-500 outline-none">
                <option>Cloudflare R2</option>
              </select>
            </div>
          </div>

          {/* Tracker Board replacing Video Preview */}
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
                       <span className="bg-amber-600/20 text-amber-500 text-xs px-3 py-1 rounded-full uppercase tracking-wider font-semibold border border-amber-600/40">
                         {taskStatus?.status === 'completed' ? 'Finished' : taskStatus?.status === 'failed' ? 'Failed' : 'Processing'}
                       </span>
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
                     <div className="mt-auto grid grid-cols-3 gap-4 pb-2">
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
                   </div>
                </div>
             )}
          </div>
          
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
              <span className="font-bold">Error:</span> {errorMsg}
            </div>
          )}

          {/* Advanced Settings */}
          <div className="bg-[#F8F5EE] rounded-2xl p-6 border border-[#E5D5C5]">
            <div className="flex justify-between items-center mb-6 cursor-pointer">
              <h2 className="text-lg font-semibold text-gray-800">Advanced Engine Settings</h2>
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path></svg>
            </div>
            
            <div className="grid grid-cols-12 gap-8">
              {/* Left Column */}
              <div className="col-span-5 space-y-6">
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
              
              {/* Right Column: AI APIs Mapping */}
              <div className="col-span-7 space-y-4">
                <div className="bg-white rounded-xl p-4 border border-[#E5D5C5]">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Scraping Processor</h3>
                  <input readOnly value="********************" className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-lg px-3 py-2 text-sm text-gray-400 mb-3" type="password" />
                  <label className="block text-xs font-medium text-gray-700 mb-1">Provider Engine</label>
                  <select className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-lg px-3 py-2 text-sm text-gray-700 appearance-none outline-none">
                    <option>Firecrawl (mendable)</option>
                  </select>
                </div>
                
                <div className="bg-white rounded-xl p-4 border border-[#E5D5C5]">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">LLM Content Cleaner</h3>
                  <input readOnly value="********************" className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-lg px-3 py-2 text-sm text-gray-400 mb-3" type="password" />
                  <label className="block text-xs font-medium text-gray-700 mb-1">Active Model</label>
                  <select className="w-full bg-[#F8F5EE] border border-[#E5D5C5] rounded-lg px-3 py-2 text-sm text-gray-700 appearance-none outline-none">
                    <option>glm-4-flash (DeepSeek Compatible)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Action */}
          <button 
             onClick={handleSubmit}
             disabled={isSubmitting}
             className={`w-full mt-8 ${isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-[#B04111] to-[#D95517] hover:from-[#9c390f] hover:to-[#c24b14]'} text-white font-medium py-3.5 rounded-xl shadow-md transition-colors text-sm`}
          >
            {isSubmitting ? 'Starting Engine...' : 'Initialize Crawl'}
          </button>
        </div>
      </main>
    </div>
  );
}
