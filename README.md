# DocEngine

DocEngine is a powerful, AI-driven web crawling and content processing engine designed to transform the messy web into high-quality, structured Markdown ready for RAG (Retrieval-Augmented Generation).

## 🚀 Features

- **Multi-Source Ingestion**: Scrape single pages, map entire domains, or crawl recursively.
- **AI Content Cleaning**: Uses advanced LLMs to remove noise (headers, footers, ads) and improve document structure.
- **Cloudflare R2 Integration**: Seamlessly store raw and processed content in S3-compatible storage.
- **Asynchronous Workflows**: Built on Vercel Queues for high-concurrency, robust task execution.
- **Real-time Monitoring**: Interactive dashboard to track progress, retry failed URLs, and manage storage.

## 🛠️ Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## 🏗️ Architecture

DocEngine is built with Next.js 15 and follows a specialized processing pipeline:

1. **Fetch**: Content retrieval via Firecrawl.
2. **Clean**: LLM-based noise reduction and formatting.
3. **Store**: Dual-tier storage (Raw & Cleaned) in Cloudflare R2.

For technical details, see the [.blueprint](.blueprint/README.md) directory.
