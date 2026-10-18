/**
 * Unified Manga & Manhwa Data Schema
 * Standardized interfaces for multi-source aggregation (Adapter Pattern)
 */

export type MangaSource =
  | 'mangadex'
  | 'komiku'
  | 'consumet'
  | 'komikcast'
  | 'bacakomik'
  | (string & {});

export type ComicType = 'manga' | 'manhwa' | 'manhua' | 'comic';

export type PublicationStatus = 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | 'unknown' | string;

/**
 * Basic summary of a manga/manhwa for listings, search results, and cards
 */
export interface MangaSummary {
  /** Unique ID within the provider */
  id: string;
  /** URL-friendly identifier */
  slug: string;
  /** Data source identifier */
  source: MangaSource;
  /** Primary title */
  title: string;
  /** Direct or optimized cover URL */
  coverUrl: string;
  /** Comic category */
  type: ComicType;
  /** Latest chapter label or number if known (e.g. "Ch. 79") */
  latestChapter?: string;
  /** Rating score on a 10-point scale */
  rating?: number;
}

/**
 * Individual chapter representation
 */
export interface ChapterItem {
  /** Unique identifier for the chapter */
  id: string;
  /** Normalized chapter number (e.g. "1", "10.5", "79") */
  number: string;
  /** Descriptive chapter title (e.g. "Chapter 79: The Resolution") */
  title: string;
  /** Formatted release date or timestamp */
  releaseDate?: string;
  /** Origin source identifier */
  source: string;
  /** Language ISO code (e.g. "id", "en") */
  language?: 'id' | 'en' | string;
  /** Name of the scanlation group */
  scanlationGroup?: string;
}

/**
 * Detailed manga information including chapters and metadata
 */
export interface MangaDetail extends MangaSummary {
  /** Alternative and translated titles (Korean, English, Romaji, etc.) */
  altTitles: string[];
  /** Synopsis / plot description */
  synopsis: string;
  /** Publication status */
  status: PublicationStatus;
  /** Genre and tag names */
  genres: string[];
  /** Author or illustrator name */
  author?: string;
  /** High resolution banner image (from AniList or provider) */
  bannerUrl?: string;
  /** Full list of available chapters */
  chapters: ChapterItem[];
}

/**
 * Individual page image inside a chapter
 */
export interface ChapterPage {
  /** 1-based page index */
  pageNumber: number;
  /** Original direct image URL from source */
  imageUrl: string;
  /** Proxied and WebP-compressed URL for fast, hotlink-safe loading */
  proxiedUrl: string;
  /** Required Referer header for anti-403 bypass if proxied internally */
  referer?: string;
}

/**
 * Full chapter viewer payload
 */
export interface ChapterDetail {
  chapterId: string;
  mangaId?: string;
  chapterNumber: string;
  chapterTitle?: string;
  source: string;
  totalPages: number;
  pages: ChapterPage[];
}

/**
 * Pagination & filter options for providers
 */
export interface ProviderFilterOptions {
  page?: number;
  limit?: number;
  type?: ComicType;
  language?: 'id' | 'en' | 'all';
  order?: 'asc' | 'desc';
}
