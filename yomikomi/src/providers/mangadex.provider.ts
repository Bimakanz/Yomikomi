import axios from 'axios';
import https from 'https';
import dns from 'dns';
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

// MangaDex IP nodes to bypass ISP DNS poisoning
const MANGADEX_IPS = [
  { address: '45.129.229.1', family: 4 },
  { address: '45.129.229.2', family: 4 }
];
let mdIpCounter = 0;

function customMangaDexLookup(hostname: string, options: any, callback: any) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (hostname === 'api.mangadex.org' || hostname === 'uploads.mangadex.org') {
    if (options && options.all) {
      return callback(null, MANGADEX_IPS);
    }
    const ip = MANGADEX_IPS[mdIpCounter++ % MANGADEX_IPS.length].address;
    return callback(null, ip, 4);
  }
  return dns.lookup(hostname, options, callback);
}

const mangadexHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 10000,
  lookup: customMangaDexLookup
});

export class MangaDexProvider extends BaseMangaProvider {
  readonly source = 'mangadex';
  readonly displayName = 'MangaDex (Official)';
  readonly baseUrl = 'https://api.mangadex.org';
  readonly defaultLanguage = 'id';

  private readonly uploadsUrl = 'https://uploads.mangadex.org';

  private async get(url: string): Promise<any> {
    return axios.get(url, {
      headers: this.getStandardHeaders(),
      timeout: this.timeoutMs,
      httpsAgent: mangadexHttpsAgent
    });
  }

  private buildCoverUrl(mangaId: string, fileName?: string): string {
    if (!fileName) {
      return 'https://placehold.co/400x600/1e293b/94a3b8?text=No+Cover';
    }
    const directUrl = `${this.uploadsUrl}/covers/${mangaId}/${fileName}.512.jpg`;
    return getProxiedImageUrl(directUrl);
  }

  private determineComicType(tags: Array<{ attributes: { name: { en?: string } } }>, originalLanguage?: string): ComicType {
    if (originalLanguage === 'ko') return 'manhwa';
    if (originalLanguage === 'zh' || originalLanguage === 'zh-hk') return 'manhua';
    
    const tagNames = tags.map(t => t.attributes.name.en?.toLowerCase() || '');
    if (tagNames.includes('manhwa')) return 'manhwa';
    if (tagNames.includes('manhua')) return 'manhua';
    return 'manga';
  }

  private formatTitle(attributes: any): string {
    if (!attributes || !attributes.title) return 'Untitled Manga';
    // Prioritize English, Indonesian, or romanized Japanese/Korean
    if (attributes.title.en) return attributes.title.en;
    if (attributes.title.id) return attributes.title.id;

    // Check if altTitles has English or Indonesian title
    if (Array.isArray(attributes.altTitles)) {
      for (const at of attributes.altTitles) {
        if (at.en) return at.en;
        if (at.id) return at.id;
      }
    }

    return (
      attributes.title['ja-ro'] ||
      attributes.title['ko-ro'] ||
      attributes.title['zh-ro'] ||
      Object.values(attributes.title)[0] ||
      'Untitled Manga'
    ) as string;
  }

  /**
   * Search MangaDex
   */
  async search(query: string, options: ProviderFilterOptions = {}): Promise<MangaSummary[]> {
    return this.withTimeout(this.internalSearch(query, options));
  }

  private async internalSearch(query: string, options: ProviderFilterOptions): Promise<MangaSummary[]> {
    const limit = options.limit || 20;
    const cacheKey = `md_search_${query}_${limit}`;
    const cached = globalCache.get<MangaSummary[]>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      limit: limit.toString(),
      'includes[]': 'cover_art'
    });
    params.append('includes[]', 'author');
    params.append('contentRating[]', 'safe');
    params.append('contentRating[]', 'suggestive');
    params.append('contentRating[]', 'erotica');

    if (query.trim()) {
      params.set('title', query.trim());
    }

    // Default to sorting by relevance
    params.set('order[relevance]', 'desc');

    const res = await this.get(`${this.baseUrl}/manga?${params.toString()}`);

    const mangaList = res.data?.data || [];
    const results: MangaSummary[] = mangaList.map((m: any) => {
      const coverRel = m.relationships?.find((r: any) => r.type === 'cover_art');
      const coverFileName = coverRel?.attributes?.fileName;
      const title = this.formatTitle(m.attributes);
      const type = this.determineComicType(m.attributes.tags || [], m.attributes.originalLanguage);

      return {
        id: m.id,
        slug: m.id,
        source: this.source,
        title,
        coverUrl: this.buildCoverUrl(m.id, coverFileName),
        type,
        rating: undefined
      };
    });

    globalCache.set(cacheKey, results, 5 * 60 * 1000); // 5 min TTL
    return results;
  }

  /**
   * Get Popular or Latest Manga/Manhwa
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
    const limit = options.limit || 20;
    const page = options.page || 1;
    const offset = (page - 1) * limit;

    const cacheKey = `md_${type}_p${page}_l${limit}`;
    const cached = globalCache.get<MangaSummary[]>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      'includes[]': 'cover_art'
    });

    if (type === 'popular') {
      params.set('order[followedCount]', 'desc');
    } else {
      params.set('order[latestUploadedChapter]', 'desc');
    }

    const res = await this.get(`${this.baseUrl}/manga?${params.toString()}`);

    const mangaList = res.data?.data || [];
    const results: MangaSummary[] = mangaList.map((m: any) => {
      const coverRel = m.relationships?.find((r: any) => r.type === 'cover_art');
      const coverFileName = coverRel?.attributes?.fileName;
      const title = this.formatTitle(m.attributes);
      const comicType = this.determineComicType(m.attributes.tags || [], m.attributes.originalLanguage);

      return {
        id: m.id,
        slug: m.id,
        source: this.source,
        title,
        coverUrl: this.buildCoverUrl(m.id, coverFileName),
        type: comicType
      };
    });

    globalCache.set(cacheKey, results, 10 * 60 * 1000); // 10 min TTL
    return results;
  }

  /**
   * Get Detail and Chapters for a specific Manga
   */
  async getDetailAndChapters(id: string): Promise<MangaDetail> {
    return this.withTimeout(this.internalGetDetailAndChapters(id));
  }

  private async internalGetDetailAndChapters(id: string): Promise<MangaDetail> {
    const cacheKey = `md_detail_${id}`;
    const cached = globalCache.get<MangaDetail>(cacheKey);
    if (cached) return cached;

    // 1. Fetch Manga Metadata with cover_art and author
    const detailRes = await this.get(
      `${this.baseUrl}/manga/${id}?includes[]=cover_art&includes[]=author`
    );

    const m = detailRes.data?.data;
    if (!m) {
      throw new Error(`Manga not found: ${id}`);
    }

    const coverRel = m.relationships?.find((r: any) => r.type === 'cover_art');
    const authorRel = m.relationships?.find((r: any) => r.type === 'author');
    const coverFileName = coverRel?.attributes?.fileName;
    const title = this.formatTitle(m.attributes);
    const comicType = this.determineComicType(m.attributes.tags || [], m.attributes.originalLanguage);

    // Extract alternative titles
    const altTitles: string[] = [];
    if (Array.isArray(m.attributes.altTitles)) {
      m.attributes.altTitles.forEach((at: Record<string, string>) => {
        Object.values(at).forEach(val => {
          if (val && typeof val === 'string' && !altTitles.includes(val)) {
            altTitles.push(val);
          }
        });
      });
    }

    // Extract synopsis
    const synopsis =
      m.attributes.description?.id ||
      m.attributes.description?.en ||
      Object.values(m.attributes.description || {})[0] ||
      'No synopsis available.';

    // Extract genres
    const genres = (m.attributes.tags || [])
      .map((t: any) => t.attributes?.name?.en)
      .filter(Boolean);

    // 2. Fetch Chapters Feed (Both Indonesian and English with pagination loop)
    let chapters: ChapterItem[] = [];
    try {
      let offset = 0;
      const batchLimit = 500;
      let totalChapters = 0;
      const rawChapters: any[] = [];

      do {
        const feedParams = new URLSearchParams({
          limit: batchLimit.toString(),
          offset: offset.toString(),
          'order[chapter]': 'desc',
          'order[volume]': 'desc',
          'includes[]': 'scanlation_group'
        });
        feedParams.append('translatedLanguage[]', 'id');
        feedParams.append('translatedLanguage[]', 'en');
        feedParams.append('contentRating[]', 'safe');
        feedParams.append('contentRating[]', 'suggestive');
        feedParams.append('contentRating[]', 'erotica');

        const feedRes = await this.get(`${this.baseUrl}/manga/${id}/feed?${feedParams.toString()}`);
        totalChapters = feedRes.data?.total || 0;
        const feedData = feedRes.data?.data || [];
        rawChapters.push(...feedData);
        offset += batchLimit;
      } while (offset < totalChapters && rawChapters.length < totalChapters);

      // Filter out chapters that cannot be read directly (externalUrl !== null or pages === 0)
      const readableChapters = rawChapters.filter((ch: any) => {
        const attrs = ch.attributes;
        if (!attrs) return false;
        if (attrs.externalUrl) return false;
        if (attrs.pages === 0) return false;
        return true;
      });

      chapters = readableChapters.map((ch: any) => {
        const groupRel = ch.relationships?.find((r: any) => r.type === 'scanlation_group');
        const groupName = groupRel?.attributes?.name || 'MangaDex';
        const chNum = ch.attributes.chapter || 'Extra';
        const chTitle = ch.attributes.title
          ? `Chapter ${chNum}: ${ch.attributes.title}`
          : `Chapter ${chNum}`;

        return {
          id: ch.id,
          number: chNum,
          title: chTitle,
          releaseDate: ch.attributes.publishAt,
          source: this.source,
          language: ch.attributes.translatedLanguage,
          scanlationGroup: groupName
        };
      });
    } catch (feedErr) {
      console.warn(`[MangaDex] Failed to load chapters for ${id}:`, feedErr);
    }

    const result: MangaDetail = {
      id: m.id,
      slug: m.id,
      source: this.source,
      title,
      coverUrl: this.buildCoverUrl(m.id, coverFileName),
      type: comicType,
      altTitles,
      synopsis: typeof synopsis === 'string' ? synopsis : '',
      status: m.attributes.status || 'unknown',
      genres,
      author: authorRel?.attributes?.name,
      chapters
    };

    globalCache.set(cacheKey, result, 15 * 60 * 1000); // 15 min TTL
    return result;
  }

  /**
   * Get Chapter Images via MangaDex@Home API
   * Implements Data Saver fallback and WebP proxying
   */
  async getChapterImages(chapterId: string): Promise<ChapterPage[]> {
    return this.withTimeout(this.internalGetChapterImages(chapterId));
  }

  private async internalGetChapterImages(chapterId: string): Promise<ChapterPage[]> {
    const cacheKey = `md_pages_${chapterId}`;
    const cached = globalCache.get<ChapterPage[]>(cacheKey);
    if (cached) return cached;

    const res = await this.get(`${this.baseUrl}/at-home/server/${chapterId}`);

    const atHome = res.data;
    const host = atHome.baseUrl;
    const hash = atHome.chapter.hash;

    // Use standard quality pages, or fallback to dataSaver if original is empty
    const fileNames: string[] =
      atHome.chapter.data?.length > 0 ? atHome.chapter.data : atHome.chapter.dataSaver || [];
    const isDataSaver = atHome.chapter.data?.length === 0;
    const mode = isDataSaver ? 'data-saver' : 'data';

    const pages: ChapterPage[] = fileNames.map((fileName, idx) => {
      const originalUrl = `${host}/${mode}/${hash}/${fileName}`;
      // Proxy through wsrv.nl WebP compression
      const proxiedUrl = getProxiedImageUrl(originalUrl);

      return {
        pageNumber: idx + 1,
        imageUrl: originalUrl,
        proxiedUrl
      };
    });

    globalCache.set(cacheKey, pages, 15 * 60 * 1000); // 15 min TTL
    return pages;
  }
}
