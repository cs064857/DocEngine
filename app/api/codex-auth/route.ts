import { NextResponse } from 'next/server';
import { checkCodexAuthStatus } from '@/lib/oauth/pi-auth';

// 取得目前伺服器端的 Codex OAuth 授權狀態
export async function GET() {
  try {
    const status = checkCodexAuthStatus();
    return NextResponse.json(status);
  } catch (error: any) {
    console.error('[API] codex-auth error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal error' },
      { status: 500 }
    );
  }
}
