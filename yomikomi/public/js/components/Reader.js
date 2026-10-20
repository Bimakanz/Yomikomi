/**
 * Reader Component
 * Core Manga & Webtoon Reader Engine
 * Supports: Long-strip (Webtoon), Single Page (with panel slicing for tall strips), Double Page
 * 3-Stage Auto-Fallback Proxy Image Loader & Progressive IntersectionObserver
 */

import { state, initIcons, showToast, getMangaTitle, revokeActiveObjectUrls } from '../state.js';
import { saveReadingHistory } from '../services/storage.js';
import { updateCustomChapterDropdown, ensureUnifiedChapterList, openUnifiedChapter } from './ChapterList.js';

export function getReaderStageUrl(rawUrl, stage = 0, retryTimestamp = null) {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) {
    return rawUrl;
  }

  let cleanUrl = rawUrl;
  while (typeof cleanUrl === 'string' && (cleanUrl.startsWith('/api/proxy-image?url=') || cleanUrl.startsWith('/api/proxy/image?url='))) {
    cleanUrl = decodeURIComponent(cleanUrl.replace(/^\/api\/proxy[-/]image\?url=/, ''));
  }

  const ts = retryTimestamp || Date.now();
  const isMangaDex = cleanUrl.includes('mangadex.org') || cleanUrl.includes('mangadex.network');

  if (isMangaDex) {
    // Note: MangaDex domains are blocked by wsrv.nl policy (Domain blocked). Never send MangaDex to wsrv.nl!
    if (stage === 0) {
      // Stage 0: Direct MangaDex @Home URL
      return cleanUrl;
    } else if (stage === 1) {
      // Stage 1: Yomikomi internal proxy (handles ISP DNS unblocking and upstream node failover)
      return `/api/proxy/image?url=${encodeURIComponent(cleanUrl)}&t=${ts}`;
    } else if (stage === 2) {
      // Stage 2: Direct official CDN fallback if node URL
      if (cleanUrl.includes('mangadex.network')) {
        try {
          const u = new URL(cleanUrl);
          return `https://uploads.mangadex.org${u.pathname}${u.search ? u.search + '&' : '?'}retry=${ts}`;
        } catch (e) {}
      }
      return `/api/proxy/image?url=${encodeURIComponent(cleanUrl)}&alt=1&t=${ts}`;
    } else {
      // Stage 3: Direct URL with cache-buster
      const sep = cleanUrl.includes('?') ? '&' : '?';
      return `${cleanUrl}${sep}retry=${ts}`;
    }
  }

  // Non-MangaDex images (Komiku, Bacakomik, Mangapill, external CDNs)
  if (stage === 0) {
    // Stage 0: Edge CDN proxy (wsrv.nl) with WebP output & quality 80
    return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&output=webp&q=80&we&n=-1`;
  } else if (stage === 1) {
    // Stage 1: Local proxy
    return `/api/proxy/image?url=${encodeURIComponent(cleanUrl)}&t=${ts}`;
  } else if (stage === 2) {
    // Stage 2: Direct URL
    return cleanUrl;
  } else {
    // Stage 3: Direct URL + cache buster
    const sep = cleanUrl.includes('?') ? '&' : '?';
    return `${cleanUrl}${sep}retry=${ts}`;
  }
}

window.getReaderStageUrl = getReaderStageUrl;

export function applyImageStage(imgEl, rawUrl, stage = 0) {
  if (!imgEl || !rawUrl) return;

  // Clear previous watchdog timer
  if (imgEl._watchdogTimer) {
    clearTimeout(imgEl._watchdogTimer);
    imgEl._watchdogTimer = null;
  }

  // Blob or Data URLs (e.g. offline downloaded chapters) load immediately
  if (rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) {
    imgEl.dataset.retryStage = '0';
    imgEl.removeAttribute('referrerpolicy');
    imgEl.removeAttribute('crossorigin');
    imgEl.src = rawUrl;
    return;
  }

  const ts = Date.now();
  imgEl.dataset.retryStage = String(stage);
  const isMangaDex = typeof rawUrl === 'string' && (rawUrl.includes('mangadex.org') || rawUrl.includes('mangadex.network'));

  if (stage === 0) {
    if (isMangaDex) {
      imgEl.referrerPolicy = 'no-referrer';
    } else {
      imgEl.removeAttribute('referrerpolicy');
    }
    imgEl.removeAttribute('crossorigin');
    imgEl.src = getReaderStageUrl(rawUrl, 0, ts);
  } else if (stage === 1) {
    imgEl.referrerPolicy = 'no-referrer';
    imgEl.removeAttribute('crossorigin');
    imgEl.src = getReaderStageUrl(rawUrl, 1, ts);
  } else if (stage === 2) {
    imgEl.referrerPolicy = 'no-referrer';
    imgEl.removeAttribute('crossorigin');
    imgEl.src = getReaderStageUrl(rawUrl, 2, ts);
  } else if (stage === 3) {
    imgEl.referrerPolicy = 'no-referrer';
    imgEl.removeAttribute('crossorigin');
    imgEl.src = getReaderStageUrl(rawUrl, 3, ts);
  }

  // 6000ms Watchdog Timeout
  imgEl._watchdogTimer = setTimeout(() => {
    if (!imgEl.isConnected) return;
    if (imgEl.classList.contains('visible') || (imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0)) return;
    console.warn(`[ReaderWatchdog] Image page ${imgEl.dataset.page} stalled at stage ${stage} (>6s). Advancing...`);
    advanceImageRetryStage(imgEl, false);
  }, 6000);
}

window.applyImageStage = applyImageStage;

export function advanceImageRetryStage(imgEl, isUserTap = false) {
  if (!imgEl) return;
  if (imgEl._watchdogTimer) {
    clearTimeout(imgEl._watchdogTimer);
    imgEl._watchdogTimer = null;
  }

  const wrapper = imgEl.closest('.reader-page-wrapper') || imgEl.parentElement;
  const rawUrl = imgEl.dataset.rawUrl;
  let stage = parseInt(imgEl.dataset.retryStage || '0', 10);
  const nextStage = stage + 1;

  if (nextStage <= 3) {
    applyImageStage(imgEl, rawUrl, nextStage);
    return;
  }

  // All 4 stages failed/timed out, show retry button
  imgEl.dataset.retryStage = '4';
  if (!wrapper) return;
  const skeleton = wrapper.querySelector('.page-skeleton-loader');
  if (skeleton) skeleton.classList.add('fade-out');

  if (wrapper.querySelector('.page-error-retry')) return;

  const retryCard = document.createElement('div');
  retryCard.className = 'page-error-retry';
  retryCard.innerHTML = `
    <button class="btn-retry-page" type="button" title="Coba lagi" aria-label="Coba lagi">
      <i data-lucide="rotate-cw"></i>
    </button>
  `;

  retryCard.querySelector('.btn-retry-page')?.addEventListener('click', (e) => {
    e.stopPropagation();
    retryCard.remove();
    if (skeleton) skeleton.classList.remove('fade-out');
    imgEl.classList.remove('visible');
    applyImageStage(imgEl, rawUrl, 0);
  });

  wrapper.appendChild(retryCard);
  initIcons();
}

window.advanceImageRetryStage = advanceImageRetryStage;

export function loadReaderPageImage(imgEl) {
  if (!imgEl) return;
  if (imgEl.dataset.startedLoading === 'true') return;
  imgEl.dataset.startedLoading = 'true';

  const rawUrl = imgEl.dataset.rawUrl;
  if (!rawUrl) return;

  applyImageStage(imgEl, rawUrl, 0);
}

window.loadReaderPageImage = loadReaderPageImage;

export function triggerNextPageLoad(imgEl) {
  const pageNum = parseInt(imgEl.dataset.page || '0', 10);
  if (!pageNum) return;

  for (let offset = 1; offset <= 2; offset++) {
    const nextWrap = document.querySelector(`.reader-page-wrapper[data-page="${pageNum + offset}"]`);
    if (nextWrap) {
      const nextImg = nextWrap.querySelector('.reader-page-img');
      if (nextImg && nextImg.dataset.startedLoading !== 'true') {
        nextImg.setAttribute('fetchpriority', 'high');
        loadReaderPageImage(nextImg);
      }
    }
  }
}

window.triggerNextPageLoad = triggerNextPageLoad;

export function handlePageImageLoad(imgEl) {
  if (imgEl._watchdogTimer) {
    clearTimeout(imgEl._watchdogTimer);
    imgEl._watchdogTimer = null;
  }

  if (imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
    const isMangaDexBanner = (imgEl.naturalWidth === 600 && imgEl.naturalHeight === 642) ||
      (Math.abs(imgEl.naturalWidth - 600) <= 20 && Math.abs(imgEl.naturalHeight - 642) <= 20) ||
      (Math.abs(imgEl.naturalWidth - imgEl.naturalHeight) <= 60 && imgEl.naturalWidth >= 550 && imgEl.naturalWidth <= 650);

    if (isMangaDexBanner) {
      console.warn(`[ReaderImage] Intercepted MangaDex placeholder banner (${imgEl.naturalWidth}x${imgEl.naturalHeight}). Discarding and recovering...`);
      imgEl.classList.remove('visible');

      if (imgEl.src && imgEl.src.startsWith('blob:') && state.currentChapterId && window.OfflineManager) {
        window.OfflineManager.deleteChapter(state.currentChapterId, true).then(() => {
          openReader(state.currentChapterId, state.currentChapterIndex);
        });
        return;
      }

      handlePageImageError(imgEl);
      return;
    }
  }

  const singleSkeleton = document.getElementById('single-page-skeleton');
  if (singleSkeleton) {
    singleSkeleton.style.display = 'none';
  }

  const wrapper = imgEl.closest('.reader-page-wrapper');
  if (wrapper) {
    wrapper.classList.add('page-loaded');
    const skeleton = wrapper.querySelector('.page-skeleton-loader');
    if (skeleton) {
      skeleton.classList.add('fade-out');
      setTimeout(() => {
        try { skeleton.remove(); } catch (e) { }
      }, 350);
    }
    const err = wrapper.querySelector('.page-error-retry');
    if (err) err.remove();
  }
  imgEl.classList.add('visible');

  triggerNextPageLoad(imgEl);
}

window.handlePageImageLoad = handlePageImageLoad;

export function handlePageImageError(imgEl) {
  if (imgEl._watchdogTimer) {
    clearTimeout(imgEl._watchdogTimer);
    imgEl._watchdogTimer = null;
  }
  advanceImageRetryStage(imgEl, false);
}

window.handlePageImageError = handlePageImageError;

// Global In-Memory Chapter Pages Cache for 0ms Instant Loading (Like Native MangaDex)
window.prefetchedChaptersCache = window.prefetchedChaptersCache || new Map();
const inFlightPrefetches = new Map();

export async function prefetchChapter(ch) {
  if (!ch) return null;
  const key = ch.id || ch.url;
  if (!key) return null;

  if (window.prefetchedChaptersCache.has(key)) {
    return window.prefetchedChaptersCache.get(key);
  }
  if (inFlightPrefetches.has(key)) {
    return inFlightPrefetches.get(key);
  }

  const p = (async () => {
    try {
      let data = null;
      if (ch.source === 'mangadex' || (!ch.source && ch.id && !String(ch.id).startsWith('http') && !ch.url?.startsWith('http'))) {
        const res = await fetch(`/api/chapter/${ch.id}`);
        data = await res.json();
      } else if (ch.source === 'komiku' || ch.source === 'bacakomik' || String(ch.url || ch.id).includes('komiku')) {
        const targetUrl = ch.url || (String(ch.id).startsWith('http') ? ch.id : `https://komiku.org/${ch.id}/`);
        const res = await fetch(`/api/komiku/chapter-pages?url=${encodeURIComponent(targetUrl)}`);
        data = await res.json();
      } else {
        const targetUrl = ch.url || ch.id;
        const res = await fetch(`/api/external/en/chapter-pages?url=${encodeURIComponent(targetUrl)}`);
        data = await res.json();
      }

      if (data && (data.pages || data.dataSaverPages)) {
        window.prefetchedChaptersCache.set(key, data);
        if (ch.id) window.prefetchedChaptersCache.set(ch.id, data);
        if (ch.url) window.prefetchedChaptersCache.set(ch.url, data);

        // Warm first 4 images into browser cache so initial screen paints in 0ms
        const pages = (data.dataSaverPages && data.dataSaverPages.length > 0) ? data.dataSaverPages : (data.pages || []);
        pages.slice(0, 4).forEach(pageUrl => {
          const preImg = new Image();
          preImg.src = getReaderStageUrl(pageUrl, 0);
        });
        return data;
      }
    } catch (e) {
      // Background prefetch error silently ignored
    } finally {
      inFlightPrefetches.delete(key);
    }
    return null;
  })();

  inFlightPrefetches.set(key, p);
  return p;
}
window.prefetchChapter = prefetchChapter;

export async function openReader(chapterId, chapterIndex) {
  state.isExternal = false;
  state.currentChapterId = chapterId;
  state.currentChapterIndex = chapterIndex;
  state.currentPageIndex = 0;
  state.currentSingleSlice = 0;
  state.isAutoNavigatingNext = false;

  if (typeof window.switchView === 'function') {
    window.switchView('reader');
  }

  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const readerContainer = document.getElementById('view-reader');
  if (readerContainer) readerContainer.scrollTop = 0;

  const mangaTitle = getMangaTitle(state.currentManga?.attributes) || state.currentManga?.title || 'Manga';
  let chObj = null;
  if (state.currentUnifiedChapter && (state.currentUnifiedChapter.id === chapterId || state.currentUnifiedChapter.url === chapterId)) {
    chObj = state.currentUnifiedChapter;
  } else {
    state.currentUnifiedChapter = null;
    const pool = (state.activeChapters && state.activeChapters.length > 0) ? state.activeChapters : (state.currentChapters || []);
    chObj = pool.find(c => c.id === chapterId || c.url === chapterId) ||
            state.allMangaDexChapters?.find(c => c.id === chapterId) ||
            pool[chapterIndex] ||
            null;
  }
  const chNum = chObj?.title ||
    (chObj?.attributes?.chapter ? `Chapter ${chObj.attributes.chapter}` : '') ||
    (chObj?.chapterNumStr ? `Chapter ${chObj.chapterNumStr}` : 'Chapter');
  if (chObj?.language || chObj?.attributes?.translatedLanguage) {
    state.currentReadingLang = chObj.language || chObj.attributes.translatedLanguage;
    state.activeDetailLang = state.currentReadingLang;
  }

  const rMangaTitle = document.getElementById('reader-manga-title');
  const rChTitle = document.getElementById('reader-chapter-title');
  const footerPill = document.getElementById('footer-chapter-pill');
  if (rMangaTitle) rMangaTitle.textContent = mangaTitle;
  if (rChTitle) rChTitle.textContent = chNum;
  if (footerPill) footerPill.textContent = chNum;

  document.getElementById('reader-toolbar')?.classList.remove('hidden-bar');
  document.getElementById('reader-footer')?.classList.remove('hidden-bar');

  const curLang = state.activeDetailLang || state.currentReadingLang || 'id';
  let activeChapterPool = state.unifiedChapters?.[curLang];
  if (!activeChapterPool || activeChapterPool.length === 0) {
    activeChapterPool = (state.activeChapters && state.activeChapters.length > 0)
      ? state.activeChapters
      : state.currentChapters;
  }

  const dropItems = activeChapterPool.map((ch, idx) => {
    const val = ch.id || ch.url;
    const lFlag = ch.language || (ch.attributes?.translatedLanguage === 'id' ? 'id' : 'en');
    const lText = lFlag === 'id' ? '[ID]' : '[EN]';
    const numText = ch.chapterNumStr || ch.attributes?.chapter || ch.number || idx + 1;
    const titleText = ch.subTitle || (ch.attributes?.title ? `- ${ch.attributes.title}` : '');
    const srcText = ch.scanlationGroup ? `[${ch.scanlationGroup}]` : '';
    return {
      value: val,
      label: `Chapter ${numText} ${lText} ${srcText} ${titleText}`.trim(),
      lang: lFlag
    };
  });
  updateCustomChapterDropdown(dropItems, chapterId, (val) => {
    const targetPool = state.unifiedChapters?.[curLang] || activeChapterPool;
    const targetIdx = targetPool.findIndex(c => (c.id === val || c.url === val));
    if (targetIdx !== -1 && window.openUnifiedChapter) {
      window.openUnifiedChapter(targetPool[targetIdx], targetIdx);
      return;
    }
    const newIdx = state.currentChapters.findIndex(c => c.id === val);
    if (newIdx !== -1) {
      openReader(val, newIdx);
    }
  });

  if (state.currentManga?.id) {
    ensureUnifiedChapterList(state.currentManga.id, chapterId, state.currentManga);
  }

  // 100% Instant 0ms Load: Check if already pre-cached in memory!
  const cachedData = window.prefetchedChaptersCache?.get(chapterId);
  if (cachedData) {
    state.currentChapterData = cachedData;
    renderReaderPages(cachedData);
    saveReadingHistory(state.currentManga, chObj);
    return;
  }

  const viewport = document.getElementById('reader-viewport');
  if (viewport) {
    viewport.className = 'reader-viewport long-strip-mode';
    viewport.innerHTML = `
      <div class="chapter-transition-loader">
        <div class="transition-spinner-box">
          <div class="spinner"></div>
        </div>
        <div class="reader-skeleton-stream">
          <div class="page-skeleton-loader preview-stream"><div class="page-skeleton-shimmer"></div></div>
          <div class="page-skeleton-loader preview-stream"><div class="page-skeleton-shimmer"></div></div>
        </div>
      </div>
    `;
  }

  if (window.OfflineManager) {
    const isDown = await OfflineManager.isChapterDownloaded(chapterId);
    const offlineBadge = document.getElementById('reader-offline-badge');

    if (isDown) {
      const offlinePages = await OfflineManager.getOfflinePages(chapterId);
      const hasCorrupt = !offlinePages || offlinePages.length === 0 || offlinePages.some(p => !p.blob || (p.blob.size >= 59400 && p.blob.size <= 59600));

      if (hasCorrupt) {
        console.warn(`[Reader] Chapter ${chapterId} has corrupted/banner pages in IndexedDB. Purging...`);
        await OfflineManager.deleteChapter(chapterId, true);
        if (offlineBadge) offlineBadge.classList.add('hidden');
      } else {
        if (offlineBadge) offlineBadge.classList.remove('hidden');
        revokeActiveObjectUrls();

        const blobUrls = offlinePages.map(p => {
          const url = URL.createObjectURL(p.blob);
          state.activeObjectUrls.push(url);
          return url;
        });

        state.currentChapterData = {
          pages: blobUrls,
          dataSaverPages: blobUrls,
          totalPages: blobUrls.length,
          isOffline: true
        };

        renderReaderPages(state.currentChapterData);
        saveReadingHistory(state.currentManga, chObj);
        return;
      }
    } else {
      if (offlineBadge) offlineBadge.classList.add('hidden');
    }
  }

  try {
    const res = await fetch(`/api/chapter/${chapterId}`);
    const data = await res.json();
    state.currentChapterData = data;

    renderReaderPages(data);
    saveReadingHistory(state.currentManga, chObj);
  } catch (err) {
    console.error('Failed to load chapter pages:', err);
    if (viewport) {
      viewport.innerHTML = `
        <div class="empty-state" style="padding: 4rem 1rem; text-align: center;">
          <button class="btn-primary btn-retry-circle" id="btn-retry-reader-chapter" title="Coba Lagi" aria-label="Coba Lagi" style="width: 48px; height: 48px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0 auto;">
            <i data-lucide="rotate-cw"></i>
          </button>
        </div>
      `;
      document.getElementById('btn-retry-reader-chapter')?.addEventListener('click', () => {
        openReader(chapterId, chapterIndex);
      });
      initIcons();
    }
  }
}
window.openReader = openReader;

export async function openExternalReader(chapterUrl, chapterTitle, allChapters, chapterIndex) {
  state.currentPageIndex = 0;
  state.isExternal = true;
  state.currentSource = 'bacakomik';
  state.currentChapterId = chapterUrl;
  state.isAutoNavigatingNext = false;
  state.activeDetailLang = 'id';
  state.currentReadingLang = 'id';
  state.externalChapters = allChapters;
  state.currentChapterIndex = chapterIndex;
  state.allMangaDexChapters = [];

  if (typeof window.switchView === 'function') {
    window.switchView('reader');
  }

  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const readerContainer = document.getElementById('view-reader');
  if (readerContainer) readerContainer.scrollTop = 0;

  const mangaTitle = getMangaTitle(state.currentManga?.attributes) || state.currentManga?.title || 'Manga';

  const rMangaTitle = document.getElementById('reader-manga-title');
  const rChTitle = document.getElementById('reader-chapter-title');
  const footerPill = document.getElementById('footer-chapter-pill');
  if (rMangaTitle) rMangaTitle.textContent = mangaTitle;
  if (rChTitle) rChTitle.textContent = chapterTitle;
  if (footerPill) footerPill.textContent = chapterTitle;

  document.getElementById('reader-toolbar')?.classList.remove('hidden-bar');
  document.getElementById('reader-footer')?.classList.remove('hidden-bar');

  const pool = (state.unifiedChapters?.id && state.unifiedChapters.id.length > 0) ? state.unifiedChapters.id : allChapters;
  const dropItems = pool.map((ch, idx) => {
    const val = ch.id || ch.url;
    const numText = ch.chapterNumStr || ch.attributes?.chapter || ch.number || ch.title?.replace(/\s+/g, ' ').trim() || idx + 1;
    const titleText = ch.subTitle || (ch.attributes?.title ? `- ${ch.attributes.title}` : '');
    return {
      value: val,
      label: `Chapter ${numText} [ID] ${titleText}`.trim(),
      lang: 'id'
    };
  });
  updateCustomChapterDropdown(dropItems, chapterUrl, (val) => {
    const targetPool = state.unifiedChapters?.id || allChapters;
    const newIdx = targetPool.findIndex(c => (c.url === val || c.id === val));
    if (newIdx !== -1) {
      const targetCh = targetPool[newIdx];
      if (window.openUnifiedChapter) {
        window.openUnifiedChapter(targetCh, newIdx);
      } else {
        openExternalReader(targetCh.url || targetCh.id, targetCh.title, targetPool, newIdx);
      }
    }
  });

  if (state.currentManga?.id) {
    ensureUnifiedChapterList(state.currentManga.id, chapterUrl, state.currentManga);
  }

  // 100% Instant 0ms Load: Check if already pre-cached in memory!
  const cachedData = window.prefetchedChaptersCache?.get(chapterUrl);
  if (cachedData) {
    state.currentChapterData = {
      pages: cachedData.pages || [],
      dataSaverPages: cachedData.pages || [],
      totalPages: (cachedData.pages || []).length
    };
    renderReaderPages(state.currentChapterData);
    saveReadingHistory(state.currentManga || { id: chapterUrl, attributes: { title: { en: mangaTitle } } }, {
      id: chapterUrl,
      attributes: { chapter: chapterTitle }
    });
    return;
  }

  const viewport = document.getElementById('reader-viewport');
  if (viewport) {
    viewport.className = 'reader-viewport long-strip-mode';
    viewport.innerHTML = `
      <div class="chapter-transition-loader">
        <div class="transition-spinner-box">
          <div class="spinner"></div>
        </div>
        <div class="reader-skeleton-stream">
          <div class="page-skeleton-loader preview-stream"><div class="page-skeleton-shimmer"></div></div>
          <div class="page-skeleton-loader preview-stream"><div class="page-skeleton-shimmer"></div></div>
        </div>
      </div>
    `;
  }

  if (window.OfflineManager) {
    const isDown = await OfflineManager.isChapterDownloaded(chapterUrl);
    const offlineBadge = document.getElementById('reader-offline-badge');

    if (isDown) {
      if (offlineBadge) offlineBadge.classList.remove('hidden');
      const offlinePages = await OfflineManager.getOfflinePages(chapterUrl);

      revokeActiveObjectUrls();

      const blobUrls = offlinePages.map(p => {
        const url = URL.createObjectURL(p.blob);
        state.activeObjectUrls.push(url);
        return url;
      });

      state.currentChapterData = {
        pages: blobUrls,
        dataSaverPages: blobUrls,
        totalPages: blobUrls.length,
        isOffline: true
      };

      renderReaderPages(state.currentChapterData);
      saveReadingHistory(state.currentManga || { id: chapterUrl, attributes: { title: { en: mangaTitle } } }, {
        id: chapterUrl,
        attributes: { chapter: chapterTitle }
      });
      return;
    } else {
      if (offlineBadge) offlineBadge.classList.add('hidden');
    }
  }

  try {
    const isKomiku = chapterUrl.includes('komiku.org') || chapterUrl.includes('komiku.to') || state.currentSource === 'komiku';
    const pagesEndpoint = isKomiku
      ? `/api/komiku/chapter-pages?url=${encodeURIComponent(chapterUrl)}`
      : `/api/external/chapter-pages?url=${encodeURIComponent(chapterUrl)}`;
    const res = await fetch(pagesEndpoint);
    const data = await res.json();
    state.currentChapterData = {
      pages: data.pages || [],
      dataSaverPages: data.pages || [],
      totalPages: (data.pages || []).length
    };

    renderReaderPages(state.currentChapterData);
    saveReadingHistory(state.currentManga, {
      id: chapterUrl,
      attributes: { chapter: chapterTitle }
    });
  } catch (err) {
    console.error('Failed to load mirror chapter pages:', err);
    if (viewport) {
      viewport.innerHTML = `
        <div class="empty-state" style="padding: 4rem 1rem; text-align: center;">
          <button class="btn-primary btn-retry-circle" id="btn-retry-external-chapter" title="Coba Lagi" aria-label="Coba Lagi" style="width: 48px; height: 48px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0 auto;">
            <i data-lucide="rotate-cw"></i>
          </button>
        </div>
      `;
      document.getElementById('btn-retry-external-chapter')?.addEventListener('click', () => {
        openExternalReader(chapterUrl, chapterTitle, allChapters, chapterIndex);
      });
      initIcons();
    }
  }
}
window.openExternalReader = openExternalReader;

export async function openEnglishReader(chapterUrl, chapterTitle, allChapters, chapterIndex) {
  state.currentPageIndex = 0;
  state.isExternal = true;
  state.currentSource = 'english';
  state.currentChapterId = chapterUrl;
  state.isAutoNavigatingNext = false;
  state.activeDetailLang = 'en';
  state.currentReadingLang = 'en';
  state.englishChapters = allChapters;
  state.currentChapterIndex = chapterIndex;
  state.allMangaDexChapters = [];

  if (typeof window.switchView === 'function') {
    window.switchView('reader');
  }

  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const readerContainer = document.getElementById('view-reader');
  if (readerContainer) readerContainer.scrollTop = 0;

  const mangaTitle = getMangaTitle(state.currentManga?.attributes);

  const rMangaTitle = document.getElementById('reader-manga-title');
  const rChTitle = document.getElementById('reader-chapter-title');
  const footerPill = document.getElementById('footer-chapter-pill');
  if (rMangaTitle) rMangaTitle.textContent = mangaTitle;
  if (rChTitle) rChTitle.textContent = chapterTitle;
  if (footerPill) footerPill.textContent = chapterTitle;

  document.getElementById('reader-toolbar')?.classList.remove('hidden-bar');
  document.getElementById('reader-footer')?.classList.remove('hidden-bar');

  const pool = (state.unifiedChapters?.en && state.unifiedChapters.en.length > 0) ? state.unifiedChapters.en : allChapters;
  const dropItems = pool.map((ch, idx) => {
    const val = ch.id || ch.url;
    const numText = ch.chapterNumStr || ch.attributes?.chapter || ch.number || ch.title?.replace(/\s+/g, ' ').trim() || idx + 1;
    const titleText = ch.subTitle || (ch.attributes?.title ? `- ${ch.attributes.title}` : '');
    return {
      value: val,
      label: `Chapter ${numText} [EN] ${titleText}`.trim(),
      lang: 'en'
    };
  });
  updateCustomChapterDropdown(dropItems, chapterUrl, (val) => {
    const targetPool = state.unifiedChapters?.en || allChapters;
    const newIdx = targetPool.findIndex(c => (c.url === val || c.id === val));
    if (newIdx !== -1) {
      const targetCh = targetPool[newIdx];
      if (window.openUnifiedChapter) {
        window.openUnifiedChapter(targetCh, newIdx);
      } else {
        openEnglishReader(targetCh.url || targetCh.id, targetCh.title, targetPool, newIdx);
      }
    }
  });

  if (state.currentManga?.id) {
    ensureUnifiedChapterList(state.currentManga.id, chapterUrl, state.currentManga);
  }

  // 100% Instant 0ms Load: Check if already pre-cached in memory!
  const cachedData = window.prefetchedChaptersCache?.get(chapterUrl);
  if (cachedData) {
    state.currentChapterData = {
      pages: cachedData.pages || [],
      dataSaverPages: cachedData.pages || [],
      totalPages: (cachedData.pages || []).length
    };
    renderReaderPages(state.currentChapterData);
    saveReadingHistory(state.currentManga || { id: chapterUrl, attributes: { title: { en: mangaTitle } } }, {
      id: chapterUrl,
      attributes: { chapter: chapterTitle }
    });
    return;
  }

  const viewport = document.getElementById('reader-viewport');
  if (viewport) {
    viewport.className = 'reader-viewport long-strip-mode';
    viewport.innerHTML = `
      <div class="chapter-transition-loader">
        <div class="transition-spinner-box">
          <div class="spinner"></div>
        </div>
        <div class="reader-skeleton-stream">
          <div class="page-skeleton-loader preview-stream"><div class="page-skeleton-shimmer"></div></div>
          <div class="page-skeleton-loader preview-stream"><div class="page-skeleton-shimmer"></div></div>
        </div>
      </div>
    `;
  }

  if (window.OfflineManager) {
    const isDown = await OfflineManager.isChapterDownloaded(chapterUrl);
    const offlineBadge = document.getElementById('reader-offline-badge');

    if (isDown) {
      if (offlineBadge) offlineBadge.classList.remove('hidden');
      const offlinePages = await OfflineManager.getOfflinePages(chapterUrl);

      revokeActiveObjectUrls();

      const blobUrls = offlinePages.map(p => {
        const url = URL.createObjectURL(p.blob);
        state.activeObjectUrls.push(url);
        return url;
      });

      state.currentChapterData = {
        pages: blobUrls,
        dataSaverPages: blobUrls,
        totalPages: blobUrls.length,
        isOffline: true
      };

      renderReaderPages(state.currentChapterData);
      saveReadingHistory(state.currentManga || { id: chapterUrl, attributes: { title: { en: mangaTitle } } }, {
        id: chapterUrl,
        attributes: { chapter: chapterTitle }
      });
      return;
    } else {
      if (offlineBadge) offlineBadge.classList.add('hidden');
    }
  }

  try {
    const res = await fetch(`/api/external/en/chapter-pages?url=${encodeURIComponent(chapterUrl)}`);
    const data = await res.json();
    state.currentChapterData = {
      pages: data.pages,
      dataSaverPages: data.pages,
      totalPages: data.pages.length
    };

    renderReaderPages(state.currentChapterData);
    saveReadingHistory(state.currentManga, {
      id: chapterUrl,
      attributes: { chapter: chapterTitle }
    });
  } catch (err) {
    console.error('Failed to load English mirror chapter pages:', err);
    if (viewport) {
      viewport.innerHTML = `
        <div class="empty-state" style="padding: 4rem 1rem; text-align: center;">
          <button class="btn-primary btn-retry-circle" id="btn-retry-en-chapter" title="Coba Lagi" aria-label="Coba Lagi" style="width: 48px; height: 48px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0 auto;">
            <i data-lucide="rotate-cw"></i>
          </button>
        </div>
      `;
      document.getElementById('btn-retry-en-chapter')?.addEventListener('click', () => {
        openEnglishReader(chapterUrl, chapterTitle, allChapters, chapterIndex);
      });
      initIcons();
    }
  }
}
window.openEnglishReader = openEnglishReader;

export function detectOptimalReaderMode(manga, pages) {
  if (manga && manga.attributes) {
    const attrs = manga.attributes;
    const lang = (attrs.originalLanguage || '').toLowerCase();

    // Korean and Chinese comics are almost universally Webtoon / Long-Strip
    if (lang === 'ko' || lang === 'zh' || lang === 'zh-hk' || lang === 'zh-ro') {
      return 'long-strip';
    }

    if (Array.isArray(attrs.tags)) {
      const hasLongStripTag = attrs.tags.some(t => {
        const name = (t.attributes?.name?.en || t.name || '').toLowerCase();
        return name.includes('long strip') || name.includes('web comic') || name.includes('webtoon');
      });
      if (hasLongStripTag) return 'long-strip';
    }

    if (lang === 'ja') {
      return 'single';
    }
  }

  // Check external manga indicators (e.g., Komiku, Bacakomik, or English mirrors)
  const extType = (state.currentExternalManga?.type || manga?.type || '').toLowerCase();
  if (extType.includes('manhwa') || extType.includes('manhua') || extType.includes('webtoon')) {
    return 'long-strip';
  }
  if (extType.includes('manga')) {
    return 'single';
  }

  const titleString = [
    manga?.title,
    manga?.type,
    state.currentExternalManga?.title,
    manga?.attributes?.title?.en,
    manga?.attributes?.title?.ja,
    manga?.attributes?.title?.['ja-ro'],
    document.getElementById('reader-manga-title')?.textContent
  ].filter(Boolean).join(' ').toLowerCase();

  if (titleString.includes('manhwa') || titleString.includes('manhua') || titleString.includes('webtoon')) {
    return 'long-strip';
  }
  if (titleString.includes('manga')) {
    return 'single';
  }

  return 'single';
}

export function renderReaderPages(data) {
  const viewport = document.getElementById('reader-viewport');
  if (!viewport) return;
  viewport.innerHTML = '';

  const readerContainer = document.getElementById('view-reader');
  if (readerContainer) {
    readerContainer.scrollTop = 0;
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  requestAnimationFrame(() => {
    if (readerContainer) readerContainer.scrollTop = 0;
  });

  const isHighPageChapter = (data.totalPages > 30) || (data.pages && data.pages.length > 30);
  const useDataSaver = state.readerQuality === 'dataSaver' || (state.readerQuality !== 'original') || isHighPageChapter;
  const pages = (useDataSaver && data.dataSaverPages && data.dataSaverPages.length > 0)
    ? data.dataSaverPages
    : (data.pages || data.dataSaverPages || []);
  const total = pages.length;

  const pref = state.readerModePreference || localStorage.getItem('yomikomi_reader_mode_pref') || 'auto';
  state.readerModePreference = pref;

  if (pref === 'auto') {
    state.readerMode = detectOptimalReaderMode(state.currentManga, pages);

    const autoStatusEl = document.getElementById('mode-auto-status');
    if (autoStatusEl) {
      autoStatusEl.textContent = state.readerMode === 'long-strip' 
        ? 'Auto: Webtoon (Aktif)' 
        : 'Auto: Single (Aktif)';
    }

    if (pages.length > 0) {
      const probeImg = new Image();
      probeImg.src = getReaderStageUrl(pages[0], 0);
      const verifyRatio = () => {
        if (probeImg.naturalWidth > 0 && probeImg.naturalHeight > 0) {
          const ratio = probeImg.naturalHeight / probeImg.naturalWidth;
          const probedMode = ratio > 1.48 ? 'long-strip' : 'single';
          if (state.readerModePreference === 'auto' && probedMode !== state.readerMode) {
            state.readerMode = probedMode;
            if (autoStatusEl) {
              autoStatusEl.textContent = probedMode === 'long-strip' 
                ? 'Auto: Webtoon (Aktif)' 
                : 'Auto: Single (Aktif)';
            }
            renderReaderPages(data);
          }
        }
      };
      if (probeImg.complete && probeImg.naturalWidth > 0) {
        const ratio = probeImg.naturalHeight / probeImg.naturalWidth;
        const probedMode = ratio > 1.48 ? 'long-strip' : 'single';
        state.readerMode = probedMode;
        if (autoStatusEl) {
          autoStatusEl.textContent = probedMode === 'long-strip' 
            ? 'Auto: Webtoon (Aktif)' 
            : 'Auto: Single (Aktif)';
        }
      } else {
        probeImg.onload = verifyRatio;
      }
    }
  } else {
    state.readerMode = pref;
  }

  const pageCounter = document.getElementById('page-counter-text');
  if (pageCounter) pageCounter.textContent = `1 / ${total}`;

  if (state.readerMode === 'long-strip') {
    viewport.className = 'reader-viewport long-strip-mode';

    if (window.readerPageObserver) {
      window.readerPageObserver.disconnect();
      window.readerPageObserver = null;
    }

    state.hasPrefetchedNextChapter = false;
    window.readerPageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const wrap = entry.target;
          const pageNum = parseInt(wrap.dataset.page || '0', 10);
          const img = wrap.querySelector('.reader-page-img');
          if (img && img.dataset.startedLoading !== 'true') {
            img.setAttribute('fetchpriority', 'high');
            loadReaderPageImage(img);
          }
          // Prioritize loading next 2 pages immediately below visible page
          triggerNextPageLoad(img);
          observer.unobserve(wrap);

          // Predictive Next Chapter Pre-fetch (Zero delay when advancing!)
          if (pageNum >= Math.floor(total * 0.45) && !state.hasPrefetchedNextChapter) {
            state.hasPrefetchedNextChapter = true;
            const nextCandidate = findSmartNextChapter();
            if (nextCandidate && nextCandidate.chapter) {
              prefetchChapter(nextCandidate.chapter);
            }
          }
        }
      });
    }, {
      rootMargin: '400px 0px 800px 0px'
    });

    pages.forEach((pageUrl, idx) => {
      const pageNum = idx + 1;
      const pageWrap = document.createElement('div');
      pageWrap.className = 'reader-page-wrapper';
      pageWrap.dataset.page = pageNum;
      pageWrap.innerHTML = `
        <div class="page-skeleton-loader" id="skeleton-page-${pageNum}" title="Klik untuk ganti jalur gambar">
          <div class="page-skeleton-shimmer"></div>
          <div class="page-skeleton-label clickable-spinner">
            <div class="spinner-small"></div>
          </div>
        </div>
        <img 
          class="reader-page-img" 
          alt="Halaman ${pageNum}" 
          data-page="${pageNum}"
          data-raw-url="${pageUrl}"
          data-retry-stage="0"
          decoding="async"
          onload="window.handlePageImageLoad(this)"
          onerror="window.handlePageImageError(this)"
        >
      `;
      viewport.appendChild(pageWrap);

      const img = pageWrap.querySelector('img');
      const skeleton = pageWrap.querySelector('.page-skeleton-loader');
      if (skeleton) {
        skeleton.addEventListener('click', (e) => {
          e.stopPropagation();
          advanceImageRetryStage(img, true);
        });
      }

      if (idx < 3) {
        img.setAttribute('fetchpriority', 'high');
        loadReaderPageImage(img);
      } else {
        window.readerPageObserver.observe(pageWrap);
      }
    });

    // End Card
    const endCard = document.createElement('div');
    endCard.className = 'webtoon-chapter-end-card';
    endCard.id = 'webtoon-end-card';
    const chTitleText = document.getElementById('reader-chapter-title')?.textContent || 'Chapter ini';
    const nextCandidate = findSmartNextChapter();

    const curLang = state.activeDetailLang || state.currentReadingLang || 'id';
    const activePool = state.unifiedChapters?.[curLang] || 
      (curLang === 'en' ? state.englishChapters : state.externalChapters) || 
      state.activeChapters || 
      state.currentChapters || [];
    let currentChapterList = activePool.map((ch, i) => {
      const id = ch.id || ch.url;
      const numText = ch.chapterNumStr || ch.attributes?.chapter || ch.number || i + 1;
      const titleText = ch.subTitle || (ch.attributes?.title ? ` - ${ch.attributes.title}` : (ch.title ? ` - ${ch.title}` : ''));
      return {
        id,
        title: `Chapter ${numText} ${titleText}`.trim(),
        index: i,
        rawCh: ch
      };
    });

    const currentChNumText = document.getElementById('reader-chapter-title')?.textContent || 'Pilih Chapter';

    endCard.innerHTML = `
      <div class="end-card-chapter-selector-wrap">
        <span class="end-card-select-label">Pindah Chapter</span>
        <div class="end-card-dropdown" id="end-card-chapter-dropdown">
          <button class="end-card-dropdown-trigger" id="end-card-chapter-trigger" type="button" title="Pilih Chapter Cepat">
            <i data-lucide="book-open"></i>
            <span class="end-card-trigger-label" id="end-card-chapter-label">${currentChNumText}</span>
            <i data-lucide="chevron-down" class="end-card-arrow"></i>
          </button>
          <div class="end-card-dropdown-panel hidden" id="end-card-chapter-panel">
            <div class="end-card-search-wrap">
              <i data-lucide="search"></i>
              <input type="text" id="end-card-chapter-search" placeholder="Cari chapter..." autocomplete="off">
            </div>
            <div class="end-card-dropdown-list" id="end-card-chapter-list"></div>
          </div>
        </div>
      </div>

      <span class="end-card-badge">Akhir Chapter</span>
      <h4 class="end-card-title">${chTitleText} Telah Selesai</h4>
      <p class="end-card-sub" id="end-card-sub-text">${nextCandidate ? 'Scroll ke bawah atau klik tombol di bawah untuk melanjutkan.' : 'Ini adalah chapter terakhir yang tersedia saat ini.'}</p>
      ${nextCandidate ? `
        <button class="btn-primary btn-auto-next" id="btn-end-card-next">
          <span>Buka Chapter Berikutnya</span>
          <i data-lucide="arrow-right"></i>
        </button>
      ` : ''}
    `;

    const endTrigger = endCard.querySelector('#end-card-chapter-trigger');
    const endPanel = endCard.querySelector('#end-card-chapter-panel');
    const endList = endCard.querySelector('#end-card-chapter-list');
    const endSearch = endCard.querySelector('#end-card-chapter-search');

    endTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      endPanel?.classList.toggle('hidden');
    });

    const renderEndList = (q = '') => {
      if (!endList) return;
      endList.innerHTML = '';
      const filtered = currentChapterList.filter(c => c.title.toLowerCase().includes(q.toLowerCase()));
      if (filtered.length === 0) {
        endList.innerHTML = `<div style="padding:0.75rem;font-size:0.75rem;color:var(--text-muted);text-align:center;">Tidak ada chapter</div>`;
        return;
      }
      filtered.forEach(item => {
        const div = document.createElement('div');
        const isAct = (item.id === state.currentChapterId);
        div.className = `end-card-dropdown-item ${isAct ? 'active' : ''}`;
        div.textContent = item.title;
        div.addEventListener('click', (e) => {
          e.stopPropagation();
          endPanel?.classList.add('hidden');
          if (window.openUnifiedChapter && item.rawCh) {
            window.openUnifiedChapter(item.rawCh, item.index);
          } else if (state.isExternal) {
            openExternalReader(item.id, item.title, state.externalChapters, item.index);
          } else if (state.currentSource === 'english') {
            openEnglishReader(item.id, item.title, state.englishChapters, item.index);
          } else {
            openReader(item.id, item.index);
          }
        });
        endList.appendChild(div);
      });
    };

    renderEndList();

    endSearch?.addEventListener('input', (e) => {
      renderEndList(e.target.value);
    });

    endCard.querySelector('#btn-end-card-next')?.addEventListener('click', () => {
      document.getElementById('btn-next-chapter')?.click();
    });

    viewport.appendChild(endCard);

    if ('IntersectionObserver' in window) {
      const endCardObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !state.isAutoNavigatingNext) {
            const nextCh = findSmartNextChapter();
            if (nextCh) {
              state.isAutoNavigatingNext = true;
              advanceToNextChapter();
            }
          }
        });
      }, {
        root: document.getElementById('view-reader'),
        threshold: 0.1
      });
      endCardObserver.observe(endCard);
    }

    initScrollPageObserver();

  } else if (state.readerMode === 'single') {
    viewport.className = 'reader-viewport single-mode';
    renderSinglePage(pages, state.currentPageIndex, state.currentSingleSlice || 0);
  } else if (state.readerMode === 'double') {
    viewport.className = 'reader-viewport double-mode';
    renderDoublePage(pages, state.currentPageIndex);
  }

  updateReaderNavButtons();
  initIcons();
}

// In-memory pre-decoded image cache for GPU texture readiness
const singleModeDecodedImages = new Map();

/**
 * Aggressive GPU Pre-decoding Lookahead & Lookbehind
 * Ensures next 5 pages and previous 2 pages are pre-decoded in GPU memory
 */
export function prewarmSinglePages(pages, currentIndex) {
  if (!pages || pages.length === 0) return;
  const total = pages.length;

  const lookahead = 5;
  const lookbehind = 2;
  const start = Math.max(0, currentIndex - lookbehind);
  const end = Math.min(total - 1, currentIndex + lookahead);

  for (let i = start; i <= end; i++) {
    if (i === currentIndex) continue;
    const rawUrl = pages[i];
    const stageUrl = getReaderStageUrl(rawUrl, 0);
    if (!singleModeDecodedImages.has(stageUrl)) {
      const imgObj = new Image();
      imgObj.src = stageUrl;
      if (typeof imgObj.decode === 'function') {
        imgObj.decode().catch(() => {});
      }
      singleModeDecodedImages.set(stageUrl, imgObj);
      if (singleModeDecodedImages.size > 50) {
        const oldest = singleModeDecodedImages.keys().next().value;
        singleModeDecodedImages.delete(oldest);
      }
    }
  }

  // Pre-fetch next chapter when nearing the end (3 pages remaining)
  if (currentIndex >= total - 3 && !state.hasPrefetchedNextChapter) {
    state.hasPrefetchedNextChapter = true;
    const nextCandidate = findSmartNextChapter();
    if (nextCandidate && nextCandidate.chapter) {
      prefetchChapter(nextCandidate.chapter);
    }
  }
}

export function renderSinglePage(pages, index, sliceIndex = 0) {
  const viewport = document.getElementById('reader-viewport');
  if (!viewport) return;
  const total = pages.length;
  state.currentPageIndex = Math.max(0, Math.min(index, total - 1));
  state.currentSingleSlice = sliceIndex || 0;

  const currentUrl = pages[state.currentPageIndex];
  const targetStageUrl = getReaderStageUrl(currentUrl, 0);

  // Trigger aggressive GPU pre-decoding
  prewarmSinglePages(pages, state.currentPageIndex);

  // Update page counter
  const pageCounter = document.getElementById('page-counter-text');
  if (pageCounter) {
    pageCounter.textContent = `${state.currentPageIndex + 1} / ${total}`;
  }

  // Check if persistent container already exists (FAST PATH: Zero DOM rebuild, 60/120fps)
  const container = viewport.querySelector('.single-page-container');
  const currentImg = viewport.querySelector('.single-page-img');

  if (container && currentImg) {
    currentImg.dataset.page = state.currentPageIndex + 1;
    currentImg.dataset.rawUrl = currentUrl;
    currentImg.alt = `Halaman ${state.currentPageIndex + 1}`;

    const sk = document.getElementById('single-page-skeleton');
    if (sk) {
      sk.style.display = 'flex';
      sk.classList.remove('fade-out');
    }
    currentImg.classList.remove('visible');

    applyImageStage(currentImg, currentUrl, 0);

    updateReaderNavButtons();
    return;
  }

  // FIRST-TIME INITIALIZATION: Build container and click zones once
  viewport.className = 'reader-viewport single-mode';
  viewport.innerHTML = `
    <div class="single-page-container">
      <div class="page-skeleton-loader" id="single-page-skeleton" title="Klik untuk ganti jalur gambar">
        <div class="page-skeleton-shimmer"></div>
        <div class="page-skeleton-label clickable-spinner">
          <div class="spinner-small"></div>
        </div>
      </div>
      <div class="nav-click-zone left" title="Halaman Sebelumnya (↑ / W / A / ←)"></div>
      <img 
        class="single-page-img" 
        alt="Halaman ${state.currentPageIndex + 1}"
        data-page="${state.currentPageIndex + 1}"
        data-raw-url="${currentUrl}"
        data-retry-stage="0"
        onload="const sk = document.getElementById('single-page-skeleton'); if (sk) sk.style.display = 'none'; this.classList.add('visible'); window.handlePageImageLoad(this);"
        onerror="window.handlePageImageError(this)"
      >
      <div class="nav-click-zone right" title="Halaman Selanjutnya (↓ / S / D / → / Spasi)"></div>
    </div>
  `;

  const singleSk = viewport.querySelector('#single-page-skeleton');
  const singleImg = viewport.querySelector('.single-page-img');
  if (singleSk && singleImg) {
    singleSk.addEventListener('click', (e) => {
      e.stopPropagation();
      advanceImageRetryStage(singleImg, true);
    });
  }

  if (singleImg) {
    applyImageStage(singleImg, currentUrl, 0);
  }

  viewport.querySelector('.nav-click-zone.left')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.currentPageIndex > 0) {
      state.currentPageIndex--;
      renderSinglePage(pages, state.currentPageIndex, 0);
    } else {
      advanceToPrevChapter();
    }
  });

  viewport.querySelector('.nav-click-zone.right')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.currentPageIndex < total - 1) {
      state.currentPageIndex++;
      renderSinglePage(pages, state.currentPageIndex, 0);
    } else {
      advanceToNextChapter();
    }
  });

  updateReaderNavButtons();
}

export function renderDoublePage(pages, index) {
  const viewport = document.getElementById('reader-viewport');
  if (!viewport) return;
  const total = pages.length;
  state.currentPageIndex = Math.max(0, Math.min(index, total - 1));

  const page1Index = state.currentPageIndex;
  const page2Index = page1Index + 1 < total ? page1Index + 1 : null;

  const counter = document.getElementById('page-counter-text');
  if (counter) {
    if (page2Index !== null) {
      counter.textContent = `${page1Index + 1}-${page2Index + 1} / ${total}`;
    } else {
      counter.textContent = `${page1Index + 1} / ${total}`;
    }
  }

  const page1Url = pages[page1Index];
  const page2Url = page2Index !== null ? pages[page2Index] : null;

  // FAST PATH: Update existing double-page DOM in-place without rebuilding
  const container = viewport.querySelector('.double-page-container');
  const img1 = viewport.querySelector('.double-page-item.left img');
  const img2Wrap = viewport.querySelector('.double-page-item.right');

  if (container && img1) {
    img1.src = getReaderStageUrl(page1Url, 0);
    img1.dataset.page = page1Index + 1;
    img1.dataset.rawUrl = page1Url;
    img1.alt = `Halaman ${page1Index + 1}`;
    const tag1 = viewport.querySelector('.double-page-item.left .double-page-tag');
    if (tag1) tag1.textContent = page1Index + 1;

    if (page2Url && img2Wrap) {
      img2Wrap.style.display = '';
      const img2 = img2Wrap.querySelector('img');
      if (img2) {
        img2.src = getReaderStageUrl(page2Url, 0);
        img2.dataset.page = page2Index + 1;
        img2.dataset.rawUrl = page2Url;
        img2.alt = `Halaman ${page2Index + 1}`;
      }
      const tag2 = img2Wrap.querySelector('.double-page-tag');
      if (tag2) tag2.textContent = page2Index + 1;
    } else if (img2Wrap) {
      img2Wrap.style.display = 'none';
    }

    updateReaderNavButtons();
    return;
  }

  viewport.innerHTML = `
    <div class="double-page-container">
      <div class="nav-click-zone left" title="2 Halaman Sebelumnya"></div>
      <div class="double-pages-wrap">
        <div class="double-page-item left">
          <img 
            src="${getReaderStageUrl(page1Url, 0)}" 
            class="double-page-img" 
            alt="Halaman ${page1Index + 1}"
            data-page="${page1Index + 1}"
            data-raw-url="${page1Url}"
            data-retry-stage="0"
            onload="window.handlePageImageLoad(this)"
            onerror="window.handlePageImageError(this)"
          >
          <span class="double-page-tag">${page1Index + 1}</span>
        </div>
        ${page2Url ? `
          <div class="double-page-item right">
            <img 
              src="${getReaderStageUrl(page2Url, 0)}" 
              class="double-page-img" 
              alt="Halaman ${page2Index + 1}"
              data-page="${page2Index + 1}"
              data-raw-url="${page2Url}"
              data-retry-stage="0"
              onload="window.handlePageImageLoad(this)"
              onerror="window.handlePageImageError(this)"
            >
            <span class="double-page-tag">${page2Index + 1}</span>
          </div>
        ` : ''}
      </div>
      <div class="nav-click-zone right" title="2 Halaman Selanjutnya"></div>
    </div>
  `;

  viewport.querySelector('.nav-click-zone.left')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.currentPageIndex > 0) {
      state.currentPageIndex = Math.max(0, state.currentPageIndex - 2);
      renderDoublePage(pages, state.currentPageIndex);
    } else {
      advanceToPrevChapter();
    }
  });

  viewport.querySelector('.nav-click-zone.right')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.currentPageIndex + 2 < total) {
      state.currentPageIndex += 2;
      renderDoublePage(pages, state.currentPageIndex);
    } else if (state.currentPageIndex + 1 < total) {
      state.currentPageIndex += 1;
      renderDoublePage(pages, state.currentPageIndex);
    } else {
      advanceToNextChapter();
    }
  });

  updateReaderNavButtons();
}

export function initScrollPageObserver() {
  const pages = document.querySelectorAll('.reader-page-wrapper');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      const visibleEntries = entries.filter(e => e.isIntersecting);
      if (visibleEntries.length > 0) {
        let topEntry = visibleEntries[0];
        let minDiff = Math.abs(topEntry.boundingClientRect.top);
        for (let i = 1; i < visibleEntries.length; i++) {
          const diff = Math.abs(visibleEntries[i].boundingClientRect.top);
          if (diff < minDiff) {
            minDiff = diff;
            topEntry = visibleEntries[i];
          }
        }
        const pageNum = topEntry.target.dataset.page;
        const total = state.currentChapterData?.pages?.length || 0;
        if (pageNum) {
          const counter = document.getElementById('page-counter-text');
          if (counter) counter.textContent = `${pageNum} / ${total}`;
        }
      }
    }, { threshold: [0.1, 0.3, 0.5] });

    pages.forEach(p => observer.observe(p));
  }
}

export function extractChapterNumber(ch) {
  if (ch === null || ch === undefined) return NaN;
  if (typeof ch === 'number') return isNaN(ch) ? NaN : ch;
  if (typeof ch === 'string') {
    const trimmed = ch.trim();
    const match = trimmed.match(/(?:chapter|ch\.?|bab)\s*([\d.]+)/i) || trimmed.match(/([\d.]+)/);
    if (match) {
      const p = parseFloat(match[1]);
      if (!isNaN(p)) return p;
    }
    const direct = parseFloat(trimmed);
    return isNaN(direct) ? NaN : direct;
  }
  if (typeof ch.number === 'number' && !isNaN(ch.number)) return ch.number;
  if (typeof ch.num === 'number' && !isNaN(ch.num)) return ch.num;
  const raw = ch.chapterNumStr || ch.chapterNumber || ch.attributes?.chapter || ch.num || '';
  const parsed = parseFloat(raw);
  if (!isNaN(parsed)) return parsed;
  const str = String(ch.title || ch.attributes?.title || '');
  const match = str.match(/(?:chapter|ch\.?|bab)\s*([\d.]+)/i) || str.match(/([\d.]+)/);
  if (match) {
    const p = parseFloat(match[1]);
    if (!isNaN(p)) return p;
  }
  return NaN;
}
window.extractChapterNumber = extractChapterNumber;

export function findSmartNextChapter() {
  const currentLang = state.activeDetailLang || state.currentReadingLang || 'id';
  const otherLang = currentLang === 'id' ? 'en' : 'id';

  // Get chapter pools for both languages
  const samePool = (state.unifiedChapters?.[currentLang] || (currentLang === 'en' ? state.englishChapters : state.externalChapters) || state.activeChapters || []).slice();
  const otherPool = (state.unifiedChapters?.[otherLang] || (otherLang === 'en' ? state.englishChapters : state.externalChapters) || []).slice();

  const sortPoolAsc = (pool) => {
    return pool.sort((a, b) => {
      const numA = extractChapterNumber(a);
      const numB = extractChapterNumber(b);
      if (isNaN(numA) && isNaN(numB)) return 0;
      if (isNaN(numA)) return 1;
      if (isNaN(numB)) return -1;
      return numA - numB;
    });
  };

  sortPoolAsc(samePool);
  sortPoolAsc(otherPool);

  // Determine current chapter and its numeric value
  let currentCh = state.currentUnifiedChapter;
  if (!currentCh) {
    const curId = state.currentChapterId;
    currentCh = samePool.find(c => c.id === curId || c.url === curId) ||
      otherPool.find(c => c.id === curId || c.url === curId) ||
      state.currentChapters?.[state.currentChapterIndex] ||
      state.allMangaDexChapters?.find(c => c.id === curId);
  }

  let currentNum = extractChapterNumber(currentCh);
  if (isNaN(currentNum)) {
    const titleEl = document.getElementById('reader-chapter-title');
    if (titleEl && titleEl.textContent) {
      const m = titleEl.textContent.match(/(?:chapter|ch\.?|bab)\s*([\d.]+)/i);
      if (m) currentNum = parseFloat(m[1]);
    }
  }

  // 1. Search in same language pool (number > currentNum)
  if (!isNaN(currentNum)) {
    const nextCandidates = samePool.filter(c => {
      const num = extractChapterNumber(c);
      return !isNaN(num) && num > currentNum;
    });

    if (nextCandidates.length > 0) {
      const nextCh = nextCandidates[0];
      const idx = samePool.indexOf(nextCh);
      return {
        type: 'unified',
        chapter: nextCh,
        index: idx !== -1 ? idx : 0,
        isFallback: false,
        lang: currentLang
      };
    }

    // 2. Smart Language Fallback: Search in other language pool (number > currentNum)
    const fallbackCandidates = otherPool.filter(c => {
      const num = extractChapterNumber(c);
      return !isNaN(num) && num > currentNum;
    });

    if (fallbackCandidates.length > 0) {
      const nextCh = fallbackCandidates[0];
      const idx = otherPool.indexOf(nextCh);
      return {
        type: 'unified',
        chapter: nextCh,
        index: idx !== -1 ? idx : 0,
        isFallback: true,
        fromLang: currentLang,
        toLang: otherLang,
        lang: otherLang
      };
    }
  }

  // 3. Fallback: Search by ID or Index if number is NaN or special
  const curId = state.currentChapterId || currentCh?.id || currentCh?.url;
  if (curId) {
    let curIdx = samePool.findIndex(c => c.id === curId || c.url === curId);
    if (curIdx === -1 && !isNaN(currentNum)) {
      curIdx = samePool.findIndex(c => extractChapterNumber(c) === currentNum);
    }
    if (curIdx !== -1 && curIdx < samePool.length - 1) {
      const nextCh = samePool[curIdx + 1];
      return {
        type: 'unified',
        chapter: nextCh,
        index: curIdx + 1,
        isFallback: false,
        lang: currentLang
      };
    }
  }

  return null;
}
window.findSmartNextChapter = findSmartNextChapter;

export function findSmartPrevChapter() {
  const currentLang = state.activeDetailLang || state.currentReadingLang || 'id';
  const otherLang = currentLang === 'id' ? 'en' : 'id';

  const samePool = (state.unifiedChapters?.[currentLang] || (currentLang === 'en' ? state.englishChapters : state.externalChapters) || state.activeChapters || []).slice();
  const otherPool = (state.unifiedChapters?.[otherLang] || (otherLang === 'en' ? state.englishChapters : state.externalChapters) || []).slice();

  const sortPoolAsc = (pool) => {
    return pool.sort((a, b) => {
      const numA = extractChapterNumber(a);
      const numB = extractChapterNumber(b);
      if (isNaN(numA) && isNaN(numB)) return 0;
      if (isNaN(numA)) return 1;
      if (isNaN(numB)) return -1;
      return numA - numB;
    });
  };

  sortPoolAsc(samePool);
  sortPoolAsc(otherPool);

  let currentCh = state.currentUnifiedChapter;
  if (!currentCh) {
    const curId = state.currentChapterId;
    currentCh = samePool.find(c => c.id === curId || c.url === curId) ||
      otherPool.find(c => c.id === curId || c.url === curId) ||
      state.currentChapters?.[state.currentChapterIndex] ||
      state.allMangaDexChapters?.find(c => c.id === curId);
  }

  let currentNum = extractChapterNumber(currentCh);
  if (isNaN(currentNum)) {
    const titleEl = document.getElementById('reader-chapter-title');
    if (titleEl && titleEl.textContent) {
      const m = titleEl.textContent.match(/(?:chapter|ch\.?|bab)\s*([\d.]+)/i);
      if (m) currentNum = parseFloat(m[1]);
    }
  }

  // 1. Search in same language pool (number < currentNum, take closest = largest < currentNum)
  if (!isNaN(currentNum)) {
    const prevCandidates = samePool.filter(c => {
      const num = extractChapterNumber(c);
      return !isNaN(num) && num < currentNum;
    });

    if (prevCandidates.length > 0) {
      const prevCh = prevCandidates[prevCandidates.length - 1];
      const idx = samePool.indexOf(prevCh);
      return {
        type: 'unified',
        chapter: prevCh,
        index: idx !== -1 ? idx : 0,
        isFallback: false,
        lang: currentLang
      };
    }

    // 2. Smart Language Fallback: Search in other language pool (number < currentNum)
    const fallbackCandidates = otherPool.filter(c => {
      const num = extractChapterNumber(c);
      return !isNaN(num) && num < currentNum;
    });

    if (fallbackCandidates.length > 0) {
      const prevCh = fallbackCandidates[fallbackCandidates.length - 1];
      const idx = otherPool.indexOf(prevCh);
      return {
        type: 'unified',
        chapter: prevCh,
        index: idx !== -1 ? idx : 0,
        isFallback: true,
        fromLang: currentLang,
        toLang: otherLang,
        lang: otherLang
      };
    }
  }

  // 3. Fallback: Search by ID or Index
  const curId = state.currentChapterId || currentCh?.id || currentCh?.url;
  if (curId) {
    let curIdx = samePool.findIndex(c => c.id === curId || c.url === curId);
    if (curIdx === -1 && !isNaN(currentNum)) {
      curIdx = samePool.findIndex(c => extractChapterNumber(c) === currentNum);
    }
    if (curIdx > 0) {
      const prevCh = samePool[curIdx - 1];
      return {
        type: 'unified',
        chapter: prevCh,
        index: curIdx - 1,
        isFallback: false,
        lang: currentLang
      };
    }
  }

  return null;
}
window.findSmartPrevChapter = findSmartPrevChapter;

export function advanceToNextChapter() {
  const next = findSmartNextChapter();
  if (!next || !next.chapter) return;

  if (next.lang) {
    state.activeDetailLang = next.lang;
    state.currentReadingLang = next.lang;
    if (state.unifiedChapters && state.unifiedChapters[next.lang]) {
      state.activeChapters = state.unifiedChapters[next.lang];
      state.currentChapters = state.activeChapters;
    }
  }

  if (window.openUnifiedChapter) {
    window.openUnifiedChapter(next.chapter, next.index);
    return;
  }

  if (next.type === 'english' || next.lang === 'en') {
    openEnglishReader(next.chapter.url || next.chapter.id, next.chapter.title, state.englishChapters || [next.chapter], next.index);
  } else if (next.type === 'bacakomik' || next.chapter.source === 'komiku' || next.chapter.source === 'bacakomik') {
    openExternalReader(next.chapter.url || next.chapter.id, next.chapter.title, state.externalChapters || [next.chapter], next.index);
  } else {
    openReader(next.chapter.id, next.index);
  }
}
window.advanceToNextChapter = advanceToNextChapter;

export function advanceToPrevChapter() {
  const prev = findSmartPrevChapter();
  if (!prev || !prev.chapter) return;

  if (prev.lang) {
    state.activeDetailLang = prev.lang;
    state.currentReadingLang = prev.lang;
    if (state.unifiedChapters && state.unifiedChapters[prev.lang]) {
      state.activeChapters = state.unifiedChapters[prev.lang];
      state.currentChapters = state.activeChapters;
    }
  }

  if (window.openUnifiedChapter) {
    window.openUnifiedChapter(prev.chapter, prev.index);
    return;
  }

  if (prev.type === 'english' || prev.lang === 'en') {
    openEnglishReader(prev.chapter.url || prev.chapter.id, prev.chapter.title, state.englishChapters || [prev.chapter], prev.index);
  } else if (prev.type === 'bacakomik' || prev.chapter.source === 'komiku' || prev.chapter.source === 'bacakomik') {
    openExternalReader(prev.chapter.url || prev.chapter.id, prev.chapter.title, state.externalChapters || [prev.chapter], prev.index);
  } else {
    openReader(prev.chapter.id, prev.index);
  }
}
window.advanceToPrevChapter = advanceToPrevChapter;

export function handleReaderNext() {
  if (state.readerMode === 'single' || state.readerMode === 'double') {
    const rightZone = document.querySelector('.nav-click-zone.right');
    if (rightZone) {
      rightZone.click();
      return;
    }
  }
  advanceToNextChapter();
}

export function handleReaderPrev() {
  if (state.readerMode === 'single' || state.readerMode === 'double') {
    if (state.currentPageIndex === 0 && (!state.currentSingleSlice || state.currentSingleSlice === 0)) {
      advanceToPrevChapter();
      return;
    }
    const leftZone = document.querySelector('.nav-click-zone.left');
    if (leftZone) {
      leftZone.click();
      return;
    }
  }
  advanceToPrevChapter();
}

export function updateReaderNavButtons() {
  const prevBtn = document.getElementById('btn-prev-chapter');
  const nextBtn = document.getElementById('btn-next-chapter');
  const prevText = document.getElementById('btn-prev-text') || prevBtn?.querySelector('.btn-text');
  const nextText = document.getElementById('btn-next-text') || nextBtn?.querySelector('.btn-text');
  const footerPill = document.getElementById('footer-chapter-pill');

  const hasPrevChapter = !!findSmartPrevChapter();
  const hasNextChapter = !!findSmartNextChapter();

  if (state.readerMode === 'single' || state.readerMode === 'double') {
    const totalPages = state.currentChapterData?.pages?.length || 1;
    const isAtStart = state.currentPageIndex === 0 && (!state.currentSingleSlice || state.currentSingleSlice === 0);
    const isAtEnd = state.currentPageIndex >= totalPages - 1;

    if (prevBtn) {
      prevBtn.disabled = isAtStart && !hasPrevChapter;
      prevBtn.style.opacity = (isAtStart && !hasPrevChapter) ? '0.35' : '1';
      if (prevText) {
        prevText.textContent = isAtStart ? 'Chapter Sblm' : 'Prev';
      }
    }

    if (nextBtn) {
      nextBtn.disabled = isAtEnd && !hasNextChapter;
      nextBtn.style.opacity = (isAtEnd && !hasNextChapter) ? '0.35' : '1';
      if (nextText) {
        nextText.textContent = isAtEnd ? 'Chapter Lanjut' : 'Next';
      }
    }

    if (footerPill) {
      const chLabel = state.currentChapterData?.title || 'Chapter';
      footerPill.textContent = `${state.currentPageIndex + 1}/${totalPages} (${chLabel})`;
    }
  } else {
    if (prevBtn) {
      prevBtn.disabled = !hasPrevChapter;
      prevBtn.style.opacity = !hasPrevChapter ? '0.35' : '1';
      if (prevText) prevText.textContent = 'Sebelumnya';
    }
    if (nextBtn) {
      nextBtn.disabled = !hasNextChapter;
      nextBtn.style.opacity = !hasNextChapter ? '0.35' : '1';
      if (nextText) nextText.textContent = 'Selanjutnya';
    }
    if (footerPill) {
      footerPill.textContent = state.currentChapterData?.title || 'Chapter ...';
    }
  }
}

export function initReaderControls() {
  document.getElementById('reader-btn-back')?.addEventListener('click', () => {
    if (typeof window.switchView === 'function') {
      window.switchView('detail');
    }
  });

  const dropdownEl = document.getElementById('custom-chapter-dropdown');
  const triggerBtn = document.getElementById('custom-chapter-trigger');
  const panelEl = document.getElementById('custom-chapter-panel');

  triggerBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = panelEl?.classList.contains('hidden');
    if (isHidden) {
      panelEl?.classList.remove('hidden');
      dropdownEl?.classList.add('open');
      const searchInput = document.getElementById('dropdown-chapter-search');
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
        searchInput.dispatchEvent(new Event('input'));
      }
    } else {
      panelEl?.classList.add('hidden');
      dropdownEl?.classList.remove('open');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#custom-chapter-dropdown')) {
      panelEl?.classList.add('hidden');
      dropdownEl?.classList.remove('open');
    }
  });

  const moreBtn = document.getElementById('reader-more-btn');
  const moreMenu = document.getElementById('reader-more-menu');

  const initialPref = state.readerModePreference || localStorage.getItem('yomikomi_reader_mode_pref') || 'auto';
  state.readerModePreference = initialPref;
  document.querySelectorAll('.reader-mode-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === initialPref);
  });

  moreBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const currentPref = state.readerModePreference || localStorage.getItem('yomikomi_reader_mode_pref') || 'auto';
    state.readerModePreference = currentPref;
    document.querySelectorAll('.reader-mode-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === currentPref);
    });
    const autoStatusEl = document.getElementById('mode-auto-status');
    if (autoStatusEl && currentPref === 'auto') {
      autoStatusEl.textContent = state.readerMode === 'long-strip' 
        ? 'Auto: Webtoon (Aktif)' 
        : 'Auto: Single (Aktif)';
    }
    moreMenu?.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#reader-more-dropdown-wrap')) {
      moreMenu?.classList.add('hidden');
    }
  });

  document.querySelectorAll('.reader-mode-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      state.readerModePreference = mode;
      localStorage.setItem('yomikomi_reader_mode_pref', mode);

      document.querySelectorAll('.reader-mode-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
      moreMenu?.classList.add('hidden');

      if (mode === 'auto') {
        showToast('⚡ Mode Pintar (Auto): Otomatis Webtoon / Single');
      } else if (mode === 'long-strip') {
        state.readerMode = 'long-strip';
        showToast('Mode Webtoon diaktifkan');
      } else if (mode === 'single') {
        state.readerMode = 'single';
        showToast('Mode Single Page diaktifkan');
      } else if (mode === 'double') {
        state.readerMode = 'double';
        showToast('Mode Double Page diaktifkan');
      }

      if (state.currentChapterData) {
        renderReaderPages(state.currentChapterData);
      }
      updateReaderNavButtons();
      initIcons();
    });
  });

  document.getElementById('menu-quality-toggle')?.addEventListener('click', () => {
    const statusEl = document.getElementById('menu-quality-status');
    if (state.readerQuality === 'dataSaver') {
      state.readerQuality = 'pages';
      if (statusEl) statusEl.textContent = 'Kualitas Asli (HQ)';
      showToast('Kualitas: Asli (HQ)');
    } else {
      state.readerQuality = 'dataSaver';
      if (statusEl) statusEl.textContent = 'Data Saver (Hemat)';
      showToast('Kualitas: Data Saver');
    }
    moreMenu?.classList.add('hidden');
    if (state.currentChapterData) {
      renderReaderPages(state.currentChapterData);
    }
  });

  document.getElementById('menu-fullscreen-toggle')?.addEventListener('click', () => {
    moreMenu?.classList.add('hidden');
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  });

  document.getElementById('btn-prev-chapter')?.addEventListener('click', () => {
    handleReaderPrev();
  });

  document.getElementById('btn-next-chapter')?.addEventListener('click', () => {
    handleReaderNext();
  });

  window.addEventListener('keydown', (e) => {
    if (state.currentView !== 'reader') return;

    const key = e.key;

    if (key === 'ArrowRight' || key.toLowerCase() === 'd') {
      e.preventDefault();
      handleReaderNext();
    } else if (key === 'ArrowLeft' || key.toLowerCase() === 'a') {
      e.preventDefault();
      handleReaderPrev();
    } else if (key === 'ArrowDown' || key === ' ' || key.toLowerCase() === 's' || key === 'PageDown') {
      e.preventDefault();
      if (state.readerMode === 'single' || state.readerMode === 'double') {
        handleReaderNext();
      } else {
        const reader = document.getElementById('view-reader');
        if (reader) reader.scrollBy({ top: window.innerHeight * 0.75, behavior: 'smooth' });
      }
    } else if (key === 'ArrowUp' || key.toLowerCase() === 'w' || key === 'PageUp') {
      e.preventDefault();
      if (state.readerMode === 'single' || state.readerMode === 'double') {
        handleReaderPrev();
      } else {
        const reader = document.getElementById('view-reader');
        if (reader) reader.scrollBy({ top: -window.innerHeight * 0.75, behavior: 'smooth' });
      }
    } else if (key.toLowerCase() === 'f') {
      document.getElementById('menu-fullscreen-toggle')?.click();
    }
  });

  const readerContainer = document.getElementById('view-reader');
  const toolbar = document.getElementById('reader-toolbar');
  const footer = document.getElementById('reader-footer');

  let lastScrollTop = 0;
  let isBarsVisible = true;
  const SCROLL_THRESHOLD = 25;

  readerContainer?.addEventListener('scroll', () => {
    const currentScrollTop = readerContainer.scrollTop;
    const diff = currentScrollTop - lastScrollTop;

    if (diff > SCROLL_THRESHOLD && currentScrollTop > 80) {
      if (isBarsVisible) {
        toolbar?.classList.add('hidden-bar');
        footer?.classList.add('hidden-bar');
        isBarsVisible = false;
      }
    } else if (diff < -SCROLL_THRESHOLD) {
      if (!isBarsVisible) {
        toolbar?.classList.remove('hidden-bar');
        footer?.classList.remove('hidden-bar');
        isBarsVisible = true;
      }
    }

    lastScrollTop = currentScrollTop;

    if (state.readerMode === 'long-strip' && !state.isAutoNavigatingNext) {
      const scrollBottom = readerContainer.scrollHeight - (currentScrollTop + readerContainer.clientHeight);
      if (scrollBottom <= 80 && diff >= 0) {
        const nextCh = findSmartNextChapter();
        if (nextCh) {
          state.isAutoNavigatingNext = true;
          advanceToNextChapter();
        }
      }
    }
  }, { passive: true });

  document.getElementById('reader-viewport')?.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('select') || e.target.closest('a') || e.target.closest('.nav-click-zone')) return;
    isBarsVisible = !isBarsVisible;
    toolbar?.classList.toggle('hidden-bar', !isBarsVisible);
    footer?.classList.toggle('hidden-bar', !isBarsVisible);
  });

  let rTouchStartX = 0;
  let rTouchStartY = 0;

  document.getElementById('view-reader')?.addEventListener('touchstart', (e) => {
    if (state.currentView !== 'reader') return;
    if (state.readerMode !== 'single' && state.readerMode !== 'double') return;
    if (!e.touches || e.touches.length !== 1) return;
    rTouchStartX = e.touches[0].clientX;
    rTouchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.getElementById('view-reader')?.addEventListener('touchend', (e) => {
    if (state.currentView !== 'reader') return;
    if (state.readerMode !== 'single' && state.readerMode !== 'double') return;
    if (!e.changedTouches || e.changedTouches.length === 0) return;

    const diffX = e.changedTouches[0].clientX - rTouchStartX;
    const diffY = e.changedTouches[0].clientY - rTouchStartY;

    if (Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.4) {
      if (diffX < 0) {
        handleReaderNext();
      } else {
        handleReaderPrev();
      }
    }
  }, { passive: true });
}
