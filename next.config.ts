import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
  serverExternalPackages: ['@mariozechner/pi-ai', '@vercel/queue'],
};

export default nextConfig;
