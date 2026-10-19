/**
 * BookmarkPage
 * Displays user's saved Bookmarks and Reading History
 * Allows resuming chapters directly, switching sub-tabs, and clearing history
 */

import {
  state,
  initIcons,
  showToast,
  getMangaTitle,
  getCoverUrl,
  CoverCache,
  getStoredList,
  saveStoredList,
  STORAGE_KEY_BOOKMARKS,
  STORAGE_KEY_HISTORY
} from '../state.js';
import { getBookmarks, updateAllCollectionBadges } from '../services/storage.js';
import { openReader, openExternalReader, openEnglishReader, extractChapterNumber } from '../components/Reader.js';
import { ensureUnifiedChapterList, openUnifiedChapter } from '../components/ChapterList.js';

export function renderBookmarkPageMarkup() {
  return `
    <section class="view-section hidden" id="view-history">
      <div class="history-container">
        <div class="section-header">
          <div class="section-title-wrap">
            <h2 class="section-title" id="collection-view-title">Koleksi Saya</h2>
            <span class="section-badge" id="history-count-badge">0 Judul</span>
          </div>
          <button class="btn-clear-history hidden" id="btn-clear-history" title="Bersihkan Seluruh Riwayat Baca">
            <i data-lucide="trash-2"></i>
            <span>Hapus Riwayat</span>
          </button>
        </div>

        <!-- Collection Subtabs: Bookmark vs History -->
        <div class="collection-tabs-wrap">
          <button class="collection-tab active" id="tab-collection-bookmarks" data-tab="bookmarks">
            <i data-lucide="bookmark"></i>
            <span>Bookmark Saya</span>
            <span class="collection-tab-count" id="count-collection-bookmarks">0</span>
          </button>
          <button class="collection-tab" id="tab-collection-history" data-tab="history">
            <i data-lucide="clock"></i>
            <span>Riwayat Membaca</span>
            <span class="collection-tab-count" id="count-collection-history">0</span>
          </button>
        </div>

        <div class="history-grid" id="history-grid">
          <!-- Rendered dynamically -->
        </div>
      </div>
    </section>
  `;
}

export function switchCollectionTab(tabName) {
  state.currentCollectionTab = tabName;

  const tabBkm = document.getElementById('tab-collection-bookmarks');
  const tabHist = document.getElementById('tab-collection-history');
  const clearBtn = document.getElementById('btn-clear-history');
  const viewTitle = document.getElementById('collection-view-title');

  if (tabName === 'bookmarks') {
    tabBkm?.classList.add('active');
    tabHist?.classList.remove('active');
    clearBtn?.classList.add('hidden');
    if (viewTitle) viewTitle.textContent = 'Bookmark Saya';
    renderBookmarksList();
  } else {
    tabHist?.classList.add('active');
    tabBkm?.classList.remove('active');
    clearBtn?.classList.remove('hidden');
    if (viewTitle) viewTitle.textContent = 'Riwayat Membaca';
    renderHistoryList();
  }
  updateAllCollectionBadges();
}

export function renderBookmarksList() {
  const rawBookmarks = getBookmarks();
  const validBookmarks = [];

  rawBookmarks.forEach(item => {
    if (!item) return;
    const title = (item.title && item.title !== 'undefined')
      ? item.title
      : (item.attributes ? getMangaTitle(item.attributes) : '');

    if (!title || title === 'undefined' || !item.id) return;

    const coverUrl = (item.coverUrl && item.coverUrl !== 'undefined')
      ? item.coverUrl
      : (item.attributes ? getCoverUrl(item) : 'https://placehold.co/300x420/1e2025/ffffff?text=Cover');

    const status = (item.status && item.status !== 'undefined')
      ? item.status
      : (item.attributes?.status ? item.attributes.status.toUpperCase() : 'ONGOING');

    const author = (item.author && item.author !== 'undefined')
      ? item.author
      : '';

    validBookmarks.push({
      id: item.id,
      title,
      coverUrl,
      status,
      author
    });
  });

  if (validBookmarks.length !== rawBookmarks.length) {
    saveStoredList(STORAGE_KEY_BOOKMARKS, validBookmarks);
    updateAllCollectionBadges();
  }

  const grid = document.getElementById('history-grid');
  const countBadge = document.getElementById('history-count-badge');
  if (countBadge) countBadge.textContent = `${validBookmarks.length} Komik`;

  if (!grid) return;

  if (validBookmarks.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <i data-lucide="bookmark" style="width: 48px; height: 48px; margin-bottom: 1rem; color: var(--accent);"></i>
        <h3>Belum Ada Komik di Bookmark</h3>
        <p>Tandai komik favorit Anda dengan tombol Bookmark agar tersimpan dan mudah diakses kapan saja.</p>
        <button class="btn-explore" id="btn-explore-bookmarks-empty" style="margin-top: 1rem;">Jelajahi Manga Sekarang</button>
      </div>
    `;
    document.getElementById('btn-explore-bookmarks-empty')?.addEventListener('click', () => {
      if (typeof window.switchView === 'function') window.switchView('home');
    });
    initIcons();
    return;
  }

  grid.innerHTML = '';
  validBookmarks.forEach(item => {
    const card = document.createElement('div');
    card.className = 'bookmark-card';
    card.innerHTML = `
      <img src="${item.coverUrl}" class="bookmark-thumb" alt="${item.title}" onerror="this.src='https://placehold.co/300x420/1e2025/ffffff?text=Cover'">
      <div class="bookmark-info">
        <h4 class="bookmark-title" title="${item.title}">${item.title}</h4>
        <div class="bookmark-meta">
          <span class="bookmark-status">${item.status || 'ONGOING'}</span>
          ${item.author ? `<span class="bookmark-date">Oleh ${item.author}</span>` : ''}
        </div>
        <div class="bookmark-actions">
          <button class="btn-primary btn-open-detail" type="button">
            <i data-lucide="book-open"></i>
            <span>Buka Info</span>
          </button>
          <button class="btn-remove-bookmark" type="button" title="Hapus dari Bookmark">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;

    card.querySelector('.btn-open-detail')?.addEventListener('click', () => {
      if (typeof window.openMangaDetail === 'function') {
        window.openMangaDetail(item.id);
      }
    });

    card.querySelector('.btn-remove-bookmark')?.addEventListener('click', () => {
      let bks = getBookmarks();
      bks = bks.filter(b => b.id !== item.id);
      saveStoredList(STORAGE_KEY_BOOKMARKS, bks);
      state.bookmarkSet.delete(item.id);
      updateAllCollectionBadges();
      renderBookmarksList();
      showToast(`"${item.title}" dihapus dari Bookmark.`);
    });

    grid.appendChild(card);
  });

  initIcons();
}
window.renderBookmarksList = renderBookmarksList;

export async function resumeReadingChapter(mangaId, chapterId, chapterNum, historyItem = null) {
  showToast(`Melanjutkan ${chapterNum || 'chapter'}...`);

  state.currentUnifiedChapter = null;
  state.currentChapterId = chapterId;
  state.isAutoNavigatingNext = false;

  if (window.OfflineManager) {
    try {
      const isDown = await OfflineManager.isChapterDownloaded(chapterId);
      if (isDown) {
        const offM = await OfflineManager.db.manga.get(mangaId);
        if (offM) {
          state.currentManga = {
            id: offM.id,
            title: offM.title,
            coverUrl: offM.coverUrl || '',
            coverBlob: offM.coverBlob || null,
            attributes: {
              title: { en: offM.title },
              description: { id: offM.synopsis || '' },
              coverUrl: offM.coverUrl || ''
            }
          };
        }
        const offlineChs = await OfflineManager.db.chapters.where('mangaId').equals(mangaId).toArray();
        if (offlineChs && offlineChs.length > 0) {
          const sorted = offlineChs.sort((a, b) => parseFloat(a.chapterNumber || '0') - parseFloat(b.chapterNumber || '0'));
          state.allMangaDexChapters = [];
          state.currentSource = offM?.source || 'mangadex';
          const targetIndex = sorted.findIndex(c => c.id === chapterId);
          const resolvedIndex = targetIndex !== -1 ? targetIndex : 0;
          const targetCh = sorted[resolvedIndex];

          if (state.currentSource === 'english') {
            state.isExternal = true;
            const allExternal = sorted.map(c => ({
              url: c.id,
              title: c.title,
              num: parseFloat(c.chapterNumber || '1')
            }));
            state.englishChapters = allExternal;
            openEnglishReader(targetCh.id, targetCh.title, allExternal, resolvedIndex);
          } else if (state.currentSource === 'bacakomik') {
            state.isExternal = true;
            const allExternal = sorted.map(c => ({
              url: c.id,
              title: c.title,
              num: parseFloat(c.chapterNumber || '1')
            }));
            state.externalChapters = allExternal;
            openExternalReader(targetCh.id, targetCh.title, allExternal, resolvedIndex);
          } else {
            state.isExternal = false;
            state.currentChapters = sorted.map(c => ({
              id: c.id,
              mangaId: mangaId,
              attributes: {
                chapter: c.chapterNumber,
                title: c.title
              }
            }));
            state.allMangaDexChapters = state.currentChapters;
            openReader(targetCh.id, resolvedIndex);
          }
          return;
        }
      }
    } catch (e) {
      console.warn('Offline check failed in resumeReadingChapter:', e);
    }
  }

  // 1. Reset stale chapters if switching manga
  if (!state.currentManga || state.currentManga.id !== mangaId) {
    state.unifiedChapters = null;
    state.activeChapters = [];
    state.currentChapters = [];
  }

  // 2. Hydrate manga metadata if needed
  if (mangaId && !mangaId.startsWith('http') && mangaId.length > 20) {
    if (!state.currentManga || state.currentManga.id !== mangaId) {
      try {
        const res = await fetch(`/api/manga/${mangaId}`);
        if (res.ok) {
          const data = await res.json();
          state.currentManga = data.data;
        }
      } catch (e) {}
    }
  } else if (!state.currentManga || state.currentManga.id !== mangaId) {
    state.currentManga = {
      id: mangaId,
      title: historyItem?.title || 'Manga',
      coverUrl: historyItem?.coverUrl || ''
    };
  }

  // 3. Hydrate unified chapter list and AWAIT completion
  let unified = null;
  if (mangaId) {
    unified = await ensureUnifiedChapterList(mangaId, chapterId, state.currentManga);
  }
  if (!unified && state.unifiedChapters) {
    unified = state.unifiedChapters;
  }

  const idChapters = unified?.id || [];
  const enChapters = unified?.en || [];
  const targetNum = extractChapterNumber(chapterNum || chapterId);

  const isEnHint = (historyItem?.language === 'en') ||
    (chapterId && (chapterId.includes('mangapill') || chapterId.includes('asuracomic') || chapterId.includes('flamecomic') || chapterId.includes('/en/'))) ||
    (chapterNum && /\[en\]/i.test(chapterNum)) ||
    (mangaId && mangaId.includes('english'));

  // 4. Search by exact ID / URL
  let foundCh = null;
  let foundIdx = -1;
  let foundLang = null;

  if (isEnHint) {
    const idx = enChapters.findIndex(c => c.id === chapterId || c.url === chapterId || c.raw?.id === chapterId);
    if (idx !== -1) {
      foundCh = enChapters[idx];
      foundIdx = idx;
      foundLang = 'en';
    }
  }

  if (!foundCh) {
    const idx = idChapters.findIndex(c => c.id === chapterId || c.url === chapterId || c.raw?.id === chapterId);
    if (idx !== -1) {
      foundCh = idChapters[idx];
      foundIdx = idx;
      foundLang = 'id';
    }
  }

  if (!foundCh && !isEnHint) {
    const idx = enChapters.findIndex(c => c.id === chapterId || c.url === chapterId || c.raw?.id === chapterId);
    if (idx !== -1) {
      foundCh = enChapters[idx];
      foundIdx = idx;
      foundLang = 'en';
    }
  }

  // 5. Search by numeric chapter number (e.g. Chapter 87)
  if (!foundCh && !isNaN(targetNum)) {
    if (isEnHint) {
      const idx = enChapters.findIndex(c => extractChapterNumber(c) === targetNum);
      if (idx !== -1) {
        foundCh = enChapters[idx];
        foundIdx = idx;
        foundLang = 'en';
      }
    }

    if (!foundCh) {
      const idx = idChapters.findIndex(c => extractChapterNumber(c) === targetNum);
      if (idx !== -1) {
        foundCh = idChapters[idx];
        foundIdx = idx;
        foundLang = 'id';
      }
    }

    if (!foundCh && !isEnHint) {
      const idx = enChapters.findIndex(c => extractChapterNumber(c) === targetNum);
      if (idx !== -1) {
        foundCh = enChapters[idx];
        foundIdx = idx;
        foundLang = 'en';
      }
    }
  }

  // 6. Closest chapter number fallback (e.g. 87.1 or within 0.5)
  if (!foundCh && !isNaN(targetNum)) {
    const findClosestIn = (pool) => {
      let best = -1;
      let minDiff = Infinity;
      pool.forEach((c, i) => {
        const n = extractChapterNumber(c);
        if (!isNaN(n)) {
          const diff = Math.abs(n - targetNum);
          if (diff < minDiff) {
            minDiff = diff;
            best = i;
          }
        }
      });
      return (minDiff <= 1.0) ? best : -1;
    };

    if (isEnHint) {
      const cIdx = findClosestIn(enChapters);
      if (cIdx !== -1) {
        foundCh = enChapters[cIdx];
        foundIdx = cIdx;
        foundLang = 'en';
      }
    }
    if (!foundCh) {
      const cIdx = findClosestIn(idChapters);
      if (cIdx !== -1) {
        foundCh = idChapters[cIdx];
        foundIdx = cIdx;
        foundLang = 'id';
      }
    }
    if (!foundCh && !isEnHint) {
      const cIdx = findClosestIn(enChapters);
      if (cIdx !== -1) {
        foundCh = enChapters[cIdx];
        foundIdx = cIdx;
        foundLang = 'en';
      }
    }
  }

  // 7. If found in unified pool, launch reader immediately with accurate chapter & language!
  if (foundCh && foundIdx !== -1) {
    state.activeDetailLang = foundLang;
    state.currentReadingLang = foundLang;
    openUnifiedChapter(foundCh, foundIdx);
    return;
  }

  // 8. Fallback if chapter list could not be retrieved from network:
  const fallbackLang = (isEnHint || (enChapters.length > 0 && idChapters.length === 0)) ? 'en' : 'id';
  state.activeDetailLang = fallbackLang;
  state.currentReadingLang = fallbackLang;

  if (fallbackLang === 'en' || (chapterId && chapterId.startsWith('http') && (mangaId.includes('english') || chapterId.includes('mangapill')))) {
    state.currentSource = 'english';
    const chapters = enChapters.length > 0 ? enChapters.map(c => c.raw || c) : (state.englishChapters?.length > 0 ? state.englishChapters : [{ url: chapterId, title: chapterNum || 'Chapter' }]);
    const idx = chapters.findIndex(c => c.url === chapterId || c.id === chapterId || (!isNaN(targetNum) && extractChapterNumber(c) === targetNum));
    openEnglishReader(chapterId, chapterNum || 'Chapter', chapters, idx !== -1 ? idx : 0);
    return;
  }

  if (chapterId && chapterId.startsWith('http')) {
    state.currentSource = 'bacakomik';
    const chapters = idChapters.length > 0 ? idChapters.map(c => c.raw || c) : (state.externalChapters?.length > 0 ? state.externalChapters : [{ url: chapterId, title: chapterNum || 'Chapter' }]);
    const idx = chapters.findIndex(c => c.url === chapterId || c.id === chapterId || (!isNaN(targetNum) && extractChapterNumber(c) === targetNum));
    openExternalReader(chapterId, chapterNum || 'Chapter', chapters, idx !== -1 ? idx : 0);
    return;
  }

  // MangaDex chapter ID
  const mdChapters = state.allMangaDexChapters?.length > 0 ? state.allMangaDexChapters : (state.currentChapters || []);
  const idx = mdChapters.findIndex(c => c.id === chapterId || (!isNaN(targetNum) && extractChapterNumber(c) === targetNum));
  openReader(chapterId, idx !== -1 ? idx : 0);
}

window.resumeReadingChapter = resumeReadingChapter;

export async function renderHistoryList() {
  const history = getStoredList(STORAGE_KEY_HISTORY);
  const grid = document.getElementById('history-grid');
  const countBadge = document.getElementById('history-count-badge');
  if (countBadge) countBadge.textContent = `${history.length} Judul`;

  if (!grid) return;

  if (history.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <i data-lucide="clock" style="width: 48px; height: 48px; margin-bottom: 1rem; color: var(--text-subtle);"></i>
        <h3>Belum Ada Riwayat Membaca</h3>
        <p>Komik dan chapter yang Anda buka akan otomatis tercatat di sini agar Anda bisa melanjutkan kapan saja.</p>
        <button class="btn-explore" id="btn-explore-history-empty" style="margin-top: 1rem;">Jelajahi Manga Sekarang</button>
      </div>
    `;
    document.getElementById('btn-explore-history-empty')?.addEventListener('click', () => {
      if (typeof window.switchView === 'function') window.switchView('home');
    });
    initIcons();
    return;
  }

  let offlineMap = new Map();
  if (typeof OfflineManager !== 'undefined' && OfflineManager.db?.manga) {
    try {
      const offMangas = await OfflineManager.getAllOfflineManga();
      offlineMap = new Map(offMangas.map(m => [m.id, m]));
    } catch (e) {
      console.warn('Could not read offline manga for history covers:', e);
    }
  }

  let historyDirty = false;

  grid.innerHTML = '';
  history.forEach(item => {
    let coverSrc = item.coverUrl;
    const offM = offlineMap.get(item.mangaId);

    if (offM) {
      if (offM.coverBlob && offM.coverBlob instanceof Blob && offM.coverBlob.size > 100) {
        coverSrc = URL.createObjectURL(offM.coverBlob);
        state.activeObjectUrls.push(coverSrc);
      } else if (offM.coverUrl && !offM.coverUrl.includes('No+Cover')) {
        coverSrc = offM.coverUrl;
        if (!item.coverUrl || item.coverUrl.includes('No+Cover')) {
          item.coverUrl = offM.coverUrl;
          historyDirty = true;
        }
      }
    }

    if (!coverSrc || coverSrc.includes('No+Cover')) {
      const cached = CoverCache.get(item.mangaId, item.title);
      if (cached) {
        coverSrc = cached;
        item.coverUrl = cached;
        historyDirty = true;
      }
    }

    if (!coverSrc || coverSrc.includes('No+Cover')) {
      const bookmarked = getBookmarks().find(b => b.id === item.mangaId);
      if (bookmarked?.coverUrl && !bookmarked.coverUrl.includes('No+Cover')) {
        coverSrc = bookmarked.coverUrl;
        item.coverUrl = coverSrc;
        historyDirty = true;
      }
    }

    if (item.chapterNum) {
      if (/^(bab|chapter)\s*(bab|chapter)\b/i.test(item.chapterNum) || /^bab\b/i.test(item.chapterNum)) {
        item.chapterNum = item.chapterNum.replace(/^(bab|chapter)\s*(bab|chapter)\b/i, 'Chapter').replace(/^bab\b/i, 'Chapter');
        historyDirty = true;
      }
    }

    const dateStr = new Date(item.timestamp).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });

    const isPlaceholder = !coverSrc || coverSrc.includes('No+Cover');

    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <img src="${isPlaceholder ? 'https://placehold.co/300x420/1e2025/ffffff?text=Cover' : coverSrc}" 
           class="history-thumb" 
           alt="${item.title}" 
           data-manga-id="${item.mangaId || ''}"
           data-manga-title="${item.title || ''}"
           style="cursor: pointer;">
      <div class="history-info" style="cursor: pointer;">
        <h4 class="history-title">${item.title}</h4>
        <div class="history-chapter">Terakhir dibaca: <strong>${item.chapterNum}</strong></div>
        <div class="history-date">Dibaca pada ${dateStr}</div>
      </div>
      <button class="btn-primary btn-resume-reading" type="button">
        <i data-lucide="play"></i>
        <span>Lanjut Baca</span>
      </button>
    `;

    card.querySelector('.history-thumb')?.addEventListener('click', () => {
      if (typeof window.openMangaDetail === 'function') {
        window.openMangaDetail(item.mangaId);
      }
    });

    card.querySelector('.history-info')?.addEventListener('click', () => {
      if (typeof window.openMangaDetail === 'function') {
        window.openMangaDetail(item.mangaId);
      }
    });

    card.querySelector('.btn-resume-reading')?.addEventListener('click', () => {
      resumeReadingChapter(item.mangaId, item.chapterId, item.chapterNum, item);
    });

    grid.appendChild(card);

    if (isPlaceholder) {
      resolveMissingHistoryCover(card.querySelector('.history-thumb'), item.title, item.mangaId);
    }
  });

  if (historyDirty) {
    saveStoredList(STORAGE_KEY_HISTORY, history);
  }

  initIcons();
}
window.renderHistoryList = renderHistoryList;

export async function resolveMissingHistoryCover(imgElement, mangaTitle, mangaId) {
  if (!imgElement) return;
  try {
    if (mangaId && !mangaId.startsWith('http') && mangaId.length > 20) {
      const res = await fetch(`/api/manga/${mangaId}`);
      if (res.ok) {
        const data = await res.json();
        const coverRel = data.data?.relationships?.find(r => r.type === 'cover_art');
        const fileName = coverRel?.attributes?.fileName;
        if (fileName) {
          const coverUrl = `/api/cover/${mangaId}/${fileName}.512.jpg`;
          applyResolvedHistoryCover(imgElement, mangaTitle, mangaId, coverUrl);
          return;
        }
      }
    }

    if (mangaTitle) {
      const cleanTitle = mangaTitle.replace(/[\[\(].*?[\]\)]/g, '').replace(/[^\w\s]/gi, ' ').trim();
      const res = await fetch(`/api/search?q=${encodeURIComponent(cleanTitle || mangaTitle)}&limit=3`);
      if (res.ok) {
        const data = await res.json();
        const firstManga = data.data?.[0];
        if (firstManga) {
          const coverRel = firstManga.relationships?.find(r => r.type === 'cover_art');
          const fileName = coverRel?.attributes?.fileName;
          if (fileName) {
            const coverUrl = `/api/cover/${firstManga.id}/${fileName}.512.jpg`;
            applyResolvedHistoryCover(imgElement, mangaTitle, firstManga.id, coverUrl);
            return;
          }
        }
      }
    }
  } catch (err) {
    console.warn(`Could not resolve missing cover for ${mangaTitle}:`, err);
  }
}

export function applyResolvedHistoryCover(imgElement, mangaTitle, mangaId, coverUrl) {
  if (imgElement) imgElement.src = coverUrl;
  CoverCache.set(mangaId, mangaTitle, coverUrl);

  const history = getStoredList(STORAGE_KEY_HISTORY);
  let changed = false;
  history.forEach(item => {
    if (item.title === mangaTitle || (mangaId && item.mangaId === mangaId)) {
      item.coverUrl = coverUrl;
      if (mangaId && (!item.mangaId || item.mangaId.startsWith('http'))) {
        item.mangaId = mangaId;
      }
      changed = true;
    }
  });

  if (changed) {
    saveStoredList(STORAGE_KEY_HISTORY, history);
  }
}

export function initBookmarkPageEvents() {
  const tabBkm = document.getElementById('tab-collection-bookmarks');
  const tabHist = document.getElementById('tab-collection-history');

  tabBkm?.addEventListener('click', () => switchCollectionTab('bookmarks'));
  tabHist?.addEventListener('click', () => switchCollectionTab('history'));

  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    if (confirm('Apakah Anda yakin ingin menghapus seluruh riwayat membaca?')) {
      localStorage.removeItem(STORAGE_KEY_HISTORY);
      renderHistoryList();
      updateAllCollectionBadges();
      showToast('Riwayat membaca telah dibersihkan.');
    }
  });
}
