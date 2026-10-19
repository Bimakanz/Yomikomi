import axios from 'axios';
import { globalCache } from '../utils/cache.js';

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
  rating?: number; // 0.0 - 10.0 scale
  ratingFormatted?: string; // e.g. "⭐ 8.5"
  genres?: string[];
  status?: string;
}

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

const ANILIST_QUERY = `
query ($search: String) {
  Media (search: $search, type: MANGA) {
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
  }
}
`;

/**
 * Clean search title for AniList GraphQL
 */
export function cleanSearchTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[-_:]/g, ' ')
    .replace(/\s+(manga|manhwa|manhua|bahasa indonesia|indo|chapter\s*\d+).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch rich AniList metadata with rating and banner image
 */
export async function fetchAniList(title: string): Promise<AniListMetadata | null> {
  const cleaned = cleanSearchTitle(title);
  if (!cleaned) return null;

  const cacheKey = `anilist_meta_${cleaned.toLowerCase()}`;
  const cached = globalCache.get<AniListMetadata>(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.post<{ data: { Media: any | null } }>(
      ANILIST_ENDPOINT,
      {
        query: ANILIST_QUERY,
        variables: { search: cleaned }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Yomikomi/2.0 (Manga & Manhwa Reader)'
        },
        timeout: 6000
      }
    );

    const media = response.data?.data?.Media;
    if (!media) return null;

    const rating = typeof media.averageScore === 'number' ? Math.round((media.averageScore / 10) * 10) / 10 : undefined;
    const ratingFormatted = rating ? `⭐ ${rating.toFixed(1)}` : undefined;

    const result: AniListMetadata = {
      id: media.id,
      title: media.title,
      bannerImage: media.bannerImage || undefined,
      coverImage: media.coverImage,
      description: media.description,
      averageScore: media.averageScore,
      rating,
      ratingFormatted,
      genres: media.genres,
      status: media.status
    };

    // Cache for 24 hours
    globalCache.set(cacheKey, result, 24 * 60 * 60 * 1000);
    return result;
  } catch (error: any) {
    return null;
  }
}
