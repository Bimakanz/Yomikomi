import axios from 'axios';
import { AnimeStreamServer } from '../types/anime.js';
import { globalCache } from '../utils/cache.js';

// Dynamically import @consumet/extensions to ensure serverless and environment compatibility
let consumetHianime: any = null;
try {
  // @ts-ignore
  const { ANIME } = require('@consumet/extensions');
  if (ANIME && ANIME.Hianime) {
    consumetHianime = new ANIME.Hianime();
  }
} catch (e) {
  // Graceful fallback to REST API
}

/**
 * Anime Global Provider
 * Provides English Sub/Dub & Multi-Quality HLS (.m3u8) video streams using @consumet/extensions and Aniwatch API
 */
export class AnimeGlobalProvider {
  readonly source = 'anime-global';
  readonly displayName = 'Global Anime / HLS';
  readonly baseUrl = process.env.ANIWATCH_API_BASE_URL?.trim() || 'https://api-aniwatch.onrender.com/anime';
  protected readonly timeoutMs = 7000;

  /**
   * Search anime on global provider using @consumet/extensions Hianime / Consumet
   */
  async search(query: string): Promise<Array<{ id: string; title: string; image: string }>> {
    if (!query || !query.trim()) return [];
    const cacheKey = `global_anime_search_${query.toLowerCase().trim()}`;
    const cached = globalCache.get<any>(cacheKey);
    if (cached) return cached;

    // 1. Try @consumet/extensions Hianime
    if (consumetHianime) {
      try {
        const searchResult = await consumetHianime.search(query.trim());
        if (searchResult?.results && searchResult.results.length > 0) {
          const list = searchResult.results.map((r: any) => ({
            id: r.id,
            title: r.title,
            image: r.image
          }));
          globalCache.set(cacheKey, list, 60 * 60 * 1000);
          return list;
        }
      } catch (_) {}
    }

    // 2. Try Aniwatch REST API
    try {
      const res = await axios.get(`${this.baseUrl}/search?q=${encodeURIComponent(query.trim())}&page=1`, {
        timeout: this.timeoutMs
      });
      const animes = res.data?.animes || [];
      const list = animes.map((a: any) => ({
        id: a.id,
        title: a.name,
        image: a.poster
      }));
      if (list.length > 0) {
        globalCache.set(cacheKey, list, 60 * 60 * 1000);
        return list;
      }
    } catch (_) {}

    return [];
  }

  /**
   * Get streaming HLS links (.m3u8) for episode
   */
  async getEpisodeStreams(animeTitle: string, episodeNumber: number): Promise<AnimeStreamServer[]> {
    const cleanTitle = animeTitle
      .replace(/season\s*\d+/i, '')
      .replace(/s\d+/i, '')
      .replace(/:\s*[^:]+$/, '')
      .trim();

    const cacheKey = `global_streams_${cleanTitle}_ep${episodeNumber}`;
    const cached = globalCache.get<AnimeStreamServer[]>(cacheKey);
    if (cached) return cached;

    const servers: AnimeStreamServer[] = [];

    // Try @consumet/extensions Hianime episode sources
    if (consumetHianime) {
      try {
        const searchResults = await this.search(cleanTitle);
        if (searchResults.length > 0) {
          const animeId = searchResults[0].id;
          const info = await consumetHianime.fetchAnimeInfo(animeId);
          const episodes = info?.episodes || [];
          const targetEp = episodes.find((e: any) => e.number === episodeNumber) || episodes[episodeNumber - 1];

          if (targetEp && targetEp.id) {
            const sourcesData = await consumetHianime.fetchEpisodeSources(targetEp.id);
            if (sourcesData?.sources) {
              sourcesData.sources.forEach((s: any, idx: number) => {
                servers.push({
                  id: `hianime-hls-${s.quality || idx}`,
                  name: `Global Server ${idx + 1} (${s.quality || 'Auto'} • HLS)`,
                  type: 'hls',
                  url: s.url,
                  quality: s.quality || '1080p',
                  isSubIndo: false
                });
              });
            }
          }
        }
      } catch (err) {
        console.warn('[AnimeGlobalProvider] @consumet/extensions stream fallback:', (err as any).message);
      }
    }

    // Return servers if found from @consumet/extensions
    if (servers.length > 0) {
      globalCache.set(cacheKey, servers, 2 * 60 * 60 * 1000);
    }
    return servers;

    globalCache.set(cacheKey, servers, 2 * 60 * 60 * 1000);
    return servers;
  }
}

export const animeGlobalProvider = new AnimeGlobalProvider();
