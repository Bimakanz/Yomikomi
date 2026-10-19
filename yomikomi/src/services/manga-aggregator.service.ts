import { BaseMangaProvider } from '../providers/base.provider.js';
import { MangaDexProvider } from '../providers/mangadex.provider.js';
import { LocalIndoProvider } from '../providers/local-indo.provider.js';
import { KomikuProvider } from '../providers/komiku.provider.js';
import { ConsumetProvider } from '../providers/consumet.provider.js';
import { enrichWithAniList } from '../enrichers/anilist.enricher.js';
import {
  MangaSummary,
  MangaDetail,
  ChapterPage,
  ProviderFilterOptions,
  MangaSource
} from '../types/manga.js';
import { globalCache } from '../utils/cache.js';

export interface AggregatedSearchResponse {
  query: string;
  total: number;
  sources: Record<string, { total: number; status: 'ok' | 'failed' | 'timeout'; error?: string }>;
  results: MangaSummary[];
}

export class MangaAggregatorService {
  private providers: Map<string, BaseMangaProvider> = new Map();

  constructor() {
    this.registerProvider(new MangaDexProvider());
    this.registerProvider(new KomikuProvider());
    this.registerProvider(new LocalIndoProvider());
    this.registerProvider(new ConsumetProvider());
  }

  registerProvider(provider: BaseMangaProvider): void {
    this.providers.set(provider.source, provider);
  }

  getProvider(source: string): BaseMangaProvider {
    const provider = this.providers.get(source);
    if (!provider) {
      throw new Error(`Unsupported or unknown manga provider: "${source}"`);
    }
    return provider;
  }

  getAllProviders(): BaseMangaProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Multi-Source Concurrent Search using Promise.allSettled
   * Guaranteed to never crash if one provider fails or times out (8s limit).
   */
  async searchAll(query: string, options: ProviderFilterOptions = {}): Promise<AggregatedSearchResponse> {
    const cleanQ = query.trim();
    if (!cleanQ) {
      return { query: '', total: 0, sources: {}, results: [] };
    }

    const cacheKey = `agg_search_${cleanQ.toLowerCase()}`;
    const cached = globalCache.get<AggregatedSearchResponse>(cacheKey);
    if (cached) return cached;

    const providerList = this.getAllProviders();
    const sourcesStatus: Record<string, { total: number; status: 'ok' | 'failed' | 'timeout'; error?: string }> = {};

    // Execute all providers concurrently with Promise.allSettled
    const settledResults = await Promise.allSettled(
      providerList.map(async (provider) => {
        try {
          const items = await provider.search(cleanQ, options);
          return { source: provider.source, items };
        } catch (err: any) {
          const isTimeout = err.message?.includes('timed out');
          throw {
            source: provider.source,
            status: isTimeout ? 'timeout' : 'failed',
            message: err.message || 'Search failed'
          };
        }
      })
    );

    const mergedResults: MangaSummary[] = [];

    settledResults.forEach((settled, index) => {
      const provider = providerList[index];
      if (settled.status === 'fulfilled') {
        const { source, items } = settled.value;
        sourcesStatus[source] = { total: items.length, status: 'ok' };
        mergedResults.push(...items);
      } else {
        const reason = settled.reason as { source: string; status: 'timeout' | 'failed'; message: string };
        sourcesStatus[provider.source] = {
          total: 0,
          status: reason?.status || 'failed',
          error: reason?.message || 'Unknown error'
        };
      }
    });

    const response: AggregatedSearchResponse = {
      query: cleanQ,
      total: mergedResults.length,
      sources: sourcesStatus,
      results: mergedResults
    };

    globalCache.set(cacheKey, response, 5 * 60 * 1000); // 5 min TTL
    return response;
  }

  /**
   * Get Popular or Latest Manga across sources (defaulting to MangaDex + Local Mirror)
   */
  async getPopularOrLatest(
    type: 'popular' | 'latest' = 'popular',
    source: string = 'mangadex',
    options: ProviderFilterOptions = {}
  ): Promise<MangaSummary[]> {
    const provider = this.getProvider(source);
    return provider.getPopularOrLatest(type, options);
  }

  /**
   * Get Manga Details with automated AniList GraphQL enrichment
   */
  async getDetail(
    source: string,
    idOrSlug: string,
    enrichWithMetadata: boolean = true
  ): Promise<MangaDetail> {
    const provider = this.getProvider(source);
    let detail = await provider.getDetailAndChapters(idOrSlug);

    if (enrichWithMetadata) {
      try {
        detail = await enrichWithAniList(detail);
      } catch (enrichErr) {
        console.warn(`[AniList Enrichment] Skipped for ${detail.title}:`, enrichErr);
      }
    }

    return detail;
  }

  /**
   * Get Chapter Images with automated WebP compression & anti-403 bypass
   */
  async getChapterPages(source: string, chapterIdOrSlug: string): Promise<ChapterPage[]> {
    const provider = this.getProvider(source);
    return provider.getChapterImages(chapterIdOrSlug);
  }
}

// Global Singleton Instance
export const aggregatorService = new MangaAggregatorService();
