import axios from 'axios';
import { globalCache } from '../utils/cache.js';

export interface AniZipEpisodeData {
  episodeNumber: number;
  title: string;
  image?: string;
  overview?: string;
  airDate?: string;
}

export interface AniZipMappingResult {
  anilistId: number | string;
  malId?: number;
  kitsuId?: number;
  anidbId?: number;
  thetvdbId?: number;
  episodeCount?: number;
  episodes: Record<string, AniZipEpisodeData>;
}

export class AniZipService {
  private readonly baseUrl = 'https://api.ani.zip/mappings';
  private readonly timeoutMs = 6000;

  /**
   * Fetch mappings and per-episode thumbnails & titles from AniZip
   */
  async getMappings(anilistId: number | string): Promise<AniZipMappingResult | null> {
    if (!anilistId) return null;
    const cacheKey = `anizip_${anilistId}`;
    const cached = globalCache.get<AniZipMappingResult>(cacheKey);
    if (cached) return cached;

    try {
      const res = await axios.get(`${this.baseUrl}?anilist_id=${encodeURIComponent(anilistId)}`, {
        headers: {
          'User-Agent': 'Yomikomi/2.0 (Anime Stream & Reader)'
        },
        timeout: this.timeoutMs
      });

      const data = res.data;
      if (!data) return null;

      const rawEpisodes = data.episodes || {};
      const episodes: Record<string, AniZipEpisodeData> = {};

      Object.entries(rawEpisodes).forEach(([epNum, ep]: [string, any]) => {
        const epTitle = ep.title?.en || ep.title?.['x-jat'] || ep.title?.ja || `Episode ${epNum}`;
        episodes[epNum] = {
          episodeNumber: parseInt(epNum, 10),
          title: epTitle,
          image: ep.image || undefined,
          overview: ep.overview || ep.summary || undefined,
          airDate: ep.airDate || ep.airdate || undefined
        };
      });

      const result: AniZipMappingResult = {
        anilistId,
        malId: data.mappings?.mal_id,
        kitsuId: data.mappings?.kitsu_id,
        anidbId: data.mappings?.anidb_id,
        thetvdbId: data.mappings?.thetvdb_id,
        episodeCount: data.episodeCount,
        episodes
      };

      globalCache.set(cacheKey, result, 24 * 60 * 60 * 1000); // 24 hours
      return result;
    } catch (err) {
      console.warn(`[AniZip] Failed for anilist_id ${anilistId}:`, (err as any).message);
      return null;
    }
  }
}

export const aniZipService = new AniZipService();
