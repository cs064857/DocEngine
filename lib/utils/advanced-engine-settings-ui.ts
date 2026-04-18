export type SourceType = 'scrape' | 'crawl' | 'map';

export function shouldShowAdvancedEngineSettings(sourceType: SourceType): boolean {
  switch (sourceType) {
    case 'scrape':
    case 'crawl':
    case 'map':
      return true;
  }
}

export function getAdvancedEngineSettingsHint(sourceType: SourceType): string | null {
  if (sourceType !== 'scrape') {
    return null;
  }

  return 'Batch only in Scrape mode: multiple URLs or sitemap use /api/crawl. Single URL preview uses /api/scrape and ignores these settings.';
}
