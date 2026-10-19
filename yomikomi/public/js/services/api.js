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

export async function fetchAniListBanner(title) {
  try {
    const res = await fetch(`/api/anilist/banner?title=${encodeURIComponent(title)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.bannerImage || null;
  } catch (e) {
    return null;
  }
}
