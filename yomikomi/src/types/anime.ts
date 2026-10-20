/**
 * Anime Type Definitions
 * Data contracts for AniList metadata, Indo/Global streaming providers, and Aggregator
 */

export interface AnimeTitle {
  romaji?: string;
  english?: string;
  native?: string;
}

export interface AnimeStreamServer {
  id: string;
  name: string;
  type: 'hls' | 'mp4' | 'iframe';
  url: string;
  quality?: string;
  isSubIndo?: boolean;
}

export interface AnimeEpisode {
  episodeNumber: number;
  title: string;
  thumbnail?: string;
  duration?: string;
  servers?: AnimeStreamServer[];
}

export interface AnimeSummary {
  id: number | string;
  mediaType: 'anime';
  title: string;
  titleObj: AnimeTitle;
  coverUrl: string;
  bannerUrl?: string | null;
  rating?: string | null;
  averageScore?: number | null;
  status: string;
  episodes?: number | null;
  latestEpisode?: string;
  format?: string;
  genres?: string[];
  description?: string;
  relatedManga?: {
    relationType: string;
    id: number | string;
    title: AnimeTitle | string;
    type: string;
    format?: string;
  } | null;
}

export interface AnimeDetail extends AnimeSummary {
  episodesList: AnimeEpisode[];
  totalEpisodes: number;
}
