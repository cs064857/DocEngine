/**
 * Generates a standard UUID
 */
export function generateTaskId(): string {
  return crypto.randomUUID();
}

/**
 * Format date as YYYYMMDD
 */
export function formatDate(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Extract an appropriate R2 path from a given URL to avoid crazy file structures
 */
export function buildR2Key(url: string, subdir: 'raw' | 'cleaned', date: string): string {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    // 保留 URL 路徑層級作為 R2 資料夾結構，僅移除首尾斜線
    let path = parsed.pathname.replace(/^\/|\/$/g, '');
    if (!path) {
      path = 'index';
    }

    // Add missing extension
    if (!path.endsWith('.md') && !path.endsWith('.html')) {
      path += '.md';
    } else if (path.endsWith('.html')) {
      path = path.replace(/\.html$/, '.md');
    }

    return `${subdir}/${date}/${domain}/${path}`;
  } catch {
    // Fallback for weird strings
    const randomName = Math.random().toString(36).substring(7);
    return `${subdir}/${date}/unknown_domain/${randomName}.md`;
  }
}
