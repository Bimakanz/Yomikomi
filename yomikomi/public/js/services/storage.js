/**
 * Storage Service
 * Handles Bookmarks, History, and Dexie.js Offline Storage interaction
 */

import {
  state,
  STORAGE_KEY_BOOKMARKS,
  STORAGE_KEY_HISTORY,
  getStoredList,
  saveStoredList,
  getAnimeHistory,
  CoverCache,
  getMangaTitle,
  getCoverUrl
} from '../state.js';

export function getBookmarks() {
  return getStoredList(STORAGE_KEY_BOOKMARKS);
}

export function isBookmarked(mangaId) {
  if (!mangaId) return false;
  return state.bookmarkSet.has(mangaId);
}

export function refreshBookmarkSet() {
  const list = getBookmarks();
  state.bookmarkSet = new Set(list.map(b => b.id));
  updateAllCollectionBadges();
}

export function toggleBookmark(manga) {
  if (!manga || !manga.id) return false;
  let bookmarks = getBookmarks();
  const exists = bookmarks.some(b => b.id === manga.id);

  if (exists) {
    bookmarks = bookmarks.filter(b => b.id !== manga.id);
    state.bookmarkSet.delete(manga.id);
  } else {
    const title = manga.title || (manga.attributes ? getMangaTitle(manga.attributes) : 'Untitled');
    const coverUrl = manga.coverUrl || getCoverUrl(manga);
    bookmarks.unshift({
      id: manga.id,
      title,
      coverUrl,
      addedAt: Date.now()
    });
    state.bookmarkSet.add(manga.id);
    CoverCache.set(manga.id, title, coverUrl);
  }

  saveStoredList(STORAGE_KEY_BOOKMARKS, bookmarks);
  updateAllCollectionBadges();
  return !exists;
}

export function getHistory() {
  return getStoredList(STORAGE_KEY_HISTORY);
}

export async function saveReadingHistory(manga, chapter) {
  if (!manga || !chapter) return;
  const history = getStoredList(STORAGE_KEY_HISTORY);

  const title = (manga.attributes ? getMangaTitle(manga.attributes) : '') || manga.title || 'Manga Tanpa Judul';
  let coverUrl = getCoverUrl(manga);

  if (!coverUrl || coverUrl.includes('No+Cover')) {
    if (manga.coverUrl && !manga.coverUrl.includes('No+Cover')) {
      coverUrl = manga.coverUrl;
    } else if (typeof OfflineManager !== 'undefined' && OfflineManager.db?.manga) {
      try {
        const offM = await OfflineManager.db.manga.get(manga.id);
        if (offM?.coverUrl && !offM.coverUrl.includes('No+Cover')) {
          coverUrl = offM.coverUrl;
        }
      } catch (e) { }
    }
  }

  let chNum = '';
  const rawChapter = chapter.attributes?.chapter || chapter.chapterNumber || chapter.num || '';
  const rawTitle = chapter.attributes?.title || chapter.title || '';

  if (rawChapter) {
    const chStr = String(rawChapter).trim();
    if (/^(bab|chapter|ch\.?)/i.test(chStr)) {
      chNum = chStr.replace(/^bab\b/i, 'Chapter');
    } else {
      chNum = `Chapter ${chStr}`;
    }
    if (rawTitle && !rawTitle.toLowerCase().includes(chStr.toLowerCase())) {
      chNum += ` - ${rawTitle}`;
    }
  } else if (rawTitle) {
    chNum = rawTitle.replace(/^bab\b/i, 'Chapter');
  } else {
    chNum = 'Chapter Terbaru';
  }

  chNum = chNum.replace(/^(chapter|bab)\s+(chapter|bab)\b/i, 'Chapter').trim();

  const curLang = state.currentReadingLang || state.activeDetailLang || chapter.language || chapter.attributes?.translatedLanguage || 'id';
  const updated = history.filter(item => item.mangaId !== manga.id);
  updated.unshift({
    mangaId: manga.id,
    title: title,
    coverUrl: coverUrl,
    chapterId: chapter.id || chapter.url || state.currentChapterId,
    chapterNum: chNum,
    language: curLang,
    source: state.currentSource || chapter.source || '',
    timestamp: Date.now()
  });

  saveStoredList(STORAGE_KEY_HISTORY, updated.slice(0, 50));
  updateAllCollectionBadges();
}

export function addToHistory(item) {
  if (!item || !item.mangaId) return;
  let history = getHistory();
  history = history.filter(h => h.mangaId !== item.mangaId);
  history.unshift({
    ...item,
    readAt: Date.now()
  });
  if (history.length > 100) history = history.slice(0, 100);
  saveStoredList(STORAGE_KEY_HISTORY, history);
  updateAllCollectionBadges();
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY_HISTORY);
  updateAllCollectionBadges();
}

export function updateAllCollectionBadges() {
  const bookmarks = getBookmarks();
  const history = getHistory();

  const bCount = bookmarks.length;
  const hCount = history.length;

  // Desktop Navbar badges
  const navBadgeBookmarks = document.getElementById('badge-nav-bookmarks');
  if (navBadgeBookmarks) {
    navBadgeBookmarks.textContent = bCount;
    if (bCount > 0) navBadgeBookmarks.classList.remove('hidden');
    else navBadgeBookmarks.classList.add('hidden');
  }

  // Mobile Drawer badges
  const drawerBadgeBookmarks = document.getElementById('drawer-badge-bookmarks');
  if (drawerBadgeBookmarks) drawerBadgeBookmarks.textContent = bCount;

  const drawerBadgeHistory = document.getElementById('drawer-badge-history');
  if (drawerBadgeHistory) drawerBadgeHistory.textContent = hCount;

  // Collection Page subtab counts
  const tabCountBookmarks = document.getElementById('count-collection-bookmarks');
  if (tabCountBookmarks) tabCountBookmarks.textContent = bCount;

  const tabCountHistory = document.getElementById('count-collection-history');
  if (tabCountHistory) tabCountHistory.textContent = hCount;

  const tabCountAnime = document.getElementById('count-collection-anime');
  if (tabCountAnime) {
    try {
      const aCount = (typeof getAnimeHistory === 'function' ? getAnimeHistory() : []).length;
      tabCountAnime.textContent = aCount;
    } catch (e) {
      tabCountAnime.textContent = 0;
    }
  }
}

export async function getStorageUsage() {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      const usageMb = (usage / (1024 * 1024)).toFixed(1);
      const quotaMb = (quota / (1024 * 1024)).toFixed(1);
      const percent = Math.round((usage / quota) * 100);
      return { usageMb, quotaMb, percent };
    } catch (e) {
      return null;
    }
  }
  return null;
}
