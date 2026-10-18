import {
  MangaSummary,
  MangaDetail,
  ChapterPage,
  ProviderFilterOptions,
  MangaSource
} from '../types/manga.js';

/**
 * Base Manga Provider (Adapter Pattern)
 * Every content provider (MangaDex, Komiku, Consumet) must implement this contract.
 */
export abstract class BaseMangaProvider {
  /** Unique provider key */
  abstract readonly source: MangaSource;

  /** Human-readable provider name */
  abstract readonly displayName: string;

  /** Base URL for web scraping or API endpoint */
  abstract readonly baseUrl: string;

  /** Primary language provided by this source */
  abstract readonly defaultLanguage: string;

  /** Maximum execution timeout per provider (default: 8000ms for serverless safety) */
  protected readonly timeoutMs: number = 8000;

  /**
   * Search comics by title or keyword
   */
  abstract search(query: string, options?: ProviderFilterOptions): Promise<MangaSummary[]>;

  /**
   * Get trending, popular, or recently updated comics
   */
  abstract getPopularOrLatest(
    type?: 'popular' | 'latest',
    options?: ProviderFilterOptions
  ): Promise<MangaSummary[]>;

  /**
   * Get full comic detail, metadata, and complete chapter list
   */
  abstract getDetailAndChapters(idOrSlug: string): Promise<MangaDetail>;

  /**
   * Extract image pages for a specific chapter
   */
  abstract getChapterImages(chapterIdOrSlug: string): Promise<ChapterPage[]>;

  /**
   * Helper: Wraps any promise with an 8-second timeout to prevent serverless hanging
   */
  protected async withTimeout<T>(promise: Promise<T>, customTimeoutMs?: number): Promise<T> {
    const timeout = customTimeoutMs || this.timeoutMs;
    let timer: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`[Provider Timeout] ${this.displayName} timed out after ${timeout}ms`));
      }, timeout);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timer!);
      return result;
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Standard browser headers to avoid anti-bot blocks
   */
  protected getStandardHeaders(customReferer?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'id,en-US;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };

    if (customReferer) {
      headers['Referer'] = customReferer;
    } else if (this.baseUrl) {
      headers['Referer'] = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    }

    return headers;
  }
}
