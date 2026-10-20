import axios from 'axios';
import { MangaDetail } from '../types/manga.js';
import { globalCache } from '../utils/cache.js';

export interface AniListRelationNode {
  id: number;
  title: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  type?: 'MANGA' | 'ANIME';
  format?: string;
  status?: string;
  coverImage?: {
    large?: string;
    extraLarge?: string;
  };
}

export interface AniListRelationEdge {
  relationType: string;
  node: AniListRelationNode;
}

export interface AniListMetadata {
  id: number;
  title: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  bannerImage?: string;
  coverImage?: {
    extraLarge?: string;
    large?: string;
    color?: string;
  };
  description?: string;
  averageScore?: number;
  genres?: string[];
  status?: string;
  format?: string;
  episodes?: number;
  chapters?: number;
  relations?: {
    edges: AniListRelationEdge[];
  };
}

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

const ANILIST_QUERY = `
query ($search: String, $type: MediaType = MANGA) {
  Media (search: $search, type: $type) {
    id
    title {
      romaji
      english
      native
    }
    bannerImage
    coverImage {
      extraLarge
      large
      color
    }
    description(asHtml: false)
    averageScore
    genres
    status
    format
    episodes
    chapters
    relations {
      edges {
        relationType
        node {
          id
          title {
            romaji
            english
            native
          }
          type
          format
          status
          coverImage {
            large
            extraLarge
          }
        }
      }
    }
  }
}
`;

/**
 * Clean title for better AniList matching
 * Strips bracketed tags, punctuation, and common suffixes
 */
function cleanSearchTitle(title: string): string {
  return title
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[-_:]/g, ' ')
    .replace(/\s+(manga|manhwa|manhua|bahasa indonesia|indo|chapter\s*\d+).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch rich metadata from AniList GraphQL API
 */
export async function fetchAniListMetadata(title: string): Promise<AniListMetadata | null> {
  const cleaned = cleanSearchTitle(title);
  if (!cleaned) return null;

  const cacheKey = `anilist_meta_${cleaned.toLowerCase()}`;
  const cached = globalCache.get<AniListMetadata>(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.post<{ data: { Media: AniListMetadata | null } }>(
      ANILIST_ENDPOINT,
      {
        query: ANILIST_QUERY,
        variables: { search: cleaned }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'MangaDexReader/2.0 (Personal Project)'
        },
        timeout: 6000
      }
    );

    const media = response.data?.data?.Media || null;
    if (media) {
      // Cache for 24 hours
      globalCache.set(cacheKey, media, 24 * 60 * 60 * 1000);
    }
    return media;
  } catch (error: any) {
    // Graceful fallback on network or not found
    return null;
  }
}

/**
 * Enriches a MangaDetail object with AniList banner, HD cover, and rating
 */
export async function enrichWithAniList(detail: MangaDetail): Promise<MangaDetail> {
  // Try primary title first, then first alternative title if available
  let metadata = await fetchAniListMetadata(detail.title);
  if (!metadata && detail.altTitles && detail.altTitles.length > 0) {
    for (const alt of detail.altTitles.slice(0, 2)) {
      metadata = await fetchAniListMetadata(alt);
      if (metadata) break;
    }
  }

  if (!metadata) {
    return detail;
  }

  const enriched: MangaDetail = {
    ...detail,
    bannerUrl: metadata.bannerImage || detail.bannerUrl,
    rating: metadata.averageScore ? metadata.averageScore / 10 : detail.rating
  };

  // If original cover is low-res or missing, replace with AniList extraLarge cover
  if (
    metadata.coverImage?.extraLarge &&
    (!detail.coverUrl || detail.coverUrl.includes('placeholder') || detail.coverUrl.includes('thumb'))
  ) {
    enriched.coverUrl = metadata.coverImage.extraLarge;
  }

  // If synopsis is missing or too short, use AniList description
  if ((!detail.synopsis || detail.synopsis.length < 50) && metadata.description) {
    enriched.synopsis = metadata.description.replace(/<[^>]+>/g, '').trim();
  }

  return enriched;
}
