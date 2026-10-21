/**
 * API Aggregator Service
 * Coordinates multi-source providers (MangaDex, Indo Mirror, English Mirror)
 */

export async function fetchBacakomikSearch(query) {
  if (!query) return [];
  const res = await fetch(`/api/external/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Bacakomik Search HTTP ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

export async function fetchBacakomikChapters(comicUrl) {
  if (!comicUrl) return [];
  const res = await fetch(`/api/external/chapters?url=${encodeURIComponent(comicUrl)}`);
  if (!res.ok) throw new Error(`Bacakomik Chapters HTTP ${res.status}`);
  const data = await res.json();
  return data.chapters || [];
}

export async function fetchBacakomikPages(chapterUrl) {
  if (!chapterUrl) return [];
  const res = await fetch(`/api/external/chapter-pages?url=${encodeURIComponent(chapterUrl)}`);
  if (!res.ok) throw new Error(`Bacakomik Pages HTTP ${res.status}`);
  const data = await res.json();
  return data.pages || [];
}

export async function fetchEnglishSearch(query) {
  if (!query) return [];
  const res = await fetch(`/api/external/en/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`English Search HTTP ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

export async function fetchEnglishChapters(comicUrl) {
  if (!comicUrl) return [];
  const res = await fetch(`/api/external/en/chapters?url=${encodeURIComponent(comicUrl)}`);
  if (!res.ok) throw new Error(`English Chapters HTTP ${res.status}`);
  const data = await res.json();
  return data.chapters || [];
}

export async function fetchEnglishPages(chapterUrl) {
  if (!chapterUrl) return [];
  const res = await fetch(`/api/external/en/chapter-pages?url=${encodeURIComponent(chapterUrl)}`);
  if (!res.ok) throw new Error(`English Pages HTTP ${res.status}`);
  const data = await res.json();
  return data.pages || [];
}

// In-memory cache for AniList metadata to avoid re-fetching
const anilistCache = new Map();

/**
 * Fetch rich AniList metadata (bannerImage, averageScore, ratingFormatted, genres)
 */
export async function fetchAniList(title) {
  if (!title) return null;
  const clean = title.trim().toLowerCase();
  if (anilistCache.has(clean)) return anilistCache.get(clean);

  try {
    const res = await fetch(`/api/anilist?title=${encodeURIComponent(title)}`);
    if (!res.ok) return null;
    const data = await res.json();
    anilistCache.set(clean, data);
    return data;
  } catch (e) {
    return null;
  }
}

export async function fetchAniListBanner(title) {
  const meta = await fetchAniList(title);
  return meta?.bannerImage || null;
}

// ==========================================
// KOMIKU INDO SCRAPER API CLIENT
// ==========================================

export async function fetchKomikuSearch(query) {
  if (!query || !query.trim()) return [];
  try {
    const res = await fetch(`/api/komiku/search?q=${encodeURIComponent(query.trim())}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    console.error('fetchKomikuSearch error:', e);
    return [];
  }
}

export async function fetchKomikuLatest(page = 1) {
  try {
    const res = await fetch(`/api/komiku/latest?page=${encodeURIComponent(page)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    console.error('fetchKomikuLatest error:', e);
    return [];
  }
}

export async function fetchKomikuManga(slug) {
  try {
    const cleanSlug = slug.replace(/^komiku-/, '');
    const res = await fetch(`/api/komiku/manga/${encodeURIComponent(cleanSlug)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.data || null;
  } catch (e) {
    console.error('fetchKomikuManga error:', e);
    return null;
  }
}

export async function fetchKomikuChapterPages(urlOrSlug) {
  try {
    let endpoint = '/api/komiku/chapter-pages';
    if (urlOrSlug.startsWith('http')) {
      endpoint += `?url=${encodeURIComponent(urlOrSlug)}`;
    } else {
      endpoint += `?url=${encodeURIComponent(`https://komiku.org/${urlOrSlug.replace(/^\/+|\/+$/g, '')}/`)}`;
    }
    const res = await fetch(endpoint);
    if (!res.ok) return [];
    const data = await res.json();
    return data.pages || [];
  } catch (e) {
    console.error('fetchKomikuChapterPages error:', e);
    return [];
  }
}

