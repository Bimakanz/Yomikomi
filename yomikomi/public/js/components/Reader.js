/**
 * Reader Component
 * Core Manga & Webtoon Reader Engine
 * Supports: Long-strip (Webtoon), Single Page (with panel slicing for tall strips), Double Page
 * 3-Stage Auto-Fallback Proxy Image Loader & Progressive IntersectionObserver
 */

import { state, initIcons, showToast, getMangaTitle, revokeActiveObjectUrls } from '../state.js';
import { saveReadingHistory } from '../services/storage.js';
import { updateCustomChapterDropdown } from './ChapterList.js';

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
    if (stage === 0) {
      const qs = retryTimestamp ? `&retry=${retryTimestamp}` : '';
      return `/api/proxy/image?url=${encodeURIComponent(cleanUrl)}${qs}`;
    } else if (stage === 1) {
      // Stage 1: Try alternate format (swap data-saver <-> data)
      let altUrl = cleanUrl;
      if (altUrl.includes('/data-saver/')) {
        altUrl = altUrl.replace('/data-saver/', '/data/');
      } else if (altUrl.includes('/data/')) {
        altUrl = altUrl.replace('/data/', '/data-saver/');
      }
      return `/api/proxy/image?url=${encodeURIComponent(altUrl)}&t=${ts}&stage=1`;
    } else {
      // Stage 2: Public edge CDN proxy with WebP converter
      return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&we=1&n=-1&t=${ts}`;
    }
  }

  // Non-MangaDex mirrors (Komiku, Komikindo, Mangapill)
  if (stage === 0) {
    const qs = retryTimestamp ? `&retry=${retryTimestamp}` : '';
    return `/api/proxy/image?url=${encodeURIComponent(cleanUrl)}${qs}`;
  } else if (stage === 1) {
    // Stage 1: Retry through proxy with alt flag (NEVER direct unproxied third-party URL!)
    return `/api/proxy/image?url=${encodeURIComponent(cleanUrl)}&alt=1&t=${ts}`;
  } else {
    // Stage 2: Edge CDN fallback (wsrv.nl)
    return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&we=1&n=-1&t=${ts}`;
  }
}

window.getReaderStageUrl = getReaderStageUrl;

export function loadReaderPageImage(imgEl) {
  if (!imgEl) return;
  if (imgEl.dataset.startedLoading === 'true') return;
  imgEl.dataset.startedLoading = 'true';

  const rawUrl = imgEl.dataset.rawUrl;
  if (!rawUrl) return;

  imgEl.dataset.retryStage = '0';
  imgEl.removeAttribute('referrerpolicy');
  imgEl.removeAttribute('crossorigin');
  imgEl.src = getReaderStageUrl(rawUrl, 0);
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
        loadReaderPageImage(nextImg);
      }
    }
  }
}

window.triggerNextPageLoad = triggerNextPageLoad;

export function handlePageImageLoad(imgEl) {
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
  const wrapper = imgEl.closest('.reader-page-wrapper') || imgEl.parentElement;
  if (!wrapper) return;

  const rawUrl = imgEl.dataset.rawUrl;
  const pageNum = parseInt(imgEl.dataset.page || '1', 10);
  let stage = parseInt(imgEl.dataset.retryStage || '0', 10);

  if (stage < 2) {
    const nextStage = stage + 1;
    imgEl.dataset.retryStage = String(nextStage);

    // Exponential backoff between retries to allow failovers to settle
    const backoffMs = nextStage === 1 ? 500 : 1200;
    setTimeout(() => {
      if (!imgEl.isConnected) return;
      imgEl.removeAttribute('crossorigin');
      imgEl.removeAttribute('referrerpolicy');
      imgEl.src = getReaderStageUrl(rawUrl, nextStage, Date.now());
    }, backoffMs);
    return;
  }

  imgEl.dataset.retryStage = '3';

  const skeleton = wrapper.querySelector('.page-skeleton-loader');
  if (skeleton) skeleton.classList.add('fade-out');

  if (wrapper.querySelector('.page-error-retry')) return;

  const retryCard = document.createElement('div');
  retryCard.className = 'page-error-retry';
  retryCard.innerHTML = `
    <i data-lucide="refresh-cw"></i>
    <span>Gagal memuat Halaman ${pageNum}</span>
    <button class="btn-retry-page" type="button">Muat Ulang</button>
  `;

  retryCard.querySelector('.btn-retry-page')?.addEventListener('click', (e) => {
    e.stopPropagation();
    retryCard.remove();
    if (skeleton) skeleton.classList.remove('fade-out');
    imgEl.classList.remove('visible');

    imgEl.dataset.retryStage = '0';
    imgEl.removeAttribute('referrerpolicy');
    imgEl.removeAttribute('crossorigin');
    const retryTimestamp = Date.now();
    imgEl.src = getReaderStageUrl(rawUrl, 0, retryTimestamp);
  });

  wrapper.appendChild(retryCard);
  initIcons();
}

window.handlePageImageError = handlePageImageError;

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
  const chObj = state.currentUnifiedChapter || state.currentChapters[chapterIndex] || state.allMangaDexChapters.find(c => c.id === chapterId);
  const chNum = chObj?.title || (chObj?.attributes?.chapter ? `Chapter ${chObj.attributes.chapter}` : 'Special Chapter');
  if (chObj?.language || chObj?.attributes?.translatedLanguage) {
    state.currentReadingLang = chObj.language || chObj.attributes.translatedLanguage;
  }

  const viewport = document.getElementById('reader-viewport');
  if (viewport) {
    viewport.className = 'reader-viewport long-strip-mode';
    viewport.innerHTML = `
      <div class="chapter-transition-loader">
        <div class="transition-spinner-box">
          <div class="spinner"></div>
          <p class="transition-title">Memuat ${chNum}...</p>
          <span class="transition-sub">Menyiapkan halaman komik</span>
        </div>
        <div class="reader-skeleton-stream">
          <div class="page-skeleton-loader preview-stream"><div class="page-skeleton-shimmer"></div></div>
          <div class="page-skeleton-loader preview-stream"><div class="page-skeleton-shimmer"></div></div>
        </div>
      </div>
    `;
  }

  const rMangaTitle = document.getElementById('reader-manga-title');
  const rChTitle = document.getElementById('reader-chapter-title');
  const footerPill = document.getElementById('footer-chapter-pill');
  if (rMangaTitle) rMangaTitle.textContent = mangaTitle;
  if (rChTitle) rChTitle.textContent = chNum;
  if (footerPill) footerPill.textContent = chNum;

  document.getElementById('reader-toolbar')?.classList.remove('hidden-bar');
  document.getElementById('reader-footer')?.classList.remove('hidden-bar');

  const activeChapterPool = (state.activeChapters && state.activeChapters.length > 0)
    ? state.activeChapters
    : state.currentChapters;

  const dropItems = activeChapterPool.map((ch, idx) => {
    const val = ch.id || ch.url;
    const lFlag = ch.language || (ch.attributes?.translatedLanguage === 'id' ? 'id' : 'en');
    const lText = lFlag === 'id' ? '[ID]' : '[EN]';
    const numText = ch.chapterNumStr || ch.attributes?.chapter || idx + 1;
    const titleText = ch.subTitle || (ch.attributes?.title ? `- ${ch.attributes.title}` : '');
    const srcText = ch.scanlationGroup ? `[${ch.scanlationGroup}]` : '';
    return {
      value: val,
      label: `Chapter ${numText} ${lText} ${srcText} ${titleText}`.trim(),
      lang: lFlag
    };
  });
  updateCustomChapterDropdown(dropItems, chapterId, (val) => {
    if (state.activeChapters && state.activeChapters.length > 0) {
      const newIdx = state.activeChapters.findIndex(c => (c.id === val || c.url === val));
      if (newIdx !== -1 && window.openUnifiedChapter) {
        window.openUnifiedChapter(state.activeChapters[newIdx], newIdx);
        return;
      }
    }
    const newIdx = state.currentChapters.findIndex(c => c.id === val);
    if (newIdx !== -1) {
      openReader(val, newIdx);
    }
  });

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
        <div class="empty-state">
          <i data-lucide="alert-triangle"></i>
          <h3>Gagal Memuat Halaman Chapter</h3>
          <p>Server sedang sibuk atau sesi telah berakhir. Silakan coba lagi.</p>
          <button class="btn-primary" id="btn-retry-reader-chapter">Coba Lagi</button>
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
  state.externalChapters = allChapters;
  state.currentChapterIndex = chapterIndex;
  state.allMangaDexChapters = [];

  if (typeof window.switchView === 'function') {
    window.switchView('reader');
  }

  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const readerContainer = document.getElementById('view-reader');
  if (readerContainer) readerContainer.scrollTop = 0;

  const viewport = document.getElementById('reader-viewport');
  if (viewport) {
    viewport.className = 'reader-viewport long-strip-mode';
    viewport.innerHTML = `
      <div class="chapter-transition-loader">
        <div class="transition-spinner-box">
          <div class="spinner"></div>
          <p class="transition-title">Memuat ${chapterTitle}...</p>
          <span class="transition-sub">Menyiapkan halaman komik Indo Mirror</span>
        </div>
        <div class="reader-skeleton-stream">
          <div class="page-skeleton-loader preview-stream"><div class="page-skeleton-shimmer"></div></div>
          <div class="page-skeleton-loader preview-stream"><div class="page-skeleton-shimmer"></div></div>
        </div>
      </div>
    `;
  }

  const mangaTitle = getMangaTitle(state.currentManga?.attributes);
  const rMangaTitle = document.getElementById('reader-manga-title');
  const rChTitle = document.getElementById('reader-chapter-title');
  const footerPill = document.getElementById('footer-chapter-pill');
  if (rMangaTitle) rMangaTitle.textContent = mangaTitle;
  if (rChTitle) rChTitle.textContent = chapterTitle;
  if (footerPill) footerPill.textContent = chapterTitle;

  document.getElementById('reader-toolbar')?.classList.remove('hidden-bar');
  document.getElementById('reader-footer')?.classList.remove('hidden-bar');

  const dropItems = allChapters.map(ch => ({
    value: ch.url,
    label: ch.title.replace(/\s+/g, ' ').trim(),
    lang: 'id'
  }));
  updateCustomChapterDropdown(dropItems, chapterUrl, (val) => {
    const newIdx = allChapters.findIndex(c => c.url === val);
    if (newIdx !== -1) {
      const targetCh = allChapters[newIdx];
      openExternalReader(targetCh.url, targetCh.title, allChapters, newIdx);
    }
  });

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
        <div class="empty-state">
          <i data-lucide="alert-triangle"></i>
          <h3>Gagal Memuat Halaman Mirror</h3>
          <p>Halaman tidak dapat diakses atau diblokir. Coba chapter lain atau kembali ke beranda.</p>
        </div>
      `;
      initIcons();
    }
  }
}
window.openExternalReader = openExternalReader;

export async function openEnglishReader(chapterUrl, chapterTitle, allChapters, chapterIndex) {
  state.currentPageIndex = 0;
  state.isExternal = true;
  state.currentSource = 'english';
  state.englishChapters = allChapters;
  state.currentChapterIndex = chapterIndex;
  state.allMangaDexChapters = [];

  if (typeof window.switchView === 'function') {
    window.switchView('reader');
  }

  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const readerContainer = document.getElementById('view-reader');
  if (readerContainer) readerContainer.scrollTop = 0;

  const viewport = document.getElementById('reader-viewport');
  if (viewport) {
    viewport.className = 'reader-viewport long-strip-mode';
    viewport.innerHTML = `
      <div class="chapter-transition-loader">
        <div class="transition-spinner-box">
          <div class="spinner"></div>
          <p class="transition-title">Memuat ${chapterTitle}...</p>
          <span class="transition-sub">Menyiapkan halaman komik English Mirror</span>
        </div>
        <div class="reader-skeleton-stream">
          <div class="page-skeleton-loader preview-stream"><div class="page-skeleton-shimmer"></div></div>
          <div class="page-skeleton-loader preview-stream"><div class="page-skeleton-shimmer"></div></div>
        </div>
      </div>
    `;
  }

  const mangaTitle = getMangaTitle(state.currentManga?.attributes);
  const rMangaTitle = document.getElementById('reader-manga-title');
  const rChTitle = document.getElementById('reader-chapter-title');
  const footerPill = document.getElementById('footer-chapter-pill');
  if (rMangaTitle) rMangaTitle.textContent = mangaTitle;
  if (rChTitle) rChTitle.textContent = chapterTitle;
  if (footerPill) footerPill.textContent = chapterTitle;

  document.getElementById('reader-toolbar')?.classList.remove('hidden-bar');
  document.getElementById('reader-footer')?.classList.remove('hidden-bar');

  const dropItems = allChapters.map(ch => ({
    value: ch.url,
    label: ch.title.replace(/\s+/g, ' ').trim(),
    lang: 'en'
  }));
  updateCustomChapterDropdown(dropItems, chapterUrl, (val) => {
    const newIdx = allChapters.findIndex(c => c.url === val);
    if (newIdx !== -1) {
      const targetCh = allChapters[newIdx];
      openEnglishReader(targetCh.url, targetCh.title, allChapters, newIdx);
    }
  });

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
        <div class="empty-state">
          <i data-lucide="alert-triangle"></i>
          <h3>Gagal Memuat Halaman English Mirror</h3>
          <p>Halaman tidak dapat diakses atau diblokir. Coba chapter lain atau kembali ke beranda.</p>
        </div>
      `;
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

    window.readerPageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const wrap = entry.target;
          const img = wrap.querySelector('.reader-page-img');
          if (img && img.dataset.startedLoading !== 'true') {
            loadReaderPageImage(img);
          }
          observer.unobserve(wrap);
        }
      });
    }, {
      rootMargin: '1500px 0px 1500px 0px'
    });

    pages.forEach((pageUrl, idx) => {
      const pageNum = idx + 1;
      const pageWrap = document.createElement('div');
      pageWrap.className = 'reader-page-wrapper';
      pageWrap.dataset.page = pageNum;
      pageWrap.innerHTML = `
        <div class="page-skeleton-loader" id="skeleton-page-${pageNum}">
          <div class="page-skeleton-shimmer"></div>
          <div class="page-skeleton-label">
            <div class="spinner-small"></div>
            <span>Memuat Hal. ${pageNum}...</span>
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
      if (idx < 4) {
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

    let currentChapterList = [];
    if (state.isExternal && state.externalChapters.length > 0) {
      currentChapterList = state.externalChapters.map((ch, i) => ({
        id: ch.url,
        title: ch.title.replace(/\s+/g, ' ').trim(),
        index: i
      }));
    } else if (state.currentSource === 'english' && state.englishChapters.length > 0) {
      currentChapterList = state.englishChapters.map((ch, i) => ({
        id: ch.url,
        title: ch.title.replace(/\s+/g, ' ').trim(),
        index: i
      }));
    } else {
      currentChapterList = state.currentChapters.map((ch, i) => ({
        id: ch.id,
        title: `Chapter ${ch.attributes?.chapter || i + 1}${ch.attributes?.title ? ' - ' + ch.attributes.title : ''}`,
        index: i
      }));
    }

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
          if (state.isExternal) {
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

export function renderSinglePage(pages, index, sliceIndex = 0) {
  const viewport = document.getElementById('reader-viewport');
  if (!viewport) return;
  const total = pages.length;
  state.currentPageIndex = Math.max(0, Math.min(index, total - 1));
  state.currentSingleSlice = sliceIndex || 0;

  const currentUrl = pages[state.currentPageIndex];

  if (state.currentPageIndex < total - 1) {
    const preloadImg = new Image();
    preloadImg.src = getReaderStageUrl(pages[state.currentPageIndex + 1], 0);
  }

  const testImg = new Image();
  testImg.src = getReaderStageUrl(currentUrl, 0);

  const renderContent = () => {
    if (state.readerModePreference === 'auto' && testImg.naturalWidth > 0 && (testImg.naturalHeight / testImg.naturalWidth) > 1.65) {
      state.readerMode = 'long-strip';
      if (state.currentChapterData) {
        renderReaderPages(state.currentChapterData);
        return;
      }
    }

    const isLongStrip = testImg.naturalWidth > 0 && (testImg.naturalHeight / testImg.naturalWidth) > 1.6;

    if (isLongStrip) {
      const sliceRatio = 1.35;
      const totalSlices = Math.max(2, Math.round(testImg.naturalHeight / (testImg.naturalWidth * sliceRatio)));

      if (state.currentSingleSlice >= totalSlices) {
        state.currentSingleSlice = totalSlices - 1;
      }
      const currSlice = state.currentSingleSlice;

      const pageCounter = document.getElementById('page-counter-text');
      if (pageCounter) {
        pageCounter.textContent = `${state.currentPageIndex + 1} (${currSlice + 1}/${totalSlices}) / ${total}`;
      }

      const offsetPercent = totalSlices > 1 ? (currSlice / totalSlices) * 100 : 0;

      viewport.innerHTML = `
        <div class="single-page-container">
          <div class="nav-click-zone left" title="Panel Sebelumnya (↑ / W)"></div>
          <div class="slice-indicator-badge">Panel ${currSlice + 1} / ${totalSlices}</div>
          <div class="single-page-slice-window">
            <img 
              src="${getReaderStageUrl(currentUrl, 0)}" 
              class="single-page-slice-img" 
              style="transform: translateY(-${offsetPercent}%);" 
              alt="Halaman ${state.currentPageIndex + 1} Panel ${currSlice + 1}"
              data-page="${state.currentPageIndex + 1}"
              data-raw-url="${currentUrl}"
              data-retry-stage="0"
              onload="window.handlePageImageLoad(this)"
              onerror="window.handlePageImageError(this)"
            >
          </div>
          <div class="nav-click-zone right" title="Panel Selanjutnya (↓ / S / Spasi)"></div>
        </div>
      `;

      viewport.querySelector('.nav-click-zone.left')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.currentSingleSlice > 0) {
          state.currentSingleSlice--;
          renderSinglePage(pages, state.currentPageIndex, state.currentSingleSlice);
        } else if (state.currentPageIndex > 0) {
          state.currentPageIndex--;
          renderSinglePage(pages, state.currentPageIndex, 999);
        } else {
          advanceToPrevChapter();
        }
      });

      viewport.querySelector('.nav-click-zone.right')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.currentSingleSlice < totalSlices - 1) {
          state.currentSingleSlice++;
          renderSinglePage(pages, state.currentPageIndex, state.currentSingleSlice);
        } else if (state.currentPageIndex < total - 1) {
          state.currentPageIndex++;
          renderSinglePage(pages, state.currentPageIndex, 0);
        } else {
          advanceToNextChapter();
        }
      });

    } else {
      const pageCounter = document.getElementById('page-counter-text');
      if (pageCounter) pageCounter.textContent = `${state.currentPageIndex + 1} / ${total}`;

      viewport.innerHTML = `
        <div class="single-page-container">
          <div class="page-skeleton-loader" id="single-page-skeleton" style="${testImg.complete ? 'display: none;' : ''}">
            <div class="page-skeleton-shimmer"></div>
            <div class="page-skeleton-label">
              <div class="spinner-small"></div>
              <span>Memuat Hal. ${state.currentPageIndex + 1}...</span>
            </div>
          </div>
          <div class="nav-click-zone left" title="Halaman Sebelumnya (↑ / W)"></div>
          <img 
            src="${getReaderStageUrl(currentUrl, 0)}" 
            class="single-page-img" 
            alt="Halaman ${state.currentPageIndex + 1}"
            data-page="${state.currentPageIndex + 1}"
            data-raw-url="${currentUrl}"
            data-retry-stage="0"
            onload="window.handlePageImageLoad(this)"
            onerror="window.handlePageImageError(this)"
          >
          <div class="nav-click-zone right" title="Halaman Selanjutnya (↓ / S / Spasi)"></div>
        </div>
      `;

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
    }

    updateReaderNavButtons();
  };

  if (testImg.complete && testImg.naturalWidth > 0) {
    renderContent();
  } else {
    testImg.onload = renderContent;
    testImg.onerror = renderContent;
    viewport.innerHTML = `
      <div class="single-page-container">
        <div class="page-skeleton-loader" id="single-page-skeleton">
          <div class="page-skeleton-shimmer"></div>
          <div class="page-skeleton-label">
            <div class="spinner-small"></div>
            <span>Memuat Hal. ${state.currentPageIndex + 1}...</span>
          </div>
        </div>
        <div class="nav-click-zone left"></div>
        <img 
          src="${getReaderStageUrl(currentUrl, 0)}" 
          class="single-page-img" 
          alt="Halaman ${state.currentPageIndex + 1}"
          data-page="${state.currentPageIndex + 1}"
          data-raw-url="${currentUrl}"
          data-retry-stage="0"
          onload="const sk = document.getElementById('single-page-skeleton'); if (sk) sk.style.display = 'none'; this.classList.add('visible');"
          onerror="window.handlePageImageError(this)"
        >
        <div class="nav-click-zone right"></div>
      </div>
    `;
  }
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

export function findSmartNextChapter() {
  if (state.activeChapters && state.activeChapters.length > 0) {
    if (state.currentChapterIndex < state.activeChapters.length - 1) {
      return {
        type: 'unified',
        chapter: state.activeChapters[state.currentChapterIndex + 1],
        index: state.currentChapterIndex + 1,
        isFallback: false
      };
    }
    return null;
  }

  if (state.isExternal) {
    if (state.currentSource === 'english') {
      if (state.currentChapterIndex < state.englishChapters.length - 1) {
        return {
          type: 'english',
          chapter: state.englishChapters[state.currentChapterIndex + 1],
          index: state.currentChapterIndex + 1,
          isFallback: false
        };
      }
      return null;
    } else {
      if (state.currentChapterIndex < state.externalChapters.length - 1) {
        return {
          type: 'bacakomik',
          chapter: state.externalChapters[state.currentChapterIndex + 1],
          index: state.currentChapterIndex + 1,
          isFallback: false
        };
      }
      return null;
    }
  }

  const currentCh = state.currentChapters[state.currentChapterIndex] || state.allMangaDexChapters.find(c => c.id === state.currentChapterId);
  if (!currentCh) return null;

  const pool = (state.allMangaDexChapters && state.allMangaDexChapters.length > 0) ? state.allMangaDexChapters : state.currentChapters;

  const currentLang = currentCh.attributes?.translatedLanguage || state.currentReadingLang || 'id';
  const currentNum = parseFloat(currentCh.attributes?.chapter);

  if (!isNaN(currentNum)) {
    const sameLangCandidates = pool
      .filter(c => (c.attributes?.translatedLanguage || 'id') === currentLang && parseFloat(c.attributes?.chapter) > currentNum)
      .sort((a, b) => parseFloat(a.attributes?.chapter) - parseFloat(b.attributes?.chapter));

    if (sameLangCandidates.length > 0) {
      const nextCh = sameLangCandidates[0];
      const nextIdx = state.currentChapters.findIndex(c => c.id === nextCh.id);
      return {
        type: 'mangadex',
        chapter: nextCh,
        index: nextIdx !== -1 ? nextIdx : 0,
        isFallback: false,
        lang: currentLang
      };
    }

    if (currentLang === 'id') {
      const enCandidates = pool
        .filter(c => (c.attributes?.translatedLanguage || 'en') === 'en' && parseFloat(c.attributes?.chapter) > currentNum)
        .sort((a, b) => parseFloat(a.attributes?.chapter) - parseFloat(b.attributes?.chapter));

      if (enCandidates.length > 0) {
        const nextCh = enCandidates[0];
        const nextIdx = state.currentChapters.findIndex(c => c.id === nextCh.id);
        return {
          type: 'mangadex',
          chapter: nextCh,
          index: nextIdx !== -1 ? nextIdx : 0,
          isFallback: true,
          fromLang: 'id',
          toLang: 'en'
        };
      }
    }
  }

  if (state.currentChapterIndex < state.currentChapters.length - 1) {
    const nextCh = state.currentChapters[state.currentChapterIndex + 1];
    return {
      type: 'mangadex',
      chapter: nextCh,
      index: state.currentChapterIndex + 1,
      isFallback: false
    };
  }

  return null;
}

export function findSmartPrevChapter() {
  if (state.activeChapters && state.activeChapters.length > 0) {
    if (state.currentChapterIndex > 0) {
      return {
        type: 'unified',
        chapter: state.activeChapters[state.currentChapterIndex - 1],
        index: state.currentChapterIndex - 1,
        isFallback: false
      };
    }
    return null;
  }

  if (state.isExternal) {
    if (state.currentSource === 'english') {
      if (state.currentChapterIndex > 0) {
        return {
          type: 'english',
          chapter: state.englishChapters[state.currentChapterIndex - 1],
          index: state.currentChapterIndex - 1,
          isFallback: false
        };
      }
      return null;
    } else {
      if (state.currentChapterIndex > 0) {
        return {
          type: 'bacakomik',
          chapter: state.externalChapters[state.currentChapterIndex - 1],
          index: state.currentChapterIndex - 1,
          isFallback: false
        };
      }
      return null;
    }
  }

  const currentCh = state.currentChapters[state.currentChapterIndex] || state.allMangaDexChapters.find(c => c.id === state.currentChapterId);
  if (!currentCh) return null;

  const pool = (state.allMangaDexChapters && state.allMangaDexChapters.length > 0) ? state.allMangaDexChapters : state.currentChapters;

  const currentLang = currentCh.attributes?.translatedLanguage || state.currentReadingLang || 'id';
  const currentNum = parseFloat(currentCh.attributes?.chapter);

  if (!isNaN(currentNum)) {
    const sameLangCandidates = pool
      .filter(c => (c.attributes?.translatedLanguage || 'id') === currentLang && parseFloat(c.attributes?.chapter) < currentNum)
      .sort((a, b) => parseFloat(b.attributes?.chapter) - parseFloat(a.attributes?.chapter));

    if (sameLangCandidates.length > 0) {
      const prevCh = sameLangCandidates[0];
      const prevIdx = state.currentChapters.findIndex(c => c.id === prevCh.id);
      return {
        type: 'mangadex',
        chapter: prevCh,
        index: prevIdx !== -1 ? prevIdx : 0,
        isFallback: false,
        lang: currentLang
      };
    }

    if (currentLang === 'id') {
      const enCandidates = pool
        .filter(c => (c.attributes?.translatedLanguage || 'en') === 'en' && parseFloat(c.attributes?.chapter) < currentNum)
        .sort((a, b) => parseFloat(b.attributes?.chapter) - parseFloat(a.attributes?.chapter));

      if (enCandidates.length > 0) {
        const prevCh = enCandidates[0];
        const prevIdx = state.currentChapters.findIndex(c => c.id === prevCh.id);
        return {
          type: 'mangadex',
          chapter: prevCh,
          index: prevIdx !== -1 ? prevIdx : 0,
          isFallback: true,
          fromLang: 'id',
          toLang: 'en'
        };
      }
    }
  }

  if (state.currentChapterIndex > 0) {
    const prevCh = state.currentChapters[state.currentChapterIndex - 1];
    return {
      type: 'mangadex',
      chapter: prevCh,
      index: state.currentChapterIndex - 1,
      isFallback: false
    };
  }

  return null;
}

export function advanceToNextChapter() {
  const next = findSmartNextChapter();
  if (!next) return;

  if (next.type === 'unified') {
    if (window.openUnifiedChapter) {
      window.openUnifiedChapter(next.chapter, next.index);
    }
    return;
  }

  if (next.type === 'english') {
    openEnglishReader(next.chapter.url, next.chapter.title, state.englishChapters, next.index);
  } else if (next.type === 'bacakomik') {
    openExternalReader(next.chapter.url, next.chapter.title, state.externalChapters, next.index);
  } else {
    if (next.isFallback) {
      state.currentReadingLang = 'en';
    }
    openReader(next.chapter.id, next.index);
  }
}

export function advanceToPrevChapter() {
  const prev = findSmartPrevChapter();
  if (!prev) return;

  if (prev.type === 'unified') {
    if (window.openUnifiedChapter) {
      window.openUnifiedChapter(prev.chapter, prev.index);
    }
    return;
  }

  if (prev.type === 'english') {
    openEnglishReader(prev.chapter.url, prev.chapter.title, state.englishChapters, prev.index);
  } else if (prev.type === 'bacakomik') {
    openExternalReader(prev.chapter.url, prev.chapter.title, state.externalChapters, prev.index);
  } else {
    if (prev.isFallback) {
      state.currentReadingLang = 'en';
    }
    openReader(prev.chapter.id, prev.index);
  }
}

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
      if (scrollBottom <= 40 && diff >= 0) {
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
