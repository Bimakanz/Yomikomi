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

export class LocalIndoProvider extends BaseMangaProvider {
  readonly source = 'bacakomik';
  readonly displayName = 'Indo Mirror (Bacakomik / Komiku)';
  readonly defaultLanguage = 'id';

  /**
   * Base URL loaded from environment variable so domain changes can be made without code redeploy
   */
  readonly baseUrl: string =
    process.env.LOCAL_INDO_BASE_URL?.trim() || 'https://bacakomik.my';

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
   * 1. Search comics by keyword
   */
  async search(query: string, options: ProviderFilterOptions = {}): Promise<MangaSummary[]> {
    return this.withTimeout(this.internalSearch(query, options));
  }

  private async internalSearch(query: string, options: ProviderFilterOptions): Promise<MangaSummary[]> {
    if (!query || !query.trim()) return [];

    const cacheKey = `local_search_${query.trim().toLowerCase()}`;
    const cached = globalCache.get<MangaSummary[]>(cacheKey);
    if (cached) return cached;

    const executeScrape = async (q: string) => {
      const searchUrl = `${this.baseUrl}/?s=${encodeURIComponent(q)}`;
      const res = await axios.get(searchUrl, {
        headers: this.getStandardHeaders(),
        timeout: this.timeoutMs
      });
      const $ = cheerio.load(res.data);
      const results: MangaSummary[] = [];

      $('.animepost').each((_, el) => {
        const linkEl = $(el).find('a').first();
        const href = linkEl.attr('href') || '';
        const title = $(el).find('.tt, h4, .title').text().trim() || linkEl.attr('title') || '';
        const imgEl = $(el).find('img').first();
        const coverRaw = imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
        const typeBadge = $(el).find('.typeflag, .type').text().trim();

        if (href && title) {
          const slug = this.extractSlugFromUrl(href);
          results.push({
            id: slug,
            slug,
            source: this.source,
            title: title.replace(/^Warna\s*/i, '').trim(),
            coverUrl: getProxiedImageUrl(coverRaw, this.baseUrl),
            type: this.detectType(title, typeBadge)
          });
        }
      });

      return results;
    };

    let items = await executeScrape(query.trim());

    // Intelligent Fallback: If hyphenated title returned 0 (e.g. "Gye Baek-sun"), retry unhyphenated ("Gye Baeksun")
    if (items.length === 0 && (query.includes('-') || query.includes(':'))) {
      const normalizedQ = query.replace(/[-_:]/g, ' ').replace(/\s+/g, ' ').trim();
      if (normalizedQ !== query.trim()) {
        items = await executeScrape(normalizedQ);
      }
    }

    globalCache.set(cacheKey, items, 10 * 60 * 1000); // 10 min TTL
    return items;
  }

  /**
   * 2. Get Popular or Latest Updated Comics
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
    const cacheKey = `local_${type}_p${page}`;
    const cached = globalCache.get<MangaSummary[]>(cacheKey);
    if (cached) return cached;

    const targetUrl =
      type === 'popular'
        ? `${this.baseUrl}/komik-populer/page/${page}/`
        : `${this.baseUrl}/komik-terbaru/page/${page}/`;

    try {
      const res = await axios.get(targetUrl, {
        headers: this.getStandardHeaders(),
        timeout: this.timeoutMs
      });
      const $ = cheerio.load(res.data);
      const results: MangaSummary[] = [];

      $('.animepost').each((_, el) => {
        const linkEl = $(el).find('a').first();
        const href = linkEl.attr('href') || '';
        const title = $(el).find('.tt, h4, .title').text().trim() || linkEl.attr('title') || '';
        const imgEl = $(el).find('img').first();
        const coverRaw = imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
        const latestCh = $(el).find('.lsch, .epx').text().trim();
        const rating = parseFloat($(el).find('.rating strong, .score').text().trim()) || undefined;

        if (href && title) {
          const slug = this.extractSlugFromUrl(href);
          results.push({
            id: slug,
            slug,
            source: this.source,
            title: title.replace(/^Warna\s*/i, '').trim(),
            coverUrl: getProxiedImageUrl(coverRaw, this.baseUrl),
            type: this.detectType(title),
            latestChapter: latestCh || undefined,
            rating
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
   * 3. Get Comic Detail & Complete Chapter List
   */
  async getDetailAndChapters(slug: string): Promise<MangaDetail> {
    return this.withTimeout(this.internalGetDetailAndChapters(slug));
  }

  private async internalGetDetailAndChapters(slug: string): Promise<MangaDetail> {
    const cacheKey = `local_detail_${slug}`;
    const cached = globalCache.get<MangaDetail>(cacheKey);
    if (cached) return cached;

    const detailUrl = slug.startsWith('http') ? slug : `${this.baseUrl}/komik/${slug}/`;
    const res = await axios.get(detailUrl, {
      headers: this.getStandardHeaders(),
      timeout: this.timeoutMs
    });

    const $ = cheerio.load(res.data);
    const title = $('.entry-title, .komik_info-content-body-title, h1').first().text().trim();
    const synopsis = $('.entry-content-single, .komik_info-description-sinopsis, .sinopsis')
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const imgEl = $('.thumb img, .komik_info-content-thumbnail img').first();
    const coverRaw = imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
    const status = $('.spe, .komik_info-content-info').text().includes('Completed')
      ? 'completed'
      : 'ongoing';

    // Genres & Alt Titles
    const genres: string[] = [];
    $('.genre-info a, .komik_info-content-genre a').each((_, g) => {
      const gName = $(g).text().trim();
      if (gName) genres.push(gName);
    });

    const altTitles: string[] = [];
    const altText = $('.spe span:contains("Judul Lain"), .komik_info-content-native').text();
    if (altText) {
      altText
        .replace(/Judul Lain:\s*/i, '')
        .split(/[,;/]/)
        .forEach(t => {
          const cl = t.trim();
          if (cl && !altTitles.includes(cl)) altTitles.push(cl);
        });
    }

    // Chapters Extraction from #chapter_list / .eps_lst
    const chapters: ChapterItem[] = [];
    const container = $('#chapter_list, .eps_lst, #chapter-list');

    container.find('li').each((_, el) => {
      const a = $(el).find('a').first();
      const href = a.attr('href') || '';
      const rawTitle = a.text().replace(/\s+/g, ' ').trim();
      const dateText = $(el).find('.dt, .chapterdate').text().trim();

      if (href) {
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
      id: slug,
      slug,
      source: this.source,
      title: title || slug,
      coverUrl: getProxiedImageUrl(coverRaw, this.baseUrl),
      type: this.detectType(title, genres.join(' ')),
      altTitles,
      synopsis: synopsis || 'Tidak ada deskripsi tersedia.',
      status,
      genres,
      chapters
    };

    globalCache.set(cacheKey, result, 15 * 60 * 1000);
    return result;
  }

  /**
   * 4. Get Chapter Pages / Images
   */
  async getChapterImages(chapterSlug: string): Promise<ChapterPage[]> {
    return this.withTimeout(this.internalGetChapterImages(chapterSlug));
  }

  private async internalGetChapterImages(chapterSlug: string): Promise<ChapterPage[]> {
    const cacheKey = `local_pages_${chapterSlug}`;
    const cached = globalCache.get<ChapterPage[]>(cacheKey);
    if (cached) return cached;

    const chapterUrl = chapterSlug.startsWith('http')
      ? chapterSlug
      : `${this.baseUrl}/${chapterSlug}/`;

    const res = await axios.get(chapterUrl, {
      headers: this.getStandardHeaders(),
      timeout: this.timeoutMs
    });

    const $ = cheerio.load(res.data);
    const pages: ChapterPage[] = [];

    // Cheerio selector for reading image pages
    $('#chimg-conver img, .main-reading-area img, .reader-area img').each((idx, el) => {
      const directUrl =
        $(el).attr('data-lazy-src') ||
        $(el).attr('data-src') ||
        $(el).attr('src') ||
        '';

      if (
        directUrl &&
        !directUrl.includes('logo') &&
        !directUrl.includes('banner') &&
        (directUrl.includes('.jpg') ||
          directUrl.includes('.webp') ||
          directUrl.includes('.png') ||
          directUrl.includes('/data/'))
      ) {
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
