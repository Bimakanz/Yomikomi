import { animeIndoProvider } from '../providers/anime-indo.provider.js';
import { animeGlobalProvider } from '../providers/anime-global.provider.js';
import { AnimeDetail, AnimeEpisode, AnimeStreamServer } from '../types/anime.js';
import { globalCache } from '../utils/cache.js';

export class AnimeAggregatorService {
  /**
   * Get unified streaming servers for an episode (Sub Indo + Global HLS)
   */
  async getUnifiedEpisodeStreams(
    animeTitle: string,
    episodeNumber: number,
    mappings?: { malId?: number | string; tmdbId?: number | string; imdbId?: string }
  ): Promise<AnimeStreamServer[]> {
    const cacheKey = `agg_stream_${animeTitle}_ep${episodeNumber}`;
    const cached = globalCache.get<AnimeStreamServer[]>(cacheKey);
    if (cached) return cached;

    // 3.5-second budget for external live scrapers
    const scraperPromise = Promise.all([
      animeIndoProvider.getEpisodeStreams(animeTitle, episodeNumber).catch(() => []),
      animeGlobalProvider.getEpisodeStreams(animeTitle, episodeNumber).catch(() => [])
    ]);

    const timeoutPromise = new Promise<[AnimeStreamServer[], AnimeStreamServer[]]>((resolve) =>
      setTimeout(() => resolve([[], []]), 3500)
    );

    const [indoServers, globalServers] = await Promise.race([scraperPromise, timeoutPromise]);

    const combined: AnimeStreamServer[] = [];

    // Prioritize Sub Indo servers first
    if (indoServers && indoServers.length > 0) {
      combined.push(...indoServers);
    }

    // Append Global HLS / Multi-Sub servers
    if (globalServers && globalServers.length > 0) {
      combined.push(...globalServers);
    }

    // High quality instant fallback servers using real anime metadata
    if (combined.length === 0) {
      const tmdbId = mappings?.tmdbId;
      const malId = mappings?.malId;
      const safeTitle = encodeURIComponent(animeTitle);

      if (malId) {
        combined.push({
          id: 'server-vidsrc-mal',
          name: 'Server 1 (Global HD • Multi-Sub)',
          type: 'iframe',
          url: `https://vidsrc.pm/embed/anime?mal=${malId}&ep=${episodeNumber}`,
          quality: '1080p',
          isSubIndo: false
        });
      }

      if (tmdbId) {
        combined.push({
          id: 'server-multiembed-tmdb',
          name: `Server ${combined.length + 1} (AutoStream FHD)`,
          type: 'iframe',
          url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=1&e=${episodeNumber}`,
          quality: '1080p',
          isSubIndo: false
        });
        combined.push({
          id: 'server-2embed-tmdb',
          name: `Server ${combined.length + 1} (Direct Cloud 720p)`,
          type: 'iframe',
          url: `https://2embed.cc/embedtv/${tmdbId}&s=1&e=${episodeNumber}`,
          quality: '720p',
          isSubIndo: false
        });
        combined.push({
          id: 'server-autoembed-tmdb',
          name: `Server ${combined.length + 1} (Fast CDN)`,
          type: 'iframe',
          url: `https://autoembed.co/tv/tmdb/${tmdbId}-1-${episodeNumber}`,
          quality: 'Auto',
          isSubIndo: false
        });
      }

      if (combined.length === 0) {
        combined.push({
          id: 'server-embed-title',
          name: 'Server 1 (Direct Stream HD)',
          type: 'iframe',
          url: `https://multiembed.mov/?video_id=${safeTitle}&s=1&e=${episodeNumber}`,
          quality: '1080p',
          isSubIndo: false
        });
      }
    }

    globalCache.set(cacheKey, combined, 60 * 60 * 1000);
    return combined;
  }

  /**
   * Enrich AniList anime with episode list
   */
  async buildEpisodeList(
    animeTitle: string,
    totalEpisodes: number,
    bannerOrCover: string
  ): Promise<AnimeEpisode[]> {
    const count = totalEpisodes && totalEpisodes > 0 ? totalEpisodes : 12;
    const episodes: AnimeEpisode[] = [];

    for (let i = 1; i <= count; i++) {
      episodes.push({
        episodeNumber: i,
        title: `Episode ${i}`,
        thumbnail: bannerOrCover || '',
        duration: '24:00',
        servers: []
      });
    }

    return episodes;
  }
}

export const animeAggregatorService = new AnimeAggregatorService();
