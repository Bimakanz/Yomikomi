import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseMangaProvider } from './base.provider.js';
import {
  MangaSummary,
  MangaDetail,
  ChapterItem,
  ChapterPage,
  ProviderFilterOptions,
  ComicType
} from '../types/manga.js';
import { getProxiedImageUrl } from '../utils/image-proxy.js';
import { globalCache } from '../utils/cache.js';

/**
 * English Manga & Manhwa Provider (Consumet / English Scanlations Engine)
 * High speed, zero headless browser, serverless-friendly English reader.
 */
export class ConsumetProvider extends BaseMangaProvider {
  readonly source = 'consumet';
  readonly displayName = 'Consumet / English Scanlations';
  readonly defaultLanguage = 'en';

  readonly baseUrl: string =
    process.env.CONSUMET_MANGA_BASE_URL?.trim() || 'https://mangapill.com';

  private detectType(title: string, rawText?: string): ComicType {
    const combined = `${title} ${rawText || ''}`.toLowerCase();
    if (combined.includes('manhwa')) return 'manhwa';
    if (combined.includes('manhua')) return 'manhua';
    return 'manga';
  }

  private extractSlug(href: string): string {
    const clean = href.replace(/\/+$/, '');
    return clean.replace(/^.*\/manga\//, '');
  }

  /**
   * 1. Search English Comics
   */
  async search(query: string, options: ProviderFilterOptions = {}): Promise<MangaSummary[]> {
    return this.withTimeout(this.internalSearch(query, options));
  }

  private async internalSearch(query: string, options: ProviderFilterOptions): Promise<MangaSummary[]> {
    if (!query || !query.trim()) return [];

    const cacheKey = `en_search_${query.trim().toLowerCase()}`;
    const cached = globalCache.get<MangaSummary[]>(cacheKey);
    if (cached) return cached;

    const searchUrl = `${this.baseUrl}/search?q=${encodeURIComponent(query.trim())}`;

    try {
      const res = await axios.get(searchUrl, {
        headers: this.getStandardHeaders(),
        timeout: this.timeoutMs
      });
      const $ = cheerio.load(res.data);
      const results: MangaSummary[] = [];

      $('a[href*="/manga/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (href.includes('/chapters')) return;

        const title =
          $(el).find('div.leading-tight, .text-sm, h5').text().trim() ||
          $(el).text().trim();
        const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
        const typeBadge = $(el).find('.uppercase, .badge').text().trim();

        if (href && title && !results.some(r => r.slug === this.extractSlug(href))) {
          const slug = this.extractSlug(href);
          results.push({
            id: slug,
            slug,
            source: this.source,
            title,
            coverUrl: getProxiedImageUrl(img, this.baseUrl),
            type: this.detectType(title, typeBadge)
          });
        }
      });

      globalCache.set(cacheKey, results, 10 * 60 * 1000);
      return results;
    } catch {
      return [];
    }
  }

  /**
   * 2. Get Popular or Latest English Manhwa / Manga
   */
  async getPopularOrLatest(
    type: 'popular' | 'latest' = 'popular',
    options: ProviderFilterOptions = {}
  ): Promise<MangaSummary[]> {
    return this.withTimeout(this.internalGetPopularOrLatest(type, options));
  }

  private async internalGetPopularOrLatest(
    type: 'popular' | 'latest',
    options: ProviderFilterOptions
  ): Promise<MangaSummary[]> {
    const page = options.page || 1;
    const cacheKey = `en_${type}_p${page}`;
    const cached = globalCache.get<MangaSummary[]>(cacheKey);
    if (cached) return cached;

    const targetUrl =
      type === 'popular'
        ? `${this.baseUrl}/mangas/popular?page=${page}`
        : `${this.baseUrl}/mangas/new?page=${page}`;

    try {
      const res = await axios.get(targetUrl, {
        headers: this.getStandardHeaders(),
        timeout: this.timeoutMs
      });
      const $ = cheerio.load(res.data);
      const results: MangaSummary[] = [];

      $('a[href*="/manga/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (href.includes('/chapters')) return;

        const title =
          $(el).find('div.leading-tight, .text-sm, h5').text().trim() ||
          $(el).text().trim();
        const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';

        if (href && title && !results.some(r => r.slug === this.extractSlug(href))) {
          const slug = this.extractSlug(href);
          results.push({
            id: slug,
            slug,
            source: this.source,
            title,
            coverUrl: getProxiedImageUrl(img, this.baseUrl),
            type: this.detectType(title)
          });
        }
      });

      globalCache.set(cacheKey, results, 10 * 60 * 1000);
      return results;
    } catch {
      return [];
    }
  }

  /**
   * 3. Get Comic Detail & Chapters (English)
   */
  async getDetailAndChapters(slug: string): Promise<MangaDetail> {
    return this.withTimeout(this.internalGetDetailAndChapters(slug));
  }

  private async internalGetDetailAndChapters(slug: string): Promise<MangaDetail> {
    const cacheKey = `en_detail_${slug}`;
    const cached = globalCache.get<MangaDetail>(cacheKey);
    if (cached) return cached;

    const detailUrl = slug.startsWith('http')
      ? slug
      : `${this.baseUrl}/manga/${slug}`;

    const res = await axios.get(detailUrl, {
      headers: this.getStandardHeaders(),
      timeout: this.timeoutMs
    });

    const $ = cheerio.load(res.data);
    const title = $('h1').first().text().trim();
    const synopsis = $('p.text-sm, .description').first().text().trim();

    const imgEl = $('img.object-cover, .cover-img').first();
    const coverRaw = imgEl.attr('data-src') || imgEl.attr('src') || '';
    const statusText = $('div:contains("Status")').text().toLowerCase();
    const status = statusText.includes('publishing') || statusText.includes('ongoing')
      ? 'ongoing'
      : statusText.includes('completed')
      ? 'completed'
      : 'unknown';

    // Genres
    const genres: string[] = [];
    $('a[href*="/genre/"], a[href*="/category/"]').each((_, el) => {
      genres.push($(el).text().trim());
    });

    // Chapters
    const chapters: ChapterItem[] = [];
    $('a[href*="/chapters/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const rawTitle = $(el).text().replace(/\s+/g, ' ').trim();

      if (href) {
        const numMatch = rawTitle.match(/chapter\s*([\d.]+)/i) || href.match(/chapter-([\d.]+)/i);
        const number = numMatch ? numMatch[1] : (chapters.length + 1).toString();
        const chId = href.replace(/\/+$/, '').split('/').pop() || '';

        chapters.push({
          id: chId,
          number,
          title: `Chapter ${number}`,
          source: this.source,
          language: 'en'
        });
      }
    });

    const result: MangaDetail = {
      id: slug,
      slug,
      source: this.source,
      title: title || slug,
      coverUrl: getProxiedImageUrl(coverRaw, detailUrl),
      type: this.detectType(title, genres.join(' ')),
      altTitles: [],
      synopsis: synopsis || 'No description available.',
      status,
      genres,
      chapters
    };

    globalCache.set(cacheKey, result, 15 * 60 * 1000);
    return result;
  }

  /**
   * 4. Get Chapter Pages (English)
   */
  async getChapterImages(chapterId: string): Promise<ChapterPage[]> {
    return this.withTimeout(this.internalGetChapterImages(chapterId));
  }

  private async internalGetChapterImages(chapterId: string): Promise<ChapterPage[]> {
    const cacheKey = `en_pages_${chapterId}`;
    const cached = globalCache.get<ChapterPage[]>(cacheKey);
    if (cached) return cached;

    const chapterUrl = chapterId.startsWith('http')
      ? chapterId
      : `${this.baseUrl}/chapters/${chapterId}`;

    const res = await axios.get(chapterUrl, {
      headers: this.getStandardHeaders(),
      timeout: this.timeoutMs
    });

    const $ = cheerio.load(res.data);
    const pages: ChapterPage[] = [];

    $('chapter-page img, img[data-src], .reader-page img').each((idx, el) => {
      const directUrl = $(el).attr('data-src') || $(el).attr('src') || '';
      if (directUrl && (directUrl.includes('.jpg') || directUrl.includes('.jpeg') || directUrl.includes('.webp') || directUrl.includes('.png'))) {
        pages.push({
          pageNumber: idx + 1,
          imageUrl: directUrl,
          proxiedUrl: getProxiedImageUrl(directUrl, chapterUrl),
          referer: chapterUrl
        });
      }
    });

    globalCache.set(cacheKey, pages, 15 * 60 * 1000);
    return pages;
  }
}
