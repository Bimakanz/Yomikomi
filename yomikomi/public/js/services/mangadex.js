/**
 * MangaDex Service
 * Dedicated API module for MangaDex data operations
 */

import { CoverCache, getMangaTitle, getCoverUrl } from '../state.js';

export async function fetchPopularManga() {
  const res = await fetch('/api/popular');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const list = data.data || [];
  list.forEach(m => {
    CoverCache.set(m.id, getMangaTitle(m.attributes), getCoverUrl(m));
  });
  return list;
}

export async function fetchLatestManga() {
  const res = await fetch('/api/search?order=latest');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const list = data.data || [];
  list.forEach(m => {
    CoverCache.set(m.id, getMangaTitle(m.attributes), getCoverUrl(m));
  });
  return list;
}

export async function fetchMangaByGenre(tagId) {
  const res = await fetch(`/api/search?includedTags[]=${encodeURIComponent(tagId)}&order=popular`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const list = data.data || [];
  list.forEach(m => {
    CoverCache.set(m.id, getMangaTitle(m.attributes), getCoverUrl(m));
  });
  return list;
}

export async function searchManga(query) {
  if (!query || !query.trim()) return [];
  const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const list = data.data || [];
  list.forEach(m => {
    CoverCache.set(m.id, getMangaTitle(m.attributes), getCoverUrl(m));
  });
  return list;
}

export async function fetchMangaDetail(mangaId) {
  const res = await fetch(`/api/manga/${mangaId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.data) {
    CoverCache.set(data.data.id, getMangaTitle(data.data.attributes), getCoverUrl(data.data));
  }
  return data.data;
}

export async function fetchMangaChapters(mangaId, lang = 'all', order = 'asc') {
  let url = `/api/manga/${mangaId}/feed?order[chapter]=${order}`;
  if (lang === 'id') {
    url += '&translatedLanguage[]=id';
  } else if (lang === 'en') {
    url += '&translatedLanguage[]=en';
  } else {
    url += '&translatedLanguage[]=id&translatedLanguage[]=en';
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export async function fetchChapterPages(chapterId) {
  const res = await fetch(`/api/chapter/${chapterId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export async function fetchExploreFeed() {
  const res = await fetch('/api/explore');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}
