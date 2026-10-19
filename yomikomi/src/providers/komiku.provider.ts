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

export class KomikuProvider extends BaseMangaProvider {
  readonly source = 'komiku';
  readonly displayName = 'Komiku (Indo Scan)';
  readonly defaultLanguage = 'id';

  readonly baseUrl: string =
    process.env.KOMIKU_BASE_URL?.trim() || 'https://komiku.org';
  readonly searchBaseUrl: string =
    process.env.KOMIKU_SEARCH_URL?.trim() || 'https://api.komiku.org';

  private extractSlugFromUrl(url: string): string {
    const clean = url.replace(/\/+$/, '');
    const parts = clean.split('/');
    return parts[parts.length - 1];
  }

  private detectType(title: string, rawText?: string): ComicType {
    const combined = `${title} ${rawText || ''}`.toLowerCase();
    if (combined.includes('manhwa')) return 'manhwa';
    if (combined.includes('manhua')) return 'manhua';
    return 'manga';
  }

  /**
   * 1. Search comics on Komiku by keyword
   */
  async search(query: string, options: ProviderFilterOptions = {}): Promise<MangaSummary[]> {
    return this.withTimeout(this.internalSearch(query, options));
  }

  private async internalSearch(query: string, _options: ProviderFilterOptions): Promise<MangaSummary[]> {
    if (!query || !query.trim()) return [];

    const cacheKey = `komiku_search_${query.trim().toLowerCase()}`;
    const cached = globalCache.get<MangaSummary[]>(cacheKey);
    if (cached) return cached;

    const executeScrape = async (q: string) => {
      const searchUrl = `${this.searchBaseUrl}/?post_type=manga&s=${encodeURIComponent(q)}`;
      const res = await axios.get(searchUrl, {
        headers: this.getStandardHeaders('https://komiku.org/'),
        timeout: this.timeoutMs
      });
      const $ = cheerio.load(res.data);
      const results: MangaSummary[] = [];

      $('.bge').each((_, el) => {
        const linkEl = $(el).find('a').first();
        const href = linkEl.attr('href') || '';
        const title = $(el).find('h3, .tt').first().text().trim() || linkEl.attr('title') || '';
        const imgEl = $(el).find('img').first();
        const coverRaw = imgEl.attr('data-src') || imgEl.attr('src') || '';
        const typeBadge = $(el).find('.tpe1_inf, .type').first().text().trim();
        const lastChapter = $(el).find('.new1, .epx, .lsch').first().text().trim().replace(/awal:\s*/i, '').trim();

        if (href && title) {
          const slug = this.extractSlugFromUrl(href);
          results.push({
            id: `komiku-${slug}`,
            slug,
            source: this.source,
            title: title.replace(/^Komik\s*/i, '').trim(),
            coverUrl: getProxiedImageUrl(coverRaw, 'https://komiku.org/'),
            type: this.detectType(title, typeBadge),
            latestChapter: lastChapter || undefined
          });
        }
      });

      return results;
    };

    let items = await executeScrape(query.trim());

    // Intelligent fallback for punctuation/hyphens
    if (items.length === 0 && (query.includes('-') || query.includes(':'))) {
      const normalizedQ = query.replace(/[-_:]/g, ' ').replace(/\s+/g, ' ').trim();
      if (normalizedQ !== query.trim()) {
        items = await executeScrape(normalizedQ);
      }
    }

    globalCache.set(cacheKey, items, 10 * 60 * 1000);
    return items;
  }

  /**
   * 2. Get Popular or Latest Updated Comics
   */
  async getPopularOrLatest(
    type: 'popular' | 'latest' = 'latest',
    options: ProviderFilterOptions = {}
  ): Promise<MangaSummary[]> {
    return this.withTimeout(this.internalGetPopularOrLatest(type, options));
  }

  private async internalGetPopularOrLatest(
    _type: 'popular' | 'latest',
    _options: ProviderFilterOptions
  ): Promise<MangaSummary[]> {
    const cacheKey = `komiku_latest_home`;
    const cached = globalCache.get<MangaSummary[]>(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.get(this.baseUrl, {
        headers: this.getStandardHeaders(),
        timeout: this.timeoutMs
      });
      const $ = cheerio.load(res.data);
      const results: MangaSummary[] = [];

      $('.ls2, .ls4, .ls12').each((_, el) => {
        const linkEl = $(el).find('a').first();
        const href = linkEl.attr('href') || '';
        const title = $(el).find('h4, h3, .tt').first().text().trim() || linkEl.attr('title') || '';
        const imgEl = $(el).find('img').first();
        const coverRaw = imgEl.attr('data-src') || imgEl.attr('src') || '';
        const latestCh = $(el).find('.epx, .lsch, .chapter').first().text().trim();

        if (href && title) {
          const slug = this.extractSlugFromUrl(href);
          if (!results.some(r => r.slug === slug)) {
            results.push({
              id: `komiku-${slug}`,
              slug,
              source: this.source,
              title: title.replace(/^Komik\s*/i, '').trim(),
              coverUrl: getProxiedImageUrl(coverRaw, 'https://komiku.org/'),
              type: this.detectType(title),
              latestChapter: latestCh || undefined
            });
          }
        }
      });

      globalCache.set(cacheKey, results, 10 * 60 * 1000);
      return results;
    } catch {
      return [];
    }
  }

  /**
   * 3. Get Comic Detail & Chapters List
   */
  async getDetailAndChapters(slug: string): Promise<MangaDetail> {
    return this.withTimeout(this.internalGetDetailAndChapters(slug));
  }

  private async internalGetDetailAndChapters(slug: string): Promise<MangaDetail> {
    const cleanSlug = slug.replace(/^komiku-/, '');
    const cacheKey = `komiku_detail_${cleanSlug}`;
    const cached = globalCache.get<MangaDetail>(cacheKey);
    if (cached) return cached;

    const detailUrl = cleanSlug.startsWith('http')
      ? cleanSlug
      : `${this.baseUrl}/manga/${cleanSlug}/`;

    const res = await axios.get(detailUrl, {
      headers: this.getStandardHeaders(),
      timeout: this.timeoutMs
    });

    const $ = cheerio.load(res.data);
    const title = $('h1, .entry-title').first().text().replace(/^Komik\s*/i, '').trim();
    const synopsis = $('.desc, #sinopsis, .sinopsis, p.desc').text().replace(/\s+/g, ' ').trim();

    const imgEl = $('.ims img, .thumb img').first();
    const coverRaw = imgEl.attr('data-src') || imgEl.attr('src') || '';

    const genres: string[] = [];
    $('.genre li a, ul.genre a, .genre a').each((_, g) => {
      const gName = $(g).text().trim();
      if (gName && !genres.includes(gName)) genres.push(gName);
    });

    const status = $('table.inftable, .spe').text().toLowerCase().includes('tamat') ||
      $('table.inftable, .spe').text().toLowerCase().includes('completed')
      ? 'completed'
      : 'ongoing';

    const chapters: ChapterItem[] = [];
    $('#Daftar_Chapter tr, .chapter-list tr, table.table tr').each((_, row) => {
      const a = $(row).find('a').first();
      const href = a.attr('href') || '';
      const rawTitle = a.text().replace(/\s+/g, ' ').trim();
      const dateText = $(row).find('.tgl, .date').text().trim();

      if (href && rawTitle) {
        const numMatch = rawTitle.match(/chapter\s*([\d.]+)/i) || href.match(/chapter-([\d.]+)/i);
        const number = numMatch ? numMatch[1] : (chapters.length + 1).toString();
        const chSlug = this.extractSlugFromUrl(href);

        chapters.push({
          id: chSlug,
          number,
          title: `Chapter ${number}`,
          releaseDate: dateText || undefined,
          source: this.source,
          language: 'id'
        });
      }
    });

    const result: MangaDetail = {
      id: `komiku-${cleanSlug}`,
      slug: cleanSlug,
      source: this.source,
      title: title || cleanSlug,
      coverUrl: getProxiedImageUrl(coverRaw, 'https://komiku.org/'),
      type: this.detectType(title, genres.join(' ')),
      altTitles: [],
      synopsis: synopsis || 'Tidak ada sinopsis tersedia untuk judul ini.',
      status,
      genres,
      chapters
    };

    globalCache.set(cacheKey, result, 15 * 60 * 1000);
    return result;
  }

  /**
   * 4. Get Chapter Pages
   */
  async getChapterImages(chapterSlug: string): Promise<ChapterPage[]> {
    return this.withTimeout(this.internalGetChapterImages(chapterSlug));
  }

  private async internalGetChapterImages(chapterSlug: string): Promise<ChapterPage[]> {
    const cacheKey = `komiku_pages_${chapterSlug}`;
    const cached = globalCache.get<ChapterPage[]>(cacheKey);
    if (cached) return cached;

    const chapterUrl = chapterSlug.startsWith('http')
      ? chapterSlug
      : `${this.baseUrl}/${chapterSlug.replace(/^\/+|\/+$/g, '')}/`;

    const res = await axios.get(chapterUrl, {
      headers: this.getStandardHeaders('https://komiku.org/'),
      timeout: this.timeoutMs
    });

    const $ = cheerio.load(res.data);
    const pages: ChapterPage[] = [];

    $('#Baca_Komik img, .main-reading-area img').each((idx, el) => {
      const directUrl = $(el).attr('data-src') || $(el).attr('src') || '';
      if (
        directUrl &&
        !directUrl.includes('iklan') &&
        !directUrl.includes('banner') &&
        !directUrl.includes('promosi') &&
        (directUrl.includes('.webp') ||
          directUrl.includes('.jpg') ||
          directUrl.includes('.jpeg') ||
          directUrl.includes('.png'))
      ) {
        pages.push({
          pageNumber: idx + 1,
          imageUrl: directUrl,
          proxiedUrl: getProxiedImageUrl(directUrl, 'https://komiku.org/'),
          referer: 'https://komiku.org/'
        });
      }
    });

    globalCache.set(cacheKey, pages, 15 * 60 * 1000);
    return pages;
  }
}
