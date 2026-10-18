/**
 * MangaDex Personal Reader - Client Application Logic
 */

// Application State
const state = {
  currentView: 'home',
  mangaList: [],
  heroManga: [],
  currentManga: null,
  allMangaDexChapters: [], // Full list of MangaDex chapters (ID & EN)
  currentChapters: [], // Currently displayed/filtered chapters
  currentChapterId: null,
  currentChapterIndex: 0,
  currentChapterData: null,
  currentLang: 'all', // 'all', 'id', 'en'
  currentReadingLang: 'id', // Active reader language ('id' or 'en')
  currentSort: 'asc',
  readerMode: 'long-strip', // 'long-strip', 'single', 'double'
  readerQuality: 'dataSaver', // 'dataSaver' or 'pages' (original)
  currentPageIndex: 0,
  currentSingleSlice: 0,
  isAutoNavigatingNext: false,
  heroSlideInterval: null,
  activeHeroIndex: 0,
  isExternal: false,
  externalChapters: [],
  mirrorOrder: 'asc',
  englishChapters: [],
  englishOrder: 'asc',
  currentSource: 'mangadex', // 'mangadex', 'bacakomik', or 'english'
  activeObjectUrls: [],
};

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  initIcons();
  initNavigation();
  initMobileDrawer();
  initSearch();
  initFilters();
  initLanguagePills();
  initReaderControls();
  initHistoryControls();
  initSourceTabs();
  initOfflineQueueUI();
  initOfflineDownloadControls();
  updateAllCollectionBadges();
  initPWA();

  // Load initial data
  loadPopularManga();
  loadLatestManga();
});

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Toast Notification
function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    toast.style.transition = 'all 200ms ease';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

// ==========================================
// VIEW ROUTING
// ==========================================

// Helper to revoke blob object URLs and prevent browser memory leaks
function revokeActiveObjectUrls() {
  if (state.activeObjectUrls && state.activeObjectUrls.length > 0) {
    state.activeObjectUrls.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (e) { }
    });
    state.activeObjectUrls = [];
  }
}

function switchView(viewName) {
  state.currentView = viewName;

  if (viewName !== 'reader') {
    revokeActiveObjectUrls();
  }

  const views = ['home', 'detail', 'reader', 'history', 'offline'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) {
      if (v === viewName) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  });

  // Toggle navbar visibility (hide navbar in reader for full immersion)
  const navbar = document.getElementById('main-navbar');
  if (viewName === 'reader') {
    navbar.classList.add('hidden');
    document.body.style.overflow = 'hidden';
    const readerEl = document.getElementById('view-reader');
    if (readerEl) readerEl.scrollTop = 0;
    window.scrollTo(0, 0);
  } else {
    navbar.classList.remove('hidden');
    document.body.style.overflow = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Update active nav links across desktop navbar & mobile drawer
  document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.drawer-nav-item').forEach(btn => btn.classList.remove('active'));

  if (viewName === 'home') {
    document.getElementById('nav-btn-home')?.classList.add('active');
    document.getElementById('drawer-nav-home')?.classList.add('active');
  }
  if (viewName === 'history') {
    if (state.currentCollectionTab === 'history') {
      document.getElementById('nav-btn-history')?.classList.add('active');
      document.getElementById('drawer-nav-history')?.classList.add('active');
    } else {
      document.getElementById('nav-btn-bookmarks')?.classList.add('active');
      document.getElementById('drawer-nav-bookmarks')?.classList.add('active');
    }
  }
  if (viewName === 'offline') {
    document.getElementById('nav-btn-offline')?.classList.add('active');
    document.getElementById('drawer-nav-offline')?.classList.add('active');
    renderOfflineLibraryView();
  }

  updateAllCollectionBadges();
  initIcons();
}

// ==========================================
// NAVIGATION & HEADER
// ==========================================

function initNavigation() {
  document.getElementById('brand-logo')?.addEventListener('click', () => {
    switchView('home');
  });

  document.getElementById('nav-btn-home')?.addEventListener('click', () => {
    switchView('home');
    loadPopularManga();
  });

  document.getElementById('nav-btn-bookmarks')?.addEventListener('click', () => {
    switchView('history');
    switchCollectionTab('bookmarks');
  });

  document.getElementById('nav-btn-history')?.addEventListener('click', () => {
    switchView('history');
    switchCollectionTab('history');
  });

  document.getElementById('tab-collection-bookmarks')?.addEventListener('click', () => {
    switchCollectionTab('bookmarks');
  });

  document.getElementById('tab-collection-history')?.addEventListener('click', () => {
    switchCollectionTab('history');
  });

  document.getElementById('nav-btn-offline')?.addEventListener('click', () => {
    switchView('offline');
  });

  document.getElementById('btn-back-home')?.addEventListener('click', () => {
    switchView('home');
  });

  document.getElementById('history-btn-explore')?.addEventListener('click', () => {
    switchView('home');
  });
}

// ==========================================
// FILTER TABS
// ==========================================

function initFilters() {
  const tabs = document.querySelectorAll('.filter-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const filter = tab.dataset.filter;

      if (filter === 'all' || filter === 'popular') {
        loadPopularManga();
      } else if (filter === 'latest') {
        loadLatestManga();
      } else if (filter === 'indo') {
        loadIndonesianManga();
      } else if (filter === 'english') {
        loadEnglishManga();
      }
    });
  });
}

function updateActiveFilterTab(filterName) {
  document.querySelectorAll('.filter-tab').forEach(tab => {
    if (tab.dataset.filter === filterName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
}

// ==========================================
// DATA FETCHING & RENDERING (HOME)
// ==========================================

// Helper: Extract Title from attributes (Prioritize English, Indonesian, altTitles, Romanized)
function getMangaTitle(attributes) {
  if (!attributes) return 'Untitled Manga';

  // 1. Direct English title
  if (attributes.title?.en) return attributes.title.en;

  // 2. Direct Indonesian title
  if (attributes.title?.id) return attributes.title.id;

  // 3. Scan altTitles for English or Indonesian
  if (Array.isArray(attributes.altTitles)) {
    for (const alt of attributes.altTitles) {
      if (alt.en && typeof alt.en === 'string') return alt.en;
    }
    for (const alt of attributes.altTitles) {
      if (alt.id && typeof alt.id === 'string') return alt.id;
    }
  }

  // 4. Romanized titles
  if (attributes.title?.['ja-ro']) return attributes.title['ja-ro'];
  if (attributes.title?.['ko-ro']) return attributes.title['ko-ro'];
  if (attributes.title?.['zh-ro']) return attributes.title['zh-ro'];

  // 5. Fallback to any title property
  if (attributes.title && typeof attributes.title === 'object') {
    const vals = Object.values(attributes.title);
    if (vals.length > 0 && vals[0]) return vals[0];
  }

  // 6. Fallback to any altTitle property
  if (Array.isArray(attributes.altTitles) && attributes.altTitles.length > 0) {
    for (const alt of attributes.altTitles) {
      const vals = Object.values(alt);
      if (vals.length > 0 && vals[0]) return vals[0];
    }
  }

  return 'Untitled Manga';
}

// ==========================================
// PERSISTENT COVER CACHE (Universal Healing)
// ==========================================
const STORAGE_KEY_COVER_CACHE = 'yomikomi_cover_cache';

const CoverCache = {
  _cache: null,
  init() {
    if (this._cache) return this._cache;
    try {
      this._cache = JSON.parse(localStorage.getItem(STORAGE_KEY_COVER_CACHE) || '{}');
    } catch {
      this._cache = {};
    }
    return this._cache;
  },
  get(id, title) {
    const c = this.init();
    if (id && c[id] && !c[id].includes('No+Cover')) return c[id];
    if (title) {
      const cleanTitle = title.toLowerCase().trim();
      if (c[cleanTitle] && !c[cleanTitle].includes('No+Cover')) return c[cleanTitle];
    }
    return null;
  },
  set(id, title, url) {
    if (!url || url.includes('No+Cover')) return;
    const c = this.init();
    if (id) c[id] = url;
    if (title) {
      const cleanTitle = title.toLowerCase().trim();
      c[cleanTitle] = url;
    }
    try {
      localStorage.setItem(STORAGE_KEY_COVER_CACHE, JSON.stringify(c));
    } catch { }
  }
};

// Helper: Extract Cover Art URL
function getCoverUrl(manga) {
  if (!manga) return 'https://placehold.co/300x420/1e2025/ffffff?text=No+Cover';

  // 1. Direct coverUrl property
  if (manga.coverUrl && typeof manga.coverUrl === 'string' && !manga.coverUrl.includes('No+Cover')) {
    return manga.coverUrl;
  }

  // 2. Direct coverUrl inside attributes
  if (manga.attributes?.coverUrl && typeof manga.attributes.coverUrl === 'string' && !manga.attributes.coverUrl.includes('No+Cover')) {
    return manga.attributes.coverUrl;
  }

  // 3. MangaDex style relationship cover_art
  const coverRel = manga.relationships?.find(r => r.type === 'cover_art');
  const fileName = coverRel?.attributes?.fileName;
  if (fileName) {
    if (fileName.startsWith('http') || fileName.startsWith('/')) {
      return fileName;
    }
    return `/api/cover/${manga.id}/${fileName}.512.jpg`;
  }

  // 4. Check CoverCache
  const title = manga.attributes ? getMangaTitle(manga.attributes) : (manga.title || '');
  const cached = CoverCache.get(manga.id, title);
  if (cached) return cached;

  return 'https://placehold.co/300x420/1e2025/ffffff?text=No+Cover';
}

// Helper: Extract Author Name
function getAuthorName(manga) {
  const authorRel = manga.relationships?.find(r => r.type === 'author');
  return authorRel?.attributes?.name || 'Scanlation Community';
}

// 1. Load Popular Manga
async function loadPopularManga() {
  document.getElementById('grid-section-title').textContent = 'Komik Paling Populer (Trending)';
  showGridSkeleton();

  try {
    const res = await fetch('/api/popular');
    const data = await res.json();
    state.mangaList = data.data || [];
    state.mangaList.forEach(m => {
      CoverCache.set(m.id, getMangaTitle(m.attributes), getCoverUrl(m));
    });
    renderMangaGrid(state.mangaList);

    // Set first 5 as hero carousel
    if (state.mangaList.length >= 3 && state.heroManga.length === 0) {
      state.heroManga = state.mangaList.slice(0, 5);
      renderHeroCarousel(state.heroManga);
    }
  } catch (error) {
    console.error('Failed to load popular manga:', error);
    showToast('Gagal memuat manga populer');
  }
}

// 2. Load Latest Updates
async function loadLatestManga() {
  document.getElementById('grid-section-title').textContent = 'Rilis Chapter Terbaru';
  showGridSkeleton();

  try {
    const res = await fetch('/api/latest');
    const data = await res.json();
    state.mangaList = data.data || [];
    renderMangaGrid(state.mangaList);
  } catch (error) {
    console.error('Failed to load latest manga:', error);
    showToast('Gagal memuat rilisan terbaru');
  }
}

// 3. Load Indonesian Manga
async function loadIndonesianManga() {
  document.getElementById('grid-section-title').textContent = 'Manga Terjemahan Bahasa Indonesia 🇮🇩';
  showGridSkeleton();

  try {
    const res = await fetch('/api/search?lang=id&limit=24');
    const data = await res.json();
    state.mangaList = data.data || [];
    renderMangaGrid(state.mangaList);
  } catch (error) {
    console.error('Failed to load Indonesian manga:', error);
  }
}

// 4. Load English Manga
async function loadEnglishManga() {
  document.getElementById('grid-section-title').textContent = 'Manga Scanlation English 🇬🇧';
  showGridSkeleton();

  try {
    const res = await fetch('/api/search?lang=en&limit=24');
    const data = await res.json();
    state.mangaList = data.data || [];
    renderMangaGrid(state.mangaList);
  } catch (error) {
    console.error('Failed to load English manga:', error);
  }
}

function showGridSkeleton() {
  const grid = document.getElementById('manga-grid');
  grid.innerHTML = `
    <div class="grid-loading-placeholder">
      <div class="card-skeleton skeleton-pulse"></div>
      <div class="card-skeleton skeleton-pulse"></div>
      <div class="card-skeleton skeleton-pulse"></div>
      <div class="card-skeleton skeleton-pulse"></div>
      <div class="card-skeleton skeleton-pulse"></div>
      <div class="card-skeleton skeleton-pulse"></div>
    </div>
  `;
}

// Render Hero Carousel
function renderHeroCarousel(items) {
  const container = document.getElementById('hero-carousel');
  container.innerHTML = '';

  items.forEach((manga, idx) => {
    const title = getMangaTitle(manga.attributes);
    const coverUrl = getCoverUrl(manga);
    const desc = manga.attributes.description?.en || 'Jelajahi petualangan manga menakjubkan ini secara gratis di Yomikomi.';
    const status = manga.attributes.status?.toUpperCase() || 'ONGOING';

    // First 2 tags
    const tags = manga.attributes.tags?.slice(0, 2).map(t => t.attributes.name.en) || ['Manga'];

    const slide = document.createElement('div');
    slide.className = `hero-slide ${idx === 0 ? 'active' : ''}`;
    slide.style.backgroundImage = `url('${coverUrl}')`;
    slide.innerHTML = `
      <div class="hero-content">
        <div class="hero-badge-row">
          <span class="badge-tag accent">
            <span>Populer</span>
          </span>
          <span class="badge-tag">${status}</span>
          ${tags.map(t => `<span class="badge-tag">${t}</span>`).join('')}
        </div>
        <h1 class="hero-title">${title}</h1>
        <p class="hero-desc">${desc}</p>
        <div class="hero-actions">
          <button class="btn-primary" onclick="openMangaDetail('${manga.id}')">
            <i data-lucide="book-open"></i>
            <span>Baca</span>
          </button>
          <button class="btn-secondary" onclick="openMangaDetail('${manga.id}')">
            <i data-lucide="info"></i>
            <span>Info</span>
          </button>
        </div>
      </div>
    `;
    container.appendChild(slide);
  });

  // Dots
  const dotsContainer = document.createElement('div');
  dotsContainer.className = 'hero-nav-dots';
  items.forEach((_, idx) => {
    const dot = document.createElement('div');
    dot.className = `dot ${idx === 0 ? 'active' : ''}`;
    dot.addEventListener('click', () => goToHeroSlide(idx));
    dotsContainer.appendChild(dot);
  });
  container.appendChild(dotsContainer);

  initIcons();

  // Auto slide interval
  if (state.heroSlideInterval) clearInterval(state.heroSlideInterval);
  state.heroSlideInterval = setInterval(() => {
    const nextIdx = (state.activeHeroIndex + 1) % items.length;
    goToHeroSlide(nextIdx);
  }, 6000);
}

function goToHeroSlide(idx) {
  state.activeHeroIndex = idx;
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-nav-dots .dot');

  slides.forEach((s, i) => s.classList.toggle('active', i === idx));
  dots.forEach((d, i) => d.classList.toggle('active', i === idx));
}

// Render Manga Grid
function renderMangaGrid(mangaList) {
  const grid = document.getElementById('manga-grid');
  document.getElementById('grid-count-badge').textContent = `${mangaList.length} Judul`;

  if (!mangaList || mangaList.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i data-lucide="book-x"></i>
        <h3>Tidak Ada Komik Ditemukan</h3>
        <p>Coba gunakan kata kunci lain atau pilih filter yang berbeda.</p>
      </div>
    `;
    initIcons();
    return;
  }

  grid.innerHTML = '';
  mangaList.forEach(manga => {
    const title = getMangaTitle(manga.attributes);
    const coverUrl = getCoverUrl(manga);
    const status = manga.attributes.status ? manga.attributes.status.toUpperCase() : 'ONGOING';
    const lastChapter = manga.attributes.lastChapter ? `Ch. ${manga.attributes.lastChapter}` : 'Update';

    const card = document.createElement('article');
    card.className = 'manga-card';
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="card-poster">
        <img src="${coverUrl}" alt="${title}" loading="lazy" onerror="this.src='https://placehold.co/300x420/1e2025/ffffff?text=Cover';">
        <div class="card-overlay-gradient"></div>
        <span class="card-status-badge">${status}</span>
      </div>
      <div class="card-content">
        <h3 class="card-title" title="${title}">${title}</h3>
        <div class="card-meta">
          <span>${lastChapter}</span>
          <div class="card-languages">
            ${manga.attributes.availableTranslatedLanguages?.includes('id') ? '<span class="lang-flag" title="Tersedia Bahasa Indonesia">🇮🇩</span>' : ''}
            ${manga.attributes.availableTranslatedLanguages?.includes('en') ? '<span class="lang-flag" title="Tersedia English">🇬🇧</span>' : ''}
          </div>
        </div>
      </div>
    `;

    card.addEventListener('click', () => openMangaDetail(manga.id));
    grid.appendChild(card);
  });

  initIcons();
}

// ==========================================
// SEARCH MODAL (Ctrl + K)
// ==========================================

let searchDebounceTimeout = null;
let searchAbortController = null;

function initSearch() {
  const modal = document.getElementById('search-modal');
  const triggerBtn = document.getElementById('search-trigger');
  const searchInput = document.getElementById('modal-search-input');
  const clearBtn = document.getElementById('modal-search-clear');
  const escBtn = document.getElementById('modal-close-esc');
  const resultsContainer = document.getElementById('search-results');

  function openModal() {
    modal.classList.remove('hidden');
    searchInput.focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
    if (searchAbortController) searchAbortController.abort();
    searchInput.value = '';
    resultsContainer.innerHTML = `
      <div class="search-placeholder-state">
        <i data-lucide="sparkles"></i>
        <p>Ketik judul komik favorit Anda untuk mencari dari katalog komik</p>
      </div>
    `;
    initIcons();
  }

  triggerBtn?.addEventListener('click', openModal);
  document.getElementById('mobile-search-trigger')?.addEventListener('click', openModal);
  document.getElementById('drawer-search-trigger')?.addEventListener('click', () => {
    closeMobileDrawer();
    openModal();
  });
  escBtn?.addEventListener('click', closeModal);

  // Close on outside click
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Global Shortcut: Ctrl + K
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openModal();
    }
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });

  // Live Debounced Search with AbortController
  searchInput?.addEventListener('input', () => {
    const q = searchInput.value.trim();
    clearBtn.classList.toggle('hidden', q.length === 0);

    clearTimeout(searchDebounceTimeout);
    if (searchAbortController) searchAbortController.abort();

    if (!q) {
      resultsContainer.innerHTML = `
        <div class="search-placeholder-state">
          <i data-lucide="sparkles"></i>
          <p>Ketik judul komik favorit Anda untuk mencari dari katalog komik</p>
        </div>
      `;
      initIcons();
      return;
    }

    resultsContainer.innerHTML = `
      <div class="search-placeholder-state">
        <div class="spinner"></div>
        <p>Mencari "${q}"...</p>
      </div>
    `;

    searchDebounceTimeout = setTimeout(async () => {
      searchAbortController = new AbortController();
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=10`, {
          signal: searchAbortController.signal
        });
        const data = await res.json();
        renderSearchResults(data.data || []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          resultsContainer.innerHTML = `<p class="search-placeholder-state">Gagal mencari. Silakan coba lagi.</p>`;
        }
      }
    }, 400);
  });

  clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.add('hidden');
    searchInput.focus();
  });

  // Quick Tag chips in modal
  document.querySelectorAll('.quick-tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const tag = chip.dataset.tag;
      searchInput.value = tag;
      searchInput.dispatchEvent(new Event('input'));
    });
  });
}

function renderSearchResults(results) {
  const container = document.getElementById('search-results');
  if (results.length === 0) {
    container.innerHTML = `
      <div class="search-placeholder-state">
        <i data-lucide="search-x"></i>
        <p>Tidak ada komik yang cocok dengan pencarian Anda.</p>
      </div>
    `;
    initIcons();
    return;
  }

  container.innerHTML = '';
  results.forEach(manga => {
    const title = getMangaTitle(manga.attributes);
    const coverUrl = getCoverUrl(manga);
    const author = getAuthorName(manga);
    const status = manga.attributes.status?.toUpperCase() || 'ONGOING';

    const item = document.createElement('div');
    item.className = 'search-item';
    item.innerHTML = `
      <img src="${coverUrl}" class="search-thumb" alt="${title}" loading="lazy">
      <div class="search-item-info">
        <div class="search-item-title">${title}</div>
        <div class="search-item-meta">
          <span>${author}</span> • <span class="text-accent">${status}</span>
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      document.getElementById('search-modal').classList.add('hidden');
      openMangaDetail(manga.id);
    });

    container.appendChild(item);
  });

  initIcons();
}

// ==========================================
// VIEW 2: MANGA DETAIL & CHAPTER FEED
// ==========================================

async function openMangaDetail(mangaId) {
  switchView('detail');

  const heroContent = document.getElementById('detail-hero-content');
  const chaptersList = document.getElementById('chapters-list');

  // Instant pre-population from state.mangaList or offline database so currentManga is never null
  const existing = state.mangaList?.find(m => m.id === mangaId);
  if (existing) {
    state.currentManga = existing;
    renderMangaDetailHero(existing);
  } else {
    heroContent.innerHTML = `<div class="spinner" style="margin: 3rem auto;"></div>`;
  }
  chaptersList.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;

  try {
    const res = await fetch(`/api/manga/${mangaId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.currentManga = data.data;

    CoverCache.set(data.data.id, getMangaTitle(data.data.attributes), getCoverUrl(data.data));

    renderMangaDetailHero(state.currentManga);
    loadChaptersFeed(mangaId);
  } catch (error) {
    console.error('Failed to load manga detail:', error);
    if (typeof OfflineManager !== 'undefined' && OfflineManager.db?.manga) {
      try {
        const offM = await OfflineManager.db.manga.get(mangaId);
        if (offM) {
          state.currentManga = {
            id: offM.id,
            title: offM.title,
            coverUrl: offM.coverUrl,
            coverBlob: offM.coverBlob,
            attributes: {
              title: { en: offM.title },
              description: { id: offM.synopsis || '' }
            }
          };
          renderMangaDetailHero(state.currentManga);
          return;
        }
      } catch (e) { }
    }
    showToast('Gagal memuat detail manga');
  }
}

function renderMangaDetailHero(manga) {
  const title = getMangaTitle(manga.attributes);
  const coverUrl = getCoverUrl(manga);
  const author = getAuthorName(manga);
  const status = manga.attributes.status ? manga.attributes.status.toUpperCase() : 'UNKNOWN';
  const year = manga.attributes.year || 'N/A';
  const desc = manga.attributes.description?.en || manga.attributes.description?.id || 'Tidak ada deskripsi tersedia.';

  // Tags
  const tags = manga.attributes.tags?.map(t => t.attributes.name.en) || [];

  // Backdrop
  const backdrop = document.getElementById('detail-backdrop');
  backdrop.style.backgroundImage = `url('${coverUrl}')`;

  const hero = document.getElementById('detail-hero-content');
  hero.innerHTML = `
    <div class="detail-poster-col">
      <img src="${coverUrl}" class="detail-poster" alt="${title}">
    </div>
    <div class="detail-info-col">
      <h1 class="detail-title">${title}</h1>
      <div class="detail-meta-row">
        <div class="detail-meta-item">Penulis: <strong>${author}</strong></div>
        <div class="detail-meta-item">Status: <strong class="text-accent">${status}</strong></div>
        <div class="detail-meta-item">Tahun: <strong>${year}</strong></div>
      </div>
      <div class="detail-tags">
        ${tags.map(t => `<span class="detail-tag">${t}</span>`).join('')}
      </div>
      <div class="detail-synopsis">
        <p>${desc}</p>
      </div>
      <div class="detail-actions">
        <button class="btn-primary" id="btn-read-first-chapter">
          <i data-lucide="play"></i>
          <span>Mulai Baca (Chapter 1)</span>
        </button>
        <button class="btn-secondary ${isMangaBookmarked(manga.id) ? 'bookmarked active' : ''}" id="btn-bookmark-manga">
          <i data-lucide="${isMangaBookmarked(manga.id) ? 'bookmark-check' : 'bookmark'}"></i>
          <span>${isMangaBookmarked(manga.id) ? 'Tersimpan di Bookmark' : '+ Bookmark'}</span>
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-bookmark-manga')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const nowBookmarked = toggleBookmark(manga);
    if (nowBookmarked) {
      btn.classList.add('bookmarked', 'active');
      btn.innerHTML = `<i data-lucide="bookmark-check"></i><span>Tersimpan di Bookmark</span>`;
      showToast(`"${title}" berhasil ditambahkan ke Bookmark!`);
    } else {
      btn.classList.remove('bookmarked', 'active');
      btn.innerHTML = `<i data-lucide="bookmark"></i><span>+ Bookmark</span>`;
      showToast(`"${title}" dihapus dari Bookmark.`);
    }
    initIcons();
  });

  document.getElementById('btn-read-first-chapter')?.addEventListener('click', () => {
    if (state.currentChapters.length > 0) {
      // Pick the first chapter
      openReader(state.currentChapters[0].id, 0);
    } else {
      showToast('Tidak ada chapter yang tersedia untuk dibaca.');
    }
  });

  initIcons();
}

// Multi-Source Chapter Feed Controller
function initSourceTabs() {
  const tabMd = document.getElementById('source-tab-mangadex');
  const tabBk = document.getElementById('source-tab-bacakomik');
  const tabEn = document.getElementById('source-tab-english');
  const filtersMd = document.getElementById('mangadex-filters');

  tabMd?.addEventListener('click', () => {
    tabMd.classList.add('active');
    tabBk?.classList.remove('active');
    tabEn?.classList.remove('active');
    if (filtersMd) filtersMd.style.display = 'flex';
    state.currentSource = 'mangadex';
    if (state.currentManga) loadChaptersFeed(state.currentManga.id);
  });

  tabBk?.addEventListener('click', () => {
    tabBk.classList.add('active');
    tabMd?.classList.remove('active');
    tabEn?.classList.remove('active');
    if (filtersMd) filtersMd.style.display = 'none';
    state.currentSource = 'bacakomik';
    if (state.currentManga) loadBacakomikChaptersFeed();
  });

  tabEn?.addEventListener('click', () => {
    tabEn.classList.add('active');
    tabMd?.classList.remove('active');
    tabBk?.classList.remove('active');
    if (filtersMd) filtersMd.style.display = 'none';
    state.currentSource = 'english';
    if (state.currentManga) loadEnglishChaptersFeed();
  });
}

// Dual-Language Pills Controller for MangaDex
function initLanguagePills() {
  const pills = document.querySelectorAll('#mangadex-lang-pills .lang-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.currentLang = pill.dataset.lang || 'all';
      filterAndRenderMangaDexChapters();
    });
  });
}

function filterAndRenderMangaDexChapters() {
  const lang = state.currentLang;
  let filtered = state.allMangaDexChapters || [];
  if (lang === 'id') {
    filtered = state.allMangaDexChapters.filter(c => c.attributes?.translatedLanguage === 'id');
  } else if (lang === 'en') {
    filtered = state.allMangaDexChapters.filter(c => c.attributes?.translatedLanguage === 'en');
  }
  state.currentChapters = filtered;
  renderChaptersList(filtered);
}

// Load Chapters Feed (MangaDex with ID & EN dual support + pagination)
async function loadChaptersFeed(mangaId) {
  // Ensure MangaDex tab is active
  document.getElementById('source-tab-mangadex')?.classList.add('active');
  document.getElementById('source-tab-bacakomik')?.classList.remove('active');
  document.getElementById('source-tab-english')?.classList.remove('active');
  const filtersMd = document.getElementById('mangadex-filters');
  if (filtersMd) filtersMd.style.display = 'flex';

  const sortBtn = document.getElementById('chapter-sort-btn');
  const sort = sortBtn?.dataset.order || 'asc';

  const chaptersContainer = document.getElementById('chapters-list');
  chaptersContainer.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;

  try {
    // Fetch all chapters (both ID and EN) with limit 500 & pagination loop
    const res = await fetch(`/api/manga/${mangaId}/chapters?lang=all&order=${sort}&limit=500`);
    const data = await res.json();
    state.allMangaDexChapters = data.data || [];

    // Calculate language counts
    const totalAll = state.allMangaDexChapters.length;
    const totalId = state.allMangaDexChapters.filter(c => c.attributes?.translatedLanguage === 'id').length;
    const totalEn = state.allMangaDexChapters.filter(c => c.attributes?.translatedLanguage === 'en').length;

    const countAllEl = document.getElementById('count-lang-all');
    const countIdEl = document.getElementById('count-lang-id');
    const countEnEl = document.getElementById('count-lang-en');
    if (countAllEl) countAllEl.textContent = totalAll;
    if (countIdEl) countIdEl.textContent = totalId;
    if (countEnEl) countEnEl.textContent = totalEn;

    filterAndRenderMangaDexChapters();
  } catch (error) {
    console.error('Failed to load chapters:', error);
    chaptersContainer.innerHTML = `<p class="empty-state">Gagal memuat daftar chapter dari server.</p>`;
  }
}

async function loadBacakomikChaptersFeed(customSearchQuery = null) {
  const chaptersContainer = document.getElementById('chapters-list');
  chaptersContainer.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
  const badge = document.getElementById('chapters-total-badge');
  badge.textContent = 'Mencari mirror...';

  let comics = [];
  let matchedQuery = '';

  if (customSearchQuery) {
    try {
      const res = await fetch(`/api/external/search?q=${encodeURIComponent(customSearchQuery)}`);
      const data = await res.json();
      comics = data.data || [];
      matchedQuery = customSearchQuery;
    } catch (e) { }
  } else {
    const attrs = state.currentManga?.attributes;
    const primaryTitle = getMangaTitle(attrs);

    // Gather all candidate titles from primary & altTitles
    const candidates = [primaryTitle];
    if (attrs?.altTitles && Array.isArray(attrs.altTitles)) {
      attrs.altTitles.forEach(at => {
        Object.values(at).forEach(val => {
          if (val && typeof val === 'string' && !candidates.includes(val)) {
            candidates.push(val);
          }
        });
      });
    }

    // Add unhyphenated variants (e.g. "Gye Baek-sun" -> "Gye Baeksun", "Unemployed Gye Baeksun")
    const variants = [];
    candidates.forEach(c => {
      const s1 = c.replace(/[-_:]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!candidates.includes(s1)) variants.push(s1);
      const s2 = c.replace(/[-_:]/g, '').replace(/\s+/g, ' ').trim();
      if (!candidates.includes(s2)) variants.push(s2);
    });
    const allQueries = [...candidates, ...variants];

    // Try candidates sequentially until one returns results
    for (const q of allQueries) {
      try {
        const res = await fetch(`/api/external/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (data.data && data.data.length > 0) {
          comics = data.data;
          matchedQuery = q;
          break;
        }
      } catch (e) { }
    }
  }

  if (comics.length === 0) {
    chaptersContainer.innerHTML = `
      <div class="mirror-search-box">
        <input type="text" id="mirror-search-input" placeholder="Ketik judul di Bacakomik (misal: Unemployed Gye Baeksun)...">
        <button id="btn-mirror-search"><i data-lucide="search"></i> Cari</button>
      </div>
      <div class="empty-state">
        <i data-lucide="search-x"></i>
        <h4>Komik Tidak Ditemukan Otomatis di Bacakomik</h4>
        <p>Ketik judul alternatif pada kotak pencarian di atas untuk mencari manual.</p>
      </div>
    `;
    badge.textContent = '0 Chapter';
    initMirrorSearchHandler();
    initIcons();
    return;
  }

  // Use the best matched comic
  const comic = comics[0];
  try {
    const chRes = await fetch(`/api/external/chapters?url=${encodeURIComponent(comic.url)}`);
    const chData = await chRes.json();
    const chapters = chData.chapters || [];
    badge.textContent = `${chapters.length} Chapter (Mirror)`;

    renderBacakomikChaptersList(chapters, comic, comics);
  } catch (err) {
    console.error('Failed to load bacakomik chapters:', err);
    chaptersContainer.innerHTML = `<p class="empty-state">Gagal memuat chapter dari mirror Bacakomik.</p>`;
    badge.textContent = 'Error';
  }
}

function initMirrorSearchHandler() {
  const input = document.getElementById('mirror-search-input');
  const btn = document.getElementById('btn-mirror-search');

  function doSearch() {
    const q = input?.value.trim();
    if (q) loadBacakomikChaptersFeed(q);
  }

  btn?.addEventListener('click', doSearch);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
}

async function renderBacakomikChaptersList(chapters, activeComic, allMatchedComics = []) {
  const container = document.getElementById('chapters-list');
  if (chapters.length === 0) {
    container.innerHTML = `<p class="empty-state">Tidak ada chapter tersedia di mirror.</p>`;
    return;
  }

  // Parse chapter numbers for proper numerical sorting
  const parsed = chapters.map((c, i) => {
    const numMatch = c.title.match(/chapter\s*([\d.]+)/i) || c.url.match(/chapter-([\d.]+)/i);
    const num = numMatch ? parseFloat(numMatch[1]) : (chapters.length - i);
    return { ...c, num };
  });

  // Sort according to state.mirrorOrder (default 'asc' so Chapter 1 -> 79)
  parsed.sort((a, b) => {
    return state.mirrorOrder === 'asc' ? a.num - b.num : b.num - a.num;
  });

  state.externalChapters = parsed;

  const cleanComicTitle = activeComic.title.replace(/\s+/g, ' ').replace(/^Warna\s*/, '').trim();

  // Query offline downloaded chapters for this mirror comic
  const mangaId = state.currentManga?.id || activeComic.url;
  const downloadedSet = window.OfflineManager
    ? await OfflineManager.getDownloadedChapterIds(mangaId)
    : new Set();

  let html = `
    <div class="mirror-search-box">
      <input type="text" id="mirror-search-input" value="${cleanComicTitle}" placeholder="Cari judul lain di Bacakomik...">
      <button id="btn-mirror-search"><i data-lucide="search"></i> Cari</button>
      <button id="btn-mirror-sort" class="btn-ghost" style="white-space: nowrap; font-size: 0.85rem; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.05); color: var(--text-primary); cursor: pointer; display: flex; align-items: center; gap: 0.4rem;">
        <i data-lucide="arrow-down-up"></i> <span>${state.mirrorOrder === 'asc' ? 'Chapter 1 → Akhir' : 'Terbaru → Awal'}</span>
      </button>
    </div>
  `;

  // If multiple comics matched, show switch chips
  if (allMatchedComics.length > 1) {
    html += `
      <div class="mirror-matches-row">
        <span class="quick-tag-label">Pilih Judul Cocok:</span>
        ${allMatchedComics.map((c, i) => {
      const t = c.title.replace(/\s+/g, ' ').replace(/^Warna\s*/, '').trim();
      const isAct = c.url === activeComic.url;
      return `<button class="quick-tag-chip ${isAct ? 'active' : ''}" data-url="${c.url}">${t}</button>`;
    }).join('')}
      </div>
    `;
  }

  html += `<div class="mirror-chapters-grid">`;
  parsed.forEach((ch, idx) => {
    const cleanChTitle = ch.title.replace(/\s+/g, ' ').trim();
    const isDownloaded = downloadedSet.has(ch.url);
    html += `
      <div class="chapter-item" data-ch-idx="${idx}">
        <div class="chapter-item-left">
          <span class="chapter-number-pill">${cleanChTitle}</span>
          <span class="chapter-group-badge" style="color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">🇮🇩 Indo Mirror</span>
        </div>
        <div class="chapter-item-right">
          ${isDownloaded ? `
            <span class="badge-downloaded-success" title="Chapter tersimpan di penyimpanan offline browser">
              <i data-lucide="check-circle-2"></i> Tersimpan
            </span>
            <button class="btn-delete-download" title="Hapus dari penyimpanan offline" data-ch-url="${ch.url}">
              <i data-lucide="trash-2"></i>
            </button>
          ` : `
            <button class="btn-ch-download" title="Download Chapter ini ke memori offline" data-ch-idx="${idx}">
              <i data-lucide="download"></i>
            </button>
          `}
          <span>Baca Chapter</span>
          <i data-lucide="chevron-right"></i>
        </div>
      </div>
    `;
  });
  html += `</div>`;

  container.innerHTML = html;

  initMirrorSearchHandler();

  // Sort button toggle
  document.getElementById('btn-mirror-sort')?.addEventListener('click', () => {
    state.mirrorOrder = state.mirrorOrder === 'asc' ? 'desc' : 'asc';
    renderBacakomikChaptersList(chapters, activeComic, allMatchedComics);
  });

  // Chips click handler
  container.querySelectorAll('.mirror-matches-row .quick-tag-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const u = chip.dataset.url;
      container.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
      try {
        const res = await fetch(`/api/external/chapters?url=${encodeURIComponent(u)}`);
        const data = await res.json();
        renderBacakomikChaptersList(data.chapters || [], { title: chip.textContent, url: u }, allMatchedComics);
      } catch (e) { }
    });
  });

  // Chapters click handler
  container.querySelectorAll('.mirror-chapters-grid .chapter-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-ch-download') || e.target.closest('.btn-delete-download')) return;
      const idx = parseInt(item.dataset.chIdx);
      const ch = parsed[idx];
      openExternalReader(ch.url, ch.title.replace(/\s+/g, ' ').trim(), parsed, idx);
    });

    // Single chapter download button
    item.querySelector('.btn-ch-download')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(item.dataset.chIdx);
      const ch = parsed[idx];
      if (!window.OfflineManager) return;

      const mangaObj = {
        id: mangaId,
        title: state.currentManga ? getMangaTitle(state.currentManga.attributes) : activeComic.title,
        coverUrl: state.currentManga ? getCoverUrl(state.currentManga) : (activeComic.thumb || ''),
        synopsis: state.currentManga?.attributes?.description?.id || state.currentManga?.attributes?.description?.en || ''
      };

      OfflineManager.enqueueChapter(
        mangaObj,
        {
          id: ch.url,
          url: ch.url,
          number: ch.num,
          title: ch.title.replace(/\s+/g, ' ').trim()
        },
        'bacakomik'
      );
    });

    // Single chapter delete button
    item.querySelector('.btn-delete-download')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const chUrl = e.currentTarget.dataset.chUrl;
      if (!window.OfflineManager || !chUrl) return;
      await OfflineManager.deleteChapter(chUrl);
      renderBacakomikChaptersList(chapters, activeComic, allMatchedComics);
    });
  });

  initIcons();
}

/**
 * Modern Custom Chapter Selector Dropdown Helper
 */
function updateCustomChapterDropdown(items, currentVal, onSelect) {
  const triggerLabel = document.getElementById('custom-chapter-label');
  const listEl = document.getElementById('custom-chapter-list');
  const panel = document.getElementById('custom-chapter-panel');
  const searchInput = document.getElementById('dropdown-chapter-search');
  const selectFallback = document.getElementById('reader-chapter-select');

  if (selectFallback) {
    selectFallback.innerHTML = '';
    items.forEach(it => {
      const opt = document.createElement('option');
      opt.value = it.value;
      opt.textContent = it.label;
      if (it.value === currentVal) opt.selected = true;
      selectFallback.appendChild(opt);
    });
  }

  const currentItem = items.find(it => it.value === currentVal) || items[0];
  if (triggerLabel) {
    triggerLabel.textContent = currentItem ? currentItem.label : 'Pilih Chapter...';
  }

  const renderDropdownList = (filterQuery = '') => {
    if (!listEl) return;
    listEl.innerHTML = '';
    const q = filterQuery.toLowerCase().trim();
    const filtered = items.filter(it => it.label.toLowerCase().includes(q));

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.8rem;">Chapter tidak ditemukan</div>`;
      return;
    }

    filtered.forEach(it => {
      const el = document.createElement('div');
      const isActive = it.value === currentVal;
      el.className = `custom-dropdown-item ${isActive ? 'active' : ''}`;
      const langTag = it.lang ? `<span class="custom-item-tag ${it.lang}">${it.lang.toUpperCase()}</span>` : '';
      el.innerHTML = `
        <div class="custom-item-left">
          <i data-lucide="${isActive ? 'check' : 'book-open'}" style="width: 14px; height: 14px;"></i>
          <span class="custom-item-title">${it.label}</span>
        </div>
        ${langTag}
      `;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        panel?.classList.add('hidden');
        document.getElementById('custom-chapter-dropdown')?.classList.remove('open');
        onSelect(it.value);
      });
      listEl.appendChild(el);
    });
    initIcons();
  };

  renderDropdownList();

  if (searchInput) {
    searchInput.value = '';
    searchInput.oninput = (e) => {
      renderDropdownList(e.target.value);
    };
  }
}

async function openExternalReader(chapterUrl, chapterTitle, allChapters, chapterIndex) {
  state.currentPageIndex = 0;
  state.isExternal = true;
  state.currentSource = 'bacakomik';
  state.externalChapters = allChapters;
  state.currentChapterIndex = chapterIndex;
  state.allMangaDexChapters = []; // Prevent cross-manga navigation leak
  switchView('reader');

  const viewport = document.getElementById('reader-viewport');
  viewport.innerHTML = `
    <div class="reader-loading" id="reader-loading">
      <div class="spinner"></div>
      <p>Mengambil halaman chapter dari mirror Bacakomik...</p>
    </div>
  `;

  const mangaTitle = getMangaTitle(state.currentManga?.attributes);
  document.getElementById('reader-manga-title').textContent = mangaTitle;
  document.getElementById('reader-chapter-title').textContent = chapterTitle;
  const footerPill = document.getElementById('footer-chapter-pill');
  if (footerPill) footerPill.textContent = chapterTitle;

  // Ensure bars are visible when opening mirror chapter
  document.getElementById('reader-toolbar')?.classList.remove('hidden-bar');
  document.getElementById('reader-footer')?.classList.remove('hidden-bar');

  // Populate Custom Chapter Dropdown
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

  // Offline-First Check: If chapter is already downloaded in IndexedDB, load blobs instantly with 0 lag!
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
    const res = await fetch(`/api/external/chapter-pages?url=${encodeURIComponent(chapterUrl)}`);
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
    console.error('Failed to load mirror chapter pages:', err);
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

// ==========================================
// ENGLISH MIRROR (Mangapill / WeebCentral)
// ==========================================

async function loadEnglishChaptersFeed(customSearchQuery = null) {
  const chaptersContainer = document.getElementById('chapters-list');
  chaptersContainer.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
  const badge = document.getElementById('chapters-total-badge');
  badge.textContent = 'Mencari mirror EN...';

  let comics = [];
  let matchedQuery = '';

  if (customSearchQuery) {
    try {
      const res = await fetch(`/api/external/en/search?q=${encodeURIComponent(customSearchQuery)}`);
      const data = await res.json();
      comics = data.data || [];
      matchedQuery = customSearchQuery;
    } catch (e) { }
  } else {
    const attrs = state.currentManga?.attributes;
    const primaryTitle = getMangaTitle(attrs);

    // Gather all candidate titles with English priority
    const candidates = [primaryTitle];
    if (attrs?.altTitles && Array.isArray(attrs.altTitles)) {
      attrs.altTitles.forEach(at => {
        Object.values(at).forEach(val => {
          if (val && typeof val === 'string' && !candidates.includes(val)) {
            candidates.push(val);
          }
        });
      });
    }

    const variants = [];
    candidates.forEach(c => {
      const s1 = c.replace(/[-_:]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!candidates.includes(s1)) variants.push(s1);
      const s2 = c.replace(/[-_:]/g, '').replace(/\s+/g, ' ').trim();
      if (!candidates.includes(s2)) variants.push(s2);
    });
    const allQueries = [...candidates, ...variants];

    for (const q of allQueries) {
      try {
        const res = await fetch(`/api/external/en/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (data.data && data.data.length > 0) {
          comics = data.data;
          matchedQuery = q;
          break;
        }
      } catch (e) { }
    }
  }

  if (comics.length === 0) {
    chaptersContainer.innerHTML = `
      <div class="mirror-search-box">
        <input type="text" id="en-mirror-search-input" placeholder="Ketik judul manga versi Inggris...">
        <button id="btn-en-mirror-search"><i data-lucide="search"></i> Cari</button>
      </div>
      <div class="empty-state">
        <i data-lucide="search-x"></i>
        <h4>Komik Tidak Ditemukan di English Mirror</h4>
        <p>Ketik judul alternatif pada kotak pencarian di atas untuk mencari manual.</p>
      </div>
    `;
    badge.textContent = '0 Chapter';
    initEnglishMirrorSearchHandler();
    initIcons();
    return;
  }

  const comic = comics[0];
  try {
    const chRes = await fetch(`/api/external/en/chapters?url=${encodeURIComponent(comic.url)}`);
    const chData = await chRes.json();
    const chapters = chData.chapters || [];
    badge.textContent = `${chapters.length} Chapter (EN Mirror)`;

    renderEnglishChaptersList(chapters, comic, comics);
  } catch (err) {
    console.error('Failed to load English mirror chapters:', err);
    chaptersContainer.innerHTML = `<p class="empty-state">Gagal memuat chapter dari English mirror.</p>`;
    badge.textContent = 'Error';
  }
}

function initEnglishMirrorSearchHandler() {
  const input = document.getElementById('en-mirror-search-input');
  const btn = document.getElementById('btn-en-mirror-search');

  function doSearch() {
    const q = input?.value.trim();
    if (q) loadEnglishChaptersFeed(q);
  }

  btn?.addEventListener('click', doSearch);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
}

async function renderEnglishChaptersList(chapters, activeComic, allMatchedComics = []) {
  const container = document.getElementById('chapters-list');
  if (chapters.length === 0) {
    container.innerHTML = `<p class="empty-state">Tidak ada chapter tersedia di English mirror.</p>`;
    return;
  }

  const parsed = chapters.map((c, i) => {
    const numMatch = c.title.match(/chapter\s*([\d.]+)/i) || c.url.match(/chapter-([\d.]+)/i);
    const num = numMatch ? parseFloat(numMatch[1]) : (chapters.length - i);
    return { ...c, num };
  });

  parsed.sort((a, b) => {
    return state.englishOrder === 'asc' ? a.num - b.num : b.num - a.num;
  });

  state.englishChapters = parsed;

  const cleanComicTitle = activeComic.title.replace(/\s+/g, ' ').trim();
  const mangaId = state.currentManga?.id || activeComic.url;
  const downloadedSet = window.OfflineManager
    ? await OfflineManager.getDownloadedChapterIds(mangaId)
    : new Set();

  let html = `
    <div class="mirror-search-box">
      <input type="text" id="en-mirror-search-input" value="${cleanComicTitle}" placeholder="Cari judul lain di English Mirror...">
      <button id="btn-en-mirror-search"><i data-lucide="search"></i> Cari</button>
      <button id="btn-en-mirror-sort" class="btn-ghost" style="white-space: nowrap; font-size: 0.85rem; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.05); color: var(--text-primary); cursor: pointer; display: flex; align-items: center; gap: 0.4rem;">
        <i data-lucide="arrow-down-up"></i> <span>${state.englishOrder === 'asc' ? 'Chapter 1 → Akhir' : 'Terbaru → Awal'}</span>
      </button>
    </div>
  `;

  if (allMatchedComics.length > 1) {
    html += `
      <div class="mirror-matches-row">
        <span class="quick-tag-label">Pilih Judul Cocok:</span>
        ${allMatchedComics.map(c => {
      const t = c.title.replace(/\s+/g, ' ').trim();
      const isAct = c.url === activeComic.url;
      return `<button class="quick-tag-chip ${isAct ? 'active' : ''}" data-url="${c.url}">${t}</button>`;
    }).join('')}
      </div>
    `;
  }

  html += `<div class="mirror-chapters-grid">`;
  parsed.forEach((ch, idx) => {
    const cleanChTitle = ch.title.replace(/\s+/g, ' ').trim();
    const isDownloaded = downloadedSet.has(ch.url);
    html += `
      <div class="chapter-item" data-ch-idx="${idx}">
        <div class="chapter-item-left">
          <span class="chapter-number-pill">${cleanChTitle}</span>
          <span class="chapter-lang-badge badge-lang-en">🇬🇧 EN Mirror</span>
        </div>
        <div class="chapter-item-right">
          ${isDownloaded ? `
            <span class="badge-downloaded-success" title="Chapter tersimpan di penyimpanan offline browser">
              <i data-lucide="check-circle-2"></i> Tersimpan
            </span>
            <button class="btn-delete-download" title="Hapus dari penyimpanan offline" data-ch-url="${ch.url}">
              <i data-lucide="trash-2"></i>
            </button>
          ` : `
            <button class="btn-ch-download" title="Download Chapter ini ke memori offline" data-ch-idx="${idx}">
              <i data-lucide="download"></i>
            </button>
          `}
          <span>Baca Chapter</span>
          <i data-lucide="chevron-right"></i>
        </div>
      </div>
    `;
  });
  html += `</div>`;

  container.innerHTML = html;
  initEnglishMirrorSearchHandler();

  document.getElementById('btn-en-mirror-sort')?.addEventListener('click', () => {
    state.englishOrder = state.englishOrder === 'asc' ? 'desc' : 'asc';
    renderEnglishChaptersList(chapters, activeComic, allMatchedComics);
  });

  container.querySelectorAll('.mirror-matches-row .quick-tag-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const u = chip.dataset.url;
      container.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
      try {
        const res = await fetch(`/api/external/en/chapters?url=${encodeURIComponent(u)}`);
        const data = await res.json();
        renderEnglishChaptersList(data.chapters || [], { title: chip.textContent, url: u }, allMatchedComics);
      } catch (e) { }
    });
  });

  container.querySelectorAll('.mirror-chapters-grid .chapter-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-ch-download') || e.target.closest('.btn-delete-download')) return;
      const idx = parseInt(item.dataset.chIdx);
      const ch = parsed[idx];
      openEnglishReader(ch.url, ch.title.replace(/\s+/g, ' ').trim(), parsed, idx);
    });

    item.querySelector('.btn-ch-download')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(item.dataset.chIdx);
      const ch = parsed[idx];
      if (!window.OfflineManager) return;

      const mangaObj = {
        id: mangaId,
        title: state.currentManga ? getMangaTitle(state.currentManga.attributes) : activeComic.title,
        coverUrl: state.currentManga ? getCoverUrl(state.currentManga) : (activeComic.thumb || ''),
        synopsis: state.currentManga?.attributes?.description?.en || state.currentManga?.attributes?.description?.id || ''
      };

      OfflineManager.enqueueChapter(
        mangaObj,
        {
          id: ch.url,
          url: ch.url,
          number: ch.num,
          title: ch.title.replace(/\s+/g, ' ').trim()
        },
        'english'
      );
    });

    item.querySelector('.btn-delete-download')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const chUrl = e.currentTarget.dataset.chUrl;
      if (!window.OfflineManager || !chUrl) return;
      await OfflineManager.deleteChapter(chUrl);
      renderEnglishChaptersList(chapters, activeComic, allMatchedComics);
    });
  });

  initIcons();
}

async function openEnglishReader(chapterUrl, chapterTitle, allChapters, chapterIndex) {
  state.currentPageIndex = 0;
  state.isExternal = true;
  state.currentSource = 'english';
  state.englishChapters = allChapters;
  state.currentChapterIndex = chapterIndex;
  state.allMangaDexChapters = []; // Prevent cross-manga navigation leak
  switchView('reader');

  const viewport = document.getElementById('reader-viewport');
  viewport.innerHTML = `
    <div class="reader-loading" id="reader-loading">
      <div class="spinner"></div>
      <p>Mengambil halaman chapter dari English mirror...</p>
    </div>
  `;

  const mangaTitle = getMangaTitle(state.currentManga?.attributes);
  document.getElementById('reader-manga-title').textContent = mangaTitle;
  document.getElementById('reader-chapter-title').textContent = chapterTitle;
  const footerPill = document.getElementById('footer-chapter-pill');
  if (footerPill) footerPill.textContent = chapterTitle;

  document.getElementById('reader-toolbar')?.classList.remove('hidden-bar');
  document.getElementById('reader-footer')?.classList.remove('hidden-bar');

  // Populate Custom Chapter Dropdown
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

  // Offline-First Check
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

// Chapter sort listeners
document.getElementById('chapter-sort-btn')?.addEventListener('click', () => {
  const btn = document.getElementById('chapter-sort-btn');
  const label = document.getElementById('chapter-sort-label');
  const newOrder = btn.dataset.order === 'asc' ? 'desc' : 'asc';
  btn.dataset.order = newOrder;
  label.textContent = newOrder === 'asc' ? 'Chapter 1 → Akhir' : 'Terbaru → Awal';

  if (state.allMangaDexChapters && state.allMangaDexChapters.length > 0) {
    state.allMangaDexChapters.reverse();
    filterAndRenderMangaDexChapters();
  } else if (state.currentManga) {
    loadChaptersFeed(state.currentManga.id);
  }
});

async function renderChaptersList(chapters) {
  const container = document.getElementById('chapters-list');
  document.getElementById('chapters-total-badge').textContent = `${chapters.length} Chapter`;

  if (chapters.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="folder-x"></i>
        <h4>Belum Ada Chapter untuk Filter Ini</h4>
        <p>Coba pilih tab filter bahasa "Semua", "🇮🇩 ID", atau "🇬🇧 EN".</p>
      </div>
    `;
    initIcons();
    return;
  }

  // Check offline storage for already downloaded chapters
  const downloadedSet = window.OfflineManager
    ? await OfflineManager.getDownloadedChapterIds(state.currentManga?.id)
    : new Set();

  container.innerHTML = '';
  chapters.forEach((ch, idx) => {
    const chNum = ch.attributes?.chapter ? `Chapter ${ch.attributes.chapter}` : 'Oneshot / Extra';
    const chTitle = ch.attributes?.title ? `: ${ch.attributes.title}` : '';
    const lang = ch.attributes?.translatedLanguage || 'en';
    const isId = lang === 'id';
    const langFlag = isId ? '🇮🇩 ID' : '🇬🇧 EN';
    const langClass = isId ? 'badge-lang-id' : 'badge-lang-en';

    // Scanlation Group
    const groupRel = ch.relationships?.find(r => r.type === 'scanlation_group');
    const groupName = ch.attributes?.scanlationGroup || groupRel?.attributes?.name || 'MangaDex';

    const isDownloaded = downloadedSet.has(ch.id);

    const item = document.createElement('div');
    item.className = 'chapter-item';
    item.innerHTML = `
      <div class="chapter-item-left">
        <span class="chapter-number-pill">${chNum}</span>
        <span class="chapter-lang-badge ${langClass}">${langFlag}</span>
        <span class="chapter-title-text">${chTitle}</span>
        <span class="chapter-group-badge" title="Grup Scanlation">${groupName}</span>
      </div>
      <div class="chapter-item-right">
        ${isDownloaded ? `
          <span class="badge-downloaded-success" title="Chapter tersimpan di penyimpanan offline browser">
            <i data-lucide="check-circle-2"></i> Tersimpan
          </span>
          <button class="btn-delete-download" title="Hapus dari penyimpanan offline" data-ch-id="${ch.id}">
            <i data-lucide="trash-2"></i>
          </button>
        ` : `
          <button class="btn-ch-download" title="Download Chapter ini ke memori offline" data-ch-idx="${idx}">
            <i data-lucide="download"></i>
          </button>
        `}
        <i data-lucide="chevron-right"></i>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-ch-download') || e.target.closest('.btn-delete-download')) return;
      state.currentReadingLang = lang;
      openReader(ch.id, idx);
    });

    // Single chapter download button
    item.querySelector('.btn-ch-download')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!window.OfflineManager || !state.currentManga) return;
      OfflineManager.enqueueChapter(
        {
          id: state.currentManga.id,
          title: getMangaTitle(state.currentManga.attributes),
          coverUrl: getCoverUrl(state.currentManga),
          synopsis: state.currentManga.attributes?.description?.id || state.currentManga.attributes?.description?.en || ''
        },
        {
          id: ch.id,
          number: ch.attributes?.chapter || (idx + 1),
          title: `${chNum}${chTitle}`
        },
        'mangadex'
      );
    });

    // Single chapter delete button
    item.querySelector('.btn-delete-download')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const chId = e.currentTarget.dataset.chId;
      if (!window.OfflineManager || !chId) return;
      await OfflineManager.deleteChapter(chId);
      renderChaptersList(state.currentChapters);
    });

    container.appendChild(item);
  });

  initIcons();
}

// ==========================================
// VIEW 3: THE MANGA READER ENGINE
// ==========================================

async function openReader(chapterId, chapterIndex) {
  state.isExternal = false;
  state.currentChapterId = chapterId;
  state.currentChapterIndex = chapterIndex;
  state.currentPageIndex = 0;
  state.currentSingleSlice = 0;
  state.isAutoNavigatingNext = false;

  switchView('reader');

  const readerContainer = document.getElementById('view-reader');
  if (readerContainer) readerContainer.scrollTop = 0;
  window.scrollTo(0, 0);

  const viewport = document.getElementById('reader-viewport');
  viewport.innerHTML = `
    <div class="reader-loading" id="reader-loading">
      <div class="spinner"></div>
      <p>Mengambil halaman chapter...</p>
    </div>
  `;

  // Update Toolbar & Floating Footer titles
  const mangaTitle = getMangaTitle(state.currentManga?.attributes);
  const chObj = state.currentChapters[chapterIndex] || state.allMangaDexChapters.find(c => c.id === chapterId);
  const chNum = chObj?.attributes?.chapter ? `Chapter ${chObj.attributes.chapter}` : 'Special Chapter';
  if (chObj?.attributes?.translatedLanguage) {
    state.currentReadingLang = chObj.attributes.translatedLanguage;
  }

  document.getElementById('reader-manga-title').textContent = mangaTitle;
  document.getElementById('reader-chapter-title').textContent = chNum;
  const footerPill = document.getElementById('footer-chapter-pill');
  if (footerPill) footerPill.textContent = chNum;

  // Ensure bars are visible when opening new chapter
  document.getElementById('reader-toolbar')?.classList.remove('hidden-bar');
  document.getElementById('reader-footer')?.classList.remove('hidden-bar');

  // Populate Custom Chapter Dropdown in reader
  const dropItems = state.currentChapters.map((ch, idx) => {
    const lFlag = ch.attributes?.translatedLanguage === 'id' ? 'id' : 'en';
    const lText = ch.attributes?.translatedLanguage === 'id' ? '[ID]' : '[EN]';
    return {
      value: ch.id,
      label: `Chapter ${ch.attributes?.chapter || idx + 1} ${lText} ${ch.attributes?.title ? '- ' + ch.attributes.title : ''}`,
      lang: lFlag
    };
  });
  updateCustomChapterDropdown(dropItems, chapterId, (val) => {
    const newIdx = state.currentChapters.findIndex(c => c.id === val);
    if (newIdx !== -1) {
      openReader(val, newIdx);
    }
  });

  // Offline-First Check: If chapter is already downloaded in IndexedDB, load blobs instantly with 0 lag!
  if (window.OfflineManager) {
    const isDown = await OfflineManager.isChapterDownloaded(chapterId);
    const offlineBadge = document.getElementById('reader-offline-badge');

    if (isDown) {
      if (offlineBadge) offlineBadge.classList.remove('hidden');
      const offlinePages = await OfflineManager.getOfflinePages(chapterId);

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
    } else {
      if (offlineBadge) offlineBadge.classList.add('hidden');
    }
  }

  try {
    const res = await fetch(`/api/chapter/${chapterId}`);
    const data = await res.json();
    state.currentChapterData = data;

    renderReaderPages(data);

    // Save reading progress to local storage
    saveReadingHistory(state.currentManga, chObj);
  } catch (err) {
    console.error('Failed to load chapter pages:', err);
    viewport.innerHTML = `
      <div class="empty-state">
        <i data-lucide="alert-triangle"></i>
        <h3>Gagal Memuat Halaman Chapter</h3>
        <p>Server sedang sibuk atau sesi telah berakhir. Silakan coba lagi.</p>
        <button class="btn-primary" onclick="openReader('${chapterId}', ${chapterIndex})">Coba Lagi</button>
      </div>
    `;
    initIcons();
  }
}

function renderReaderPages(data) {
  const viewport = document.getElementById('reader-viewport');
  viewport.innerHTML = '';

  const readerContainer = document.getElementById('view-reader');
  if (readerContainer) {
    readerContainer.scrollTop = 0;
  }
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    if (readerContainer) readerContainer.scrollTop = 0;
  });

  const pages = state.readerQuality === 'dataSaver' ? data.dataSaverPages : data.pages;
  const total = pages.length;

  document.getElementById('page-counter-text').textContent = `1 / ${total}`;

  if (state.readerMode === 'long-strip') {
    viewport.className = 'reader-viewport long-strip-mode';

    pages.forEach((pageUrl, idx) => {
      const pageWrap = document.createElement('div');
      pageWrap.className = 'reader-page-wrapper';
      pageWrap.dataset.page = idx + 1;
      pageWrap.innerHTML = `
        <img src="${pageUrl}" class="reader-page-img" alt="Halaman ${idx + 1}" loading="${idx < 3 ? 'eager' : 'lazy'}">
        <span class="reader-page-number">${idx + 1} / ${total}</span>
      `;
      viewport.appendChild(pageWrap);
    });

    // Append Webtoon Chapter End Card with Auto-Next trigger
    const endCard = document.createElement('div');
    endCard.className = 'webtoon-chapter-end-card';
    endCard.id = 'webtoon-end-card';
    const chTitleText = document.getElementById('reader-chapter-title')?.textContent || 'Chapter ini';
    const nextCandidate = findSmartNextChapter();

    endCard.innerHTML = `
      <div class="end-card-icon"><i data-lucide="check-circle-2"></i></div>
      <span class="end-card-badge">Akhir Chapter</span>
      <h4 class="end-card-title">${chTitleText} Telah Selesai</h4>
      <p class="end-card-sub" id="end-card-sub-text">${nextCandidate ? 'Scroll ke ujung bawah untuk lanjut otomatis ke chapter berikutnya...' : 'Ini adalah chapter terakhir yang tersedia saat ini.'}</p>
      ${nextCandidate ? `
        <div class="end-card-progress"><div class="end-card-progress-bar" id="end-card-progress-bar"></div></div>
        <button class="btn-primary btn-auto-next" id="btn-end-card-next">
          <span>Buka Chapter Berikutnya</span>
          <i data-lucide="arrow-right"></i>
        </button>
      ` : ''}
    `;

    endCard.querySelector('#btn-end-card-next')?.addEventListener('click', () => {
      document.getElementById('btn-next-chapter')?.click();
    });

    viewport.appendChild(endCard);

    // Intersection Observer to update page counter on scroll
    initScrollPageObserver();

  } else if (state.readerMode === 'single') {
    viewport.className = 'reader-viewport single-mode';
    renderSinglePage(pages, state.currentPageIndex, state.currentSingleSlice || 0);
  } else if (state.readerMode === 'double') {
    viewport.className = 'reader-viewport double-mode';
    renderDoublePage(pages, state.currentPageIndex);
  }

  // Update Footer buttons
  updateReaderNavButtons();
  initIcons();
}

function renderSinglePage(pages, index, sliceIndex = 0) {
  const viewport = document.getElementById('reader-viewport');
  const total = pages.length;
  state.currentPageIndex = Math.max(0, Math.min(index, total - 1));
  state.currentSingleSlice = sliceIndex || 0;

  const currentUrl = pages[state.currentPageIndex];

  // Inspect image dimensions to check if it's a tall strip (webtoon)
  const testImg = new Image();
  testImg.src = currentUrl;

  const renderContent = () => {
    const isLongStrip = testImg.naturalWidth > 0 && (testImg.naturalHeight / testImg.naturalWidth) > 1.6;

    if (isLongStrip) {
      // Slicing parameters for tall webtoon images into standard reading height
      const sliceRatio = 1.35;
      const totalSlices = Math.max(2, Math.round(testImg.naturalHeight / (testImg.naturalWidth * sliceRatio)));

      if (state.currentSingleSlice >= totalSlices) {
        state.currentSingleSlice = totalSlices - 1;
      }
      const currSlice = state.currentSingleSlice;

      document.getElementById('page-counter-text').textContent = `${state.currentPageIndex + 1} (${currSlice + 1}/${totalSlices}) / ${total}`;

      // Calculate vertical offset percentage for slice
      const offsetPercent = totalSlices > 1 ? (currSlice / totalSlices) * 100 : 0;

      viewport.innerHTML = `
        <div class="single-page-container">
          <div class="nav-click-zone left" title="Panel Sebelumnya (↑ / W)"></div>
          <div class="slice-indicator-badge">Panel ${currSlice + 1} / ${totalSlices}</div>
          <div class="single-page-slice-window">
            <img src="${currentUrl}" class="single-page-slice-img" style="transform: translateY(-${offsetPercent}%);" alt="Halaman ${state.currentPageIndex + 1} Panel ${currSlice + 1}">
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
      // Standard book-format Manga page
      document.getElementById('page-counter-text').textContent = `${state.currentPageIndex + 1} / ${total}`;

      viewport.innerHTML = `
        <div class="single-page-container">
          <div class="nav-click-zone left" title="Halaman Sebelumnya (↑ / W)"></div>
          <img src="${currentUrl}" class="single-page-img" alt="Halaman ${state.currentPageIndex + 1}">
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
        <div class="nav-click-zone left"></div>
        <img src="${currentUrl}" class="single-page-img" alt="Halaman ${state.currentPageIndex + 1}">
        <div class="nav-click-zone right"></div>
      </div>
    `;
  }
}

function renderDoublePage(pages, index) {
  const viewport = document.getElementById('reader-viewport');
  const total = pages.length;
  state.currentPageIndex = Math.max(0, Math.min(index, total - 1));

  const page1Index = state.currentPageIndex;
  const page2Index = page1Index + 1 < total ? page1Index + 1 : null;

  if (page2Index !== null) {
    document.getElementById('page-counter-text').textContent = `${page1Index + 1}-${page2Index + 1} / ${total}`;
  } else {
    document.getElementById('page-counter-text').textContent = `${page1Index + 1} / ${total}`;
  }

  const page1Url = pages[page1Index];
  const page2Url = page2Index !== null ? pages[page2Index] : null;

  viewport.innerHTML = `
    <div class="double-page-container">
      <div class="nav-click-zone left" title="2 Halaman Sebelumnya"></div>
      <div class="double-pages-wrap">
        <div class="double-page-item left">
          <img src="${page1Url}" class="double-page-img" alt="Halaman ${page1Index + 1}">
          <span class="double-page-tag">${page1Index + 1}</span>
        </div>
        ${page2Url ? `
          <div class="double-page-item right">
            <img src="${page2Url}" class="double-page-img" alt="Halaman ${page2Index + 1}">
            <span class="double-page-tag">${page2Index + 1}</span>
          </div>
        ` : ''}
      </div>
      <div class="nav-click-zone right" title="2 Halaman Selanjutnya"></div>
    </div>
  `;

  // Left click zone: go back 2 pages
  viewport.querySelector('.nav-click-zone.left')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.currentPageIndex > 0) {
      state.currentPageIndex = Math.max(0, state.currentPageIndex - 2);
      renderDoublePage(pages, state.currentPageIndex);
    } else {
      advanceToPrevChapter();
    }
  });

  // Right click zone: advance 2 pages
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

function initScrollPageObserver() {
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
          document.getElementById('page-counter-text').textContent = `${pageNum} / ${total}`;
        }
      }
    }, { threshold: [0.1, 0.3, 0.5] });

    pages.forEach(p => observer.observe(p));
  }
}

// Smart Dual-Language Reader Navigation
function findSmartNextChapter() {
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

  // MangaDex Smart Fallback Navigation
  const currentCh = state.currentChapters[state.currentChapterIndex] || state.allMangaDexChapters.find(c => c.id === state.currentChapterId);
  if (!currentCh) return null;

  // Strict Scoping: ensure pool belongs to current manga
  const pool = (state.allMangaDexChapters && state.allMangaDexChapters.length > 0) ? state.allMangaDexChapters : state.currentChapters;

  const currentLang = currentCh.attributes?.translatedLanguage || state.currentReadingLang || 'id';
  const currentNum = parseFloat(currentCh.attributes?.chapter);

  if (!isNaN(currentNum)) {
    // 1. Prioritize next chapter with SAME language (num > currentNum)
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

    // 2. Fallback to English
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

  // Sequential index fallback
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

function findSmartPrevChapter() {
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
    // 1. Prioritize prev chapter in same language (num < currentNum)
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

    // 2. Fallback to English if currently Indonesian
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

  // Sequential index fallback
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

function advanceToNextChapter() {
  const next = findSmartNextChapter();
  if (!next) return;

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

function advanceToPrevChapter() {
  const prev = findSmartPrevChapter();
  if (!prev) return;

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

function handleReaderNext() {
  if (state.readerMode === 'single' || state.readerMode === 'double') {
    const rightZone = document.querySelector('.nav-click-zone.right');
    if (rightZone) {
      rightZone.click();
      return;
    }
  }
  advanceToNextChapter();
}

function handleReaderPrev() {
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

function updateReaderNavButtons() {
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

    // Previous Button
    if (prevBtn) {
      prevBtn.disabled = isAtStart && !hasPrevChapter;
      prevBtn.style.opacity = (isAtStart && !hasPrevChapter) ? '0.35' : '1';
      if (prevText) {
        prevText.textContent = isAtStart ? 'Chapter Sblm' : 'Hal Sblm';
      }
    }

    // Next Button
    if (nextBtn) {
      nextBtn.disabled = isAtEnd && !hasNextChapter;
      nextBtn.style.opacity = (isAtEnd && !hasNextChapter) ? '0.35' : '1';
      if (nextText) {
        nextText.textContent = isAtEnd ? 'Chapter Lanjut' : 'Hal Lanjut';
      }
    }

    // Footer Info Pill
    if (footerPill) {
      const chLabel = state.currentChapterData?.title || 'Chapter';
      footerPill.textContent = `${state.currentPageIndex + 1}/${totalPages} (${chLabel})`;
    }
  } else {
    // Webtoon Mode
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

function initReaderControls() {
  // Back from reader
  document.getElementById('reader-btn-back')?.addEventListener('click', () => {
    switchView('detail');
  });

  // Custom Chapter Dropdown Trigger & Outside-click handling
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

  // 3-Dots Reader Settings & Mode Dropdown
  const moreBtn = document.getElementById('reader-more-btn');
  const moreMenu = document.getElementById('reader-more-menu');

  moreBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    moreMenu?.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#reader-more-dropdown-wrap')) {
      moreMenu?.classList.add('hidden');
    }
  });

  // Mode Options inside 3-dots Menu
  document.querySelectorAll('.reader-mode-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      document.querySelectorAll('.reader-mode-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.readerMode = mode;
      moreMenu?.classList.add('hidden');
      if (state.currentChapterData) {
        renderReaderPages(state.currentChapterData);
      }
      updateReaderNavButtons();
      initIcons();
    });
  });

  // Quality Toggle inside 3-dots Menu
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

  // Fullscreen Toggle inside 3-dots Menu
  document.getElementById('menu-fullscreen-toggle')?.addEventListener('click', () => {
    moreMenu?.classList.add('hidden');
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  });

  // Previous & Next Chapter Footer buttons with Smart Fallback
  document.getElementById('btn-prev-chapter')?.addEventListener('click', () => {
    handleReaderPrev();
  });

  document.getElementById('btn-next-chapter')?.addEventListener('click', () => {
    handleReaderNext();
  });

  // Keyboard navigation for reader:
  // - Left & Right Arrow keys: switch to previous/next chapter/page
  // - Down & Up Arrow keys: navigate to next/previous page (or panel slice in single mode)
  window.addEventListener('keydown', (e) => {
    if (state.currentView !== 'reader') return;

    const key = e.key;

    // NEXT: ArrowRight / D
    if (key === 'ArrowRight' || key.toLowerCase() === 'd') {
      e.preventDefault();
      handleReaderNext();
    }
    // PREVIOUS: ArrowLeft / A
    else if (key === 'ArrowLeft' || key.toLowerCase() === 'a') {
      e.preventDefault();
      handleReaderPrev();
    }
    // NEXT PAGE / PANEL: ArrowDown / S / Space / PageDown
    else if (key === 'ArrowDown' || key === ' ' || key.toLowerCase() === 's' || key === 'PageDown') {
      e.preventDefault();
      if (state.readerMode === 'single' || state.readerMode === 'double') {
        handleReaderNext();
      } else {
        const reader = document.getElementById('view-reader');
        if (reader) reader.scrollBy({ top: window.innerHeight * 0.75, behavior: 'smooth' });
      }
    }
    // PREVIOUS PAGE / PANEL: ArrowUp / W / PageUp
    else if (key === 'ArrowUp' || key.toLowerCase() === 'w' || key === 'PageUp') {
      e.preventDefault();
      if (state.readerMode === 'single' || state.readerMode === 'double') {
        handleReaderPrev();
      } else {
        const reader = document.getElementById('view-reader');
        if (reader) reader.scrollBy({ top: -window.innerHeight * 0.75, behavior: 'smooth' });
      }
    }
    // FULLSCREEN: F
    else if (key.toLowerCase() === 'f') {
      document.getElementById('menu-fullscreen-toggle')?.click();
    }
  });

  // Scroll Direction Listener for Auto-hiding / Showing Toolbars & Webtoon Auto-Next
  const readerContainer = document.getElementById('view-reader');
  const toolbar = document.getElementById('reader-toolbar');
  const footer = document.getElementById('reader-footer');

  let lastScrollTop = 0;
  let isBarsVisible = true;
  const SCROLL_THRESHOLD = 25;

  readerContainer?.addEventListener('scroll', () => {
    const currentScrollTop = readerContainer.scrollTop;
    const diff = currentScrollTop - lastScrollTop;

    // Scrolling down: Hide bars smoothly so reading isn't obstructed
    if (diff > SCROLL_THRESHOLD && currentScrollTop > 80) {
      if (isBarsVisible) {
        toolbar?.classList.add('hidden-bar');
        footer?.classList.add('hidden-bar');
        isBarsVisible = false;
      }
    }
    // Scrolling up: Show bars with smooth animation
    else if (diff < -SCROLL_THRESHOLD) {
      if (!isBarsVisible) {
        toolbar?.classList.remove('hidden-bar');
        footer?.classList.remove('hidden-bar');
        isBarsVisible = true;
      }
    }

    lastScrollTop = currentScrollTop;

    // Auto-navigate to next chapter at bottom in Webtoon mode (silent, no annoying toast)
    if (state.readerMode === 'long-strip' && !state.isAutoNavigatingNext) {
      const scrollBottom = readerContainer.scrollHeight - (currentScrollTop + readerContainer.clientHeight);
      if (scrollBottom <= 80 && diff >= 0) {
        const nextCh = findSmartNextChapter();
        if (nextCh) {
          state.isAutoNavigatingNext = true;
          const progressBar = document.getElementById('end-card-progress-bar');
          if (progressBar) progressBar.style.width = '100%';
          const subText = document.getElementById('end-card-sub-text');
          if (subText) subText.innerHTML = `Melompat ke chapter berikutnya...`;

          setTimeout(() => {
            if (state.currentView === 'reader') {
              const nextBtn = document.getElementById('btn-next-chapter');
              if (nextBtn && !nextBtn.disabled) {
                nextBtn.click();
              }
            }
          }, 600);
        }
      }
    }
  }, { passive: true });

  // Tap / Click reader viewport to toggle toolbars (convenient for mobile and desktop)
  document.getElementById('reader-viewport')?.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('select') || e.target.closest('a') || e.target.closest('.nav-click-zone')) return;
    isBarsVisible = !isBarsVisible;
    toolbar?.classList.toggle('hidden-bar', !isBarsVisible);
    footer?.classList.toggle('hidden-bar', !isBarsVisible);
  });
}

// ==========================================
// VIEW 4: READING HISTORY & BOOKMARKS
// ==========================================

const STORAGE_KEY_HISTORY = 'mangadex_reader_history';
const STORAGE_KEY_BOOKMARKS = 'mangadex_reader_bookmarks';

async function saveReadingHistory(manga, chapter) {
  if (!manga || !chapter) return;
  const history = getStoredList(STORAGE_KEY_HISTORY);

  const title = (manga.attributes ? getMangaTitle(manga.attributes) : '') || manga.title || 'Manga Tanpa Judul';
  let coverUrl = getCoverUrl(manga);

  // If coverUrl is fallback, try to retrieve from manga object or OfflineManager
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

  // Clean chapter title & eliminate double "Chapter Chapter"
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

  // Remove any double "Chapter Chapter" prefix if still present
  chNum = chNum.replace(/^(chapter|bab)\s+(chapter|bab)\b/i, 'Chapter').trim();

  // Filter out existing
  const updated = history.filter(item => item.mangaId !== manga.id);
  updated.unshift({
    mangaId: manga.id,
    title: title,
    coverUrl: coverUrl,
    chapterId: chapter.id,
    chapterNum: chNum,
    timestamp: Date.now()
  });

  // Limit to 50 items
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated.slice(0, 50)));
  updateAllCollectionBadges();
}

function getStoredList(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function getBookmarks() {
  return getStoredList(STORAGE_KEY_BOOKMARKS);
}

function isMangaBookmarked(mangaId) {
  if (!mangaId) return false;
  const bookmarks = getBookmarks();
  return bookmarks.some(b => b.id === mangaId);
}

function toggleBookmark(manga) {
  if (!manga) return false;
  const bookmarks = getBookmarks();
  const existingIdx = bookmarks.findIndex(b => b.id === manga.id);

  if (existingIdx !== -1) {
    // Remove
    bookmarks.splice(existingIdx, 1);
    localStorage.setItem(STORAGE_KEY_BOOKMARKS, JSON.stringify(bookmarks));
    updateAllCollectionBadges();
    return false;
  } else {
    // Add
    const title = manga.attributes ? getMangaTitle(manga.attributes) : (manga.title || 'Manga Tanpa Judul');
    const coverUrl = manga.attributes ? getCoverUrl(manga) : (manga.coverUrl || '');
    const status = manga.attributes?.status ? manga.attributes.status.toUpperCase() : 'ONGOING';
    const author = manga.attributes ? getAuthorName(manga) : (manga.author || '');
    const year = manga.attributes?.year || '';

    const newBookmark = {
      id: manga.id,
      title: title,
      coverUrl: coverUrl,
      status: status,
      author: author,
      year: year,
      bookmarkedAt: Date.now()
    };

    bookmarks.unshift(newBookmark);
    localStorage.setItem(STORAGE_KEY_BOOKMARKS, JSON.stringify(bookmarks));
    updateAllCollectionBadges();
    return true;
  }
}

function removeBookmark(mangaId) {
  const bookmarks = getBookmarks().filter(b => b.id !== mangaId);
  localStorage.setItem(STORAGE_KEY_BOOKMARKS, JSON.stringify(bookmarks));
  updateAllCollectionBadges();
  renderBookmarksList();
  showToast('Komik dihapus dari Bookmark.');
}

function updateAllCollectionBadges() {
  const bookmarks = getBookmarks();
  const history = getStoredList(STORAGE_KEY_HISTORY);

  // Desktop badge in navbar
  const deskBadge = document.getElementById('badge-nav-bookmarks');
  if (deskBadge) {
    deskBadge.textContent = bookmarks.length;
    if (bookmarks.length > 0) {
      deskBadge.classList.remove('hidden');
    } else {
      deskBadge.classList.add('hidden');
    }
  }

  // Mobile drawer badges
  const drawerBkmBadge = document.getElementById('drawer-badge-bookmarks');
  if (drawerBkmBadge) drawerBkmBadge.textContent = bookmarks.length;

  const drawerHistBadge = document.getElementById('drawer-badge-history');
  if (drawerHistBadge) drawerHistBadge.textContent = history.length;

  // Collection tabs counts
  const countTabBkm = document.getElementById('count-collection-bookmarks');
  if (countTabBkm) countTabBkm.textContent = bookmarks.length;

  const countTabHist = document.getElementById('count-collection-history');
  if (countTabHist) countTabHist.textContent = history.length;
}

function switchCollectionTab(tabName) {
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

function renderBookmarksList() {
  const rawBookmarks = getBookmarks();
  const validBookmarks = [];

  rawBookmarks.forEach(item => {
    if (!item) return;
    const title = (item.title && item.title !== 'undefined')
      ? item.title
      : (item.attributes ? getMangaTitle(item.attributes) : '');

    // Skip items without a valid title or id
    if (!title || title === 'undefined' || !item.id) return;

    const coverUrl = (item.coverUrl && item.coverUrl !== 'undefined')
      ? item.coverUrl
      : (item.attributes ? getCoverUrl(item) : '/images/cover-fallback.png');

    const status = (item.status && item.status !== 'undefined')
      ? item.status
      : (item.attributes?.status ? item.attributes.status.toUpperCase() : 'ONGOING');

    const author = (item.author && item.author !== 'undefined')
      ? item.author
      : (item.attributes ? getAuthorName(item) : '');

    validBookmarks.push({
      id: item.id,
      title,
      coverUrl,
      status,
      author
    });
  });

  // Sync sanitized bookmarks back to localStorage if dirty
  if (validBookmarks.length !== rawBookmarks.length) {
    localStorage.setItem(STORAGE_KEY_BOOKMARKS, JSON.stringify(validBookmarks));
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
        <button class="btn-explore" onclick="switchView('home'); loadPopularManga();" style="margin-top: 1rem;">Jelajahi Manga Sekarang</button>
      </div>
    `;
    initIcons();
    return;
  }

  grid.innerHTML = '';
  validBookmarks.forEach(item => {
    const card = document.createElement('div');
    card.className = 'bookmark-card';
    card.innerHTML = `
      <img src="${item.coverUrl}" class="bookmark-thumb" alt="${item.title}" onerror="this.src='/images/cover-fallback.png'">
      <div class="bookmark-info">
        <h4 class="bookmark-title" title="${item.title}">${item.title}</h4>
        <div class="bookmark-meta">
          <span class="bookmark-status">${item.status || 'ONGOING'}</span>
          ${item.author ? `<span class="bookmark-date">Oleh ${item.author}</span>` : ''}
        </div>
        <div class="bookmark-actions">
          <button class="btn-primary" onclick="openMangaDetail('${item.id}')">
            <i data-lucide="book-open"></i>
            <span>Buka Info</span>
          </button>
          <button class="btn-remove-bookmark" onclick="removeBookmark('${item.id}')" title="Hapus dari Bookmark">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  initIcons();
}

async function renderHistoryList() {
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
        <button class="btn-explore" onclick="switchView('home'); loadPopularManga();" style="margin-top: 1rem;">Jelajahi Manga Sekarang</button>
      </div>
    `;
    initIcons();
    return;
  }

  // Pre-load offline manga map
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

    // 1. Check Offline Library
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

    // 2. Check CoverCache
    if (!coverSrc || coverSrc.includes('No+Cover')) {
      const cached = CoverCache.get(item.mangaId, item.title);
      if (cached) {
        coverSrc = cached;
        item.coverUrl = cached;
        historyDirty = true;
      }
    }

    // 3. Check Bookmarks
    if (!coverSrc || coverSrc.includes('No+Cover')) {
      const bookmarked = getBookmarks().find(b => b.id === item.mangaId);
      if (bookmarked?.coverUrl && !bookmarked.coverUrl.includes('No+Cover')) {
        coverSrc = bookmarked.coverUrl;
        item.coverUrl = coverSrc;
        historyDirty = true;
      }
    }

    // 4. Clean "Bab" prefix to "Chapter" and eliminate double prefix
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
    const safeTitle = (item.title || '').replace(/'/g, "\\'");

    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <img src="${isPlaceholder ? 'https://placehold.co/300x420/1e2025/ffffff?text=Cover' : coverSrc}" 
           class="history-thumb" 
           alt="${item.title}" 
           data-manga-id="${item.mangaId || ''}"
           data-manga-title="${item.title || ''}"
           onerror="resolveMissingHistoryCover(this, '${safeTitle}', '${item.mangaId || ''}')">
      <div class="history-info">
        <h4 class="history-title">${item.title}</h4>
        <div class="history-chapter">Terakhir dibaca: <strong>${item.chapterNum}</strong></div>
        <div class="history-date">Dibaca pada ${dateStr}</div>
      </div>
      <button class="btn-primary" onclick="openMangaDetail('${item.mangaId}')">
        <i data-lucide="play"></i>
        <span>Lanjut Baca</span>
      </button>
    `;
    grid.appendChild(card);

    // If still missing/placeholder, actively heal from server in background!
    if (isPlaceholder) {
      resolveMissingHistoryCover(card.querySelector('.history-thumb'), item.title, item.mangaId);
    }
  });

  if (historyDirty) {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
  }

  initIcons();
}

// Active background healing function: finds real cover art from MangaDex API and updates DOM + storage
async function resolveMissingHistoryCover(imgElement, mangaTitle, mangaId) {
  if (!imgElement) return;
  try {
    // A. First try by mangaId if valid UUID
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

    // B. Search by title
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

function applyResolvedHistoryCover(imgElement, mangaTitle, mangaId, coverUrl) {
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
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
  }
}

function renderHistoryView(preferTab = 'bookmarks') {
  switchCollectionTab(preferTab);
}

function initHistoryControls() {
  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    if (confirm('Apakah Anda yakin ingin menghapus seluruh riwayat membaca?')) {
      localStorage.removeItem(STORAGE_KEY_HISTORY);
      renderHistoryList();
      updateAllCollectionBadges();
      showToast('Riwayat membaca telah dibersihkan.');
    }
  });
}

// ==========================================
// MOBILE DRAWER & GESTURE CONTROLLER
// ==========================================

function openMobileDrawer() {
  const backdrop = document.getElementById('mobile-drawer-backdrop');
  const drawer = document.getElementById('mobile-drawer');
  backdrop?.classList.add('active');
  drawer?.classList.add('open');
  document.body.style.overflow = 'hidden';
  updateAllCollectionBadges();
  updateOfflineDrawerBadge();
  initIcons();
}

function closeMobileDrawer() {
  const backdrop = document.getElementById('mobile-drawer-backdrop');
  const drawer = document.getElementById('mobile-drawer');
  backdrop?.classList.remove('active');
  drawer?.classList.remove('open');
  if (state.currentView !== 'reader') {
    document.body.style.overflow = '';
  }
}

async function updateOfflineDrawerBadge() {
  try {
    if (window.OfflineManager) {
      const all = await OfflineManager.getAllManga();
      const badge = document.getElementById('drawer-badge-offline');
      if (badge) badge.textContent = all.length;
    }
  } catch (e) { }
}

function initMobileDrawer() {
  const btnMenu = document.getElementById('btn-mobile-menu');
  const btnClose = document.getElementById('btn-close-drawer');
  const backdrop = document.getElementById('mobile-drawer-backdrop');

  btnMenu?.addEventListener('click', openMobileDrawer);
  btnClose?.addEventListener('click', closeMobileDrawer);
  backdrop?.addEventListener('click', closeMobileDrawer);

  // Drawer Navigation Items
  document.getElementById('drawer-nav-home')?.addEventListener('click', () => {
    closeMobileDrawer();
    switchView('home');
    loadPopularManga();
  });

  document.getElementById('drawer-nav-bookmarks')?.addEventListener('click', () => {
    closeMobileDrawer();
    switchView('history');
    switchCollectionTab('bookmarks');
  });

  document.getElementById('drawer-nav-history')?.addEventListener('click', () => {
    closeMobileDrawer();
    switchView('history');
    switchCollectionTab('history');
  });

  document.getElementById('drawer-nav-offline')?.addEventListener('click', () => {
    closeMobileDrawer();
    switchView('offline');
  });

  // Swipe Gesture Support:
  // When swiping from right to left on mobile -> opens drawer!
  // When swiping left to right while open -> closes drawer!
  let touchStartX = 0;
  let touchStartY = 0;

  window.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;

    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;

    // Only active on mobile screens (<= 768px) and not in reader mode
    if (window.innerWidth > 768) return;
    if (state.currentView === 'reader') return;

    const drawer = document.getElementById('mobile-drawer');
    const isOpen = drawer?.classList.contains('open');

    if (!isOpen) {
      // Swiping from right towards left: touchStartX near right edge (within 100px) or drag left > 55px
      const isFromRightSide = touchStartX >= (window.innerWidth - 110);
      const isSwipeLeft = deltaX < -50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
      if (isFromRightSide && isSwipeLeft) {
        openMobileDrawer();
      }
    } else {
      // Drawer is open: swipe left-to-right to close
      const isSwipeRight = deltaX > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
      if (isSwipeRight) {
        closeMobileDrawer();
      }
    }
  }, { passive: true });
}

// ==========================================
// VIEW 5: OFFLINE STORAGE & QUEUE CONTROLLER
// ==========================================

let isQueuePausedLocal = false;

function initOfflineQueueUI() {
  if (!window.OfflineManager) return;

  OfflineManager.subscribe((snapshot) => {
    const widget = document.getElementById('download-queue-widget');
    if (!widget) return;

    if (snapshot.totalInQueue === 0 && !snapshot.activeItem) {
      widget.classList.add('hidden');
      return;
    }

    widget.classList.remove('hidden');
    isQueuePausedLocal = snapshot.isPaused;

    const titleEl = document.getElementById('queue-header-title');
    const pauseIcon = document.getElementById('queue-pause-icon');
    const chLabel = document.getElementById('queue-chapter-label');
    const pagesLabel = document.getElementById('queue-pages-label');
    const progressFill = document.getElementById('queue-progress-fill');
    const remLabel = document.getElementById('queue-remaining-label');
    const percentLabel = document.getElementById('queue-percent-label');
    const spinner = document.getElementById('queue-status-spinner');

    if (snapshot.isPaused) {
      if (titleEl) titleEl.textContent = 'Unduhan Dijeda';
      if (spinner) spinner.style.animationPlayState = 'paused';
      if (pauseIcon) {
        pauseIcon.setAttribute('data-lucide', 'play');
      }
    } else {
      if (titleEl) titleEl.textContent = 'Mengunduh Chapter Komik...';
      if (spinner) spinner.style.animationPlayState = 'running';
      if (pauseIcon) {
        pauseIcon.setAttribute('data-lucide', 'pause');
      }
    }

    const p = snapshot.progress;
    if (chLabel) chLabel.textContent = `${p.mangaTitle || 'Komik'} - Chapter ${p.chapterNum || ''}`;
    if (pagesLabel) pagesLabel.textContent = `${p.currentPages}/${p.totalPages} Hal`;
    if (progressFill) progressFill.style.width = `${p.percent || 0}%`;
    if (remLabel) remLabel.textContent = `${snapshot.queue.length} chapter lagi di antrean`;
    if (percentLabel) percentLabel.textContent = `${p.percent || 0}%`;

    initIcons();
  });

  document.getElementById('btn-queue-pause')?.addEventListener('click', () => {
    if (!window.OfflineManager) return;
    if (isQueuePausedLocal) {
      OfflineManager.resumeQueue();
      showToast('Melanjutkan antrean unduh...');
    } else {
      OfflineManager.pauseQueue();
      showToast('Antrean unduh dijeda.');
    }
  });

  document.getElementById('btn-queue-cancel')?.addEventListener('click', () => {
    if (!window.OfflineManager) return;
    if (confirm('Batalkan seluruh proses antrean unduh?')) {
      OfflineManager.cancelAll();
    }
  });
}

function initOfflineDownloadControls() {
  const btnDownloadAll = document.getElementById('btn-download-all');
  const btnOptions = document.getElementById('btn-download-options');
  const menuOptions = document.getElementById('download-dropdown-menu');
  const optNext5 = document.getElementById('opt-download-next-5');
  const optUnread10 = document.getElementById('opt-download-unread-10');

  // Toggle dropdown
  btnOptions?.addEventListener('click', (e) => {
    e.stopPropagation();
    menuOptions?.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    menuOptions?.classList.add('hidden');
  });

  // Download All Chapters
  btnDownloadAll?.addEventListener('click', async () => {
    if (!window.OfflineManager || !state.currentManga) return;

    const mangaObj = {
      id: state.currentManga.id,
      title: getMangaTitle(state.currentManga.attributes),
      coverUrl: getCoverUrl(state.currentManga),
      synopsis: state.currentManga.attributes?.description?.id || state.currentManga.attributes?.description?.en || ''
    };

    if (state.currentSource === 'bacakomik') {
      if (!state.externalChapters || state.externalChapters.length === 0) {
        showToast('Tidak ada chapter yang tersedia di mirror.');
        return;
      }
      const chs = state.externalChapters.map(c => ({
        id: c.url,
        url: c.url,
        number: c.num,
        title: c.title.replace(/\s+/g, ' ').trim()
      }));
      await OfflineManager.enqueueMultipleChapters(mangaObj, chs, 'bacakomik');
    } else if (state.currentSource === 'english') {
      if (!state.englishChapters || state.englishChapters.length === 0) {
        showToast('Tidak ada chapter yang tersedia di English mirror.');
        return;
      }
      const chs = state.englishChapters.map(c => ({
        id: c.url,
        url: c.url,
        number: c.num,
        title: c.title.replace(/\s+/g, ' ').trim()
      }));
      await OfflineManager.enqueueMultipleChapters(mangaObj, chs, 'english');
    } else {
      if (!state.currentChapters || state.currentChapters.length === 0) {
        showToast('Tidak ada chapter yang tersedia untuk diunduh.');
        return;
      }
      const chs = state.currentChapters.map(c => ({
        id: c.id,
        number: c.attributes?.chapter || '',
        title: `Chapter ${c.attributes?.chapter || ''} ${c.attributes?.title || ''}`.trim()
      }));
      await OfflineManager.enqueueMultipleChapters(mangaObj, chs, 'mangadex');
    }
  });

  // Download Next 5
  optNext5?.addEventListener('click', async () => {
    if (!window.OfflineManager || !state.currentManga) return;
    menuOptions?.classList.add('hidden');

    const mangaObj = {
      id: state.currentManga.id,
      title: getMangaTitle(state.currentManga.attributes),
      coverUrl: getCoverUrl(state.currentManga),
      synopsis: state.currentManga.attributes?.description?.id || state.currentManga.attributes?.description?.en || ''
    };

    let targetList = [];
    if (state.currentSource === 'bacakomik') {
      targetList = state.externalChapters.map(c => ({ id: c.url, url: c.url, number: c.num, title: c.title.replace(/\s+/g, ' ').trim() }));
    } else if (state.currentSource === 'english') {
      targetList = state.englishChapters.map(c => ({ id: c.url, url: c.url, number: c.num, title: c.title.replace(/\s+/g, ' ').trim() }));
    } else {
      targetList = state.currentChapters.map(c => ({ id: c.id, number: c.attributes?.chapter || '', title: `Chapter ${c.attributes?.chapter || ''}`.trim() }));
    }

    if (targetList.length === 0) {
      showToast('Tidak ada chapter yang tersedia.');
      return;
    }

    const downloadedSet = await OfflineManager.getDownloadedChapterIds(mangaObj.id);
    const toDownload = targetList.filter(c => !downloadedSet.has(c.id)).slice(0, 5);

    if (toDownload.length === 0) {
      showToast('Semua chapter sudah terunduh!');
      return;
    }

    await OfflineManager.enqueueMultipleChapters(mangaObj, toDownload, state.currentSource);
  });

  // Download 10 Unread Chapters
  optUnread10?.addEventListener('click', async () => {
    if (!window.OfflineManager || !state.currentManga) return;
    menuOptions?.classList.add('hidden');

    const history = getStoredList(STORAGE_KEY_HISTORY);
    const readIds = new Set(history.map(h => h.chapterId).filter(Boolean));

    const mangaObj = {
      id: state.currentManga.id,
      title: getMangaTitle(state.currentManga.attributes),
      coverUrl: getCoverUrl(state.currentManga),
      synopsis: state.currentManga.attributes?.description?.id || state.currentManga.attributes?.description?.en || ''
    };

    let targetList = [];
    if (state.currentSource === 'bacakomik') {
      targetList = state.externalChapters.map(c => ({ id: c.url, url: c.url, number: c.num, title: c.title.replace(/\s+/g, ' ').trim() }));
    } else if (state.currentSource === 'english') {
      targetList = state.englishChapters.map(c => ({ id: c.url, url: c.url, number: c.num, title: c.title.replace(/\s+/g, ' ').trim() }));
    } else {
      targetList = state.currentChapters.map(c => ({ id: c.id, number: c.attributes?.chapter || '', title: `Chapter ${c.attributes?.chapter || ''}`.trim() }));
    }

    const downloadedSet = await OfflineManager.getDownloadedChapterIds(mangaObj.id);
    const unreadUnDownloaded = targetList.filter(c => !readIds.has(c.id) && !downloadedSet.has(c.id)).slice(0, 10);

    if (unreadUnDownloaded.length === 0) {
      showToast('Semua chapter yang belum dibaca sudah terunduh atau tidak ada chapter baru.');
      return;
    }

    await OfflineManager.enqueueMultipleChapters(mangaObj, unreadUnDownloaded, state.currentSource);
  });

  // Clean read chapters button
  document.getElementById('btn-clean-read-chapters')?.addEventListener('click', async () => {
    if (!window.OfflineManager) return;
    const history = getStoredList(STORAGE_KEY_HISTORY);
    const readChapterIds = history.map(h => h.chapterId).filter(Boolean);

    if (readChapterIds.length === 0) {
      showToast('Belum ada riwayat chapter yang selesai dibaca.');
      return;
    }

    if (confirm(`Bersihkan semua file offline untuk ${readChapterIds.length} chapter yang sudah pernah Anda baca?`)) {
      await OfflineManager.deleteReadChapters(readChapterIds);
      renderOfflineLibraryView();
    }
  });
}

async function renderOfflineLibraryView() {
  if (!window.OfflineManager) return;

  // 1. Update storage usage bar
  try {
    const stats = await OfflineManager.getStorageEstimate();
    const usageEl = document.getElementById('storage-usage-text');
    const fillEl = document.getElementById('storage-progress-fill');
    if (usageEl) usageEl.textContent = `${stats.usageMb} MB / ${stats.quotaMb} MB (${stats.percent}%)`;
    if (fillEl) fillEl.style.width = `${Math.min(stats.percent, 100)}%`;
  } catch (e) { }

  // 2. Fetch offline manga
  const grid = document.getElementById('offline-manga-grid');
  const countBadge = document.getElementById('offline-count-badge');
  if (!grid) return;

  const mangas = await OfflineManager.getAllOfflineManga();
  if (countBadge) countBadge.textContent = `${mangas.length} Komik Tersimpan`;

  if (mangas.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i data-lucide="cloud-off"></i>
        <h3>Belum Ada Komik Offline</h3>
        <p>Anda belum mengunduh chapter komik apapun. Buka detail manga dan klik "Download Semua" atau download per chapter untuk membaca tanpa internet.</p>
        <button class="btn-explore" onclick="switchView('home')">Jelajahi Manga Sekarang</button>
      </div>
    `;
    initIcons();
    return;
  }

  grid.innerHTML = '';
  mangas.forEach(m => {
    let coverSrc = 'https://placehold.co/300x420/1e2025/ffffff?text=No+Cover';
    if (m.coverBlob && m.coverBlob instanceof Blob && m.coverBlob.size > 100) {
      coverSrc = URL.createObjectURL(m.coverBlob);
      state.activeObjectUrls.push(coverSrc);
    } else if (m.coverUrl) {
      coverSrc = m.coverUrl;
    }

    const sourceLabel = m.source === 'english' ? '🇬🇧 English Mirror' : (m.source === 'bacakomik' ? '🇮🇩 Bacakomik Mirror' : 'Server Utama');

    const isCorruptedOldBatch = m.totalSizeMb === '0.0' || (parseFloat(m.totalSizeMb) === 0);

    const card = document.createElement('div');
    card.className = 'offline-manga-card';
    card.innerHTML = `
      <img src="${coverSrc}" class="offline-card-thumb" alt="${m.title}" onerror="this.src='https://placehold.co/300x420/1e2025/ffffff?text=Cover';">
      <div class="offline-card-info">
        <div>
          <div class="offline-card-title" title="${m.title}">${m.title}</div>
          <div class="offline-card-meta">
            <span>💾 ${m.chaptersCount} Chapter Terunduh (${m.totalSizeMb} MB) ${isCorruptedOldBatch ? '<span style="color:#f87171; font-weight:600; margin-left:0.3rem;">⚠️ Perlu Unduh Ulang</span>' : ''}</span>
            <span>🌐 Sumber: ${sourceLabel}</span>
          </div>
        </div>
        <div class="offline-card-actions">
          <button class="btn-read-offline" data-manga-id="${m.id}" data-source="${m.source || 'mangadex'}">
            <i data-lucide="book-open"></i> Baca Offline
          </button>
          <button class="btn-delete-download" title="Hapus seluruh data offline manga ini" data-del-id="${m.id}">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;

    // Click Baca Offline: directly launches reader with downloaded chapters
    card.querySelector('.btn-read-offline')?.addEventListener('click', async () => {
      const chs = await OfflineManager.db.chapters.where('mangaId').equals(m.id).toArray();
      if (chs.length > 0) {
        const sortedChs = chs.sort((a, b) => parseFloat(a.chapterNumber || '0') - parseFloat(b.chapterNumber || '0'));
        const firstCh = sortedChs[0];

        // Check if pages are corrupted from previous old download
        const validPages = await OfflineManager.getOfflinePages(firstCh.id);
        if (!validPages || validPages.length === 0) {
          showToast('Unduhan chapter ini dari sesi sebelum perbaikan. Membuka detail komik untuk mengunduh ulang...');
          openMangaDetail(m.id);
          return;
        }

        state.currentManga = {
          id: m.id,
          title: m.title,
          coverUrl: m.coverUrl || '',
          coverBlob: m.coverBlob || null,
          attributes: {
            title: { en: m.title },
            description: { id: m.synopsis || '' },
            coverUrl: m.coverUrl || ''
          }
        };

        // CRITICAL: Reset all stale chapters from previous manga to prevent navigation leak!
        state.allMangaDexChapters = [];
        state.currentSource = m.source || 'mangadex';

        if (m.source === 'english') {
          state.isExternal = true;
          const allExternal = sortedChs.map(c => ({
            url: c.id,
            title: c.title,
            num: parseFloat(c.chapterNumber || '1')
          }));
          state.englishChapters = allExternal;
          openEnglishReader(firstCh.id, firstCh.title, allExternal, 0);
        } else if (m.source === 'bacakomik') {
          state.isExternal = true;
          const allExternal = sortedChs.map(c => ({
            url: c.id,
            title: c.title,
            num: parseFloat(c.chapterNumber || '1')
          }));
          state.externalChapters = allExternal;
          openExternalReader(firstCh.id, firstCh.title, allExternal, 0);
        } else {
          state.isExternal = false;
          state.currentChapters = sortedChs.map(c => ({
            id: c.id,
            mangaId: m.id,
            attributes: {
              chapter: c.chapterNumber,
              title: c.title
            }
          }));
          state.allMangaDexChapters = state.currentChapters;
          openReader(firstCh.id, 0);
        }
      } else {
        openMangaDetail(m.id);
      }
    });

    // 2-Step Inline Confirmation for Delete Manga (Reliable & No blocked window.confirm)
    const delBtn = card.querySelector('.btn-delete-download');
    let confirmTimer = null;

    delBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (delBtn.classList.contains('confirming')) {
        clearTimeout(confirmTimer);
        delBtn.innerHTML = `<span style="font-size:0.75rem;">Menghapus...</span>`;
        delBtn.disabled = true;
        await OfflineManager.deleteManga(m.id);
        renderOfflineLibraryView();
      } else {
        delBtn.classList.add('confirming', 'btn-confirm-delete');
        delBtn.innerHTML = `<i data-lucide="trash-2"></i> Yakin Hapus?`;
        initIcons();

        confirmTimer = setTimeout(() => {
          delBtn.classList.remove('confirming', 'btn-confirm-delete');
          delBtn.innerHTML = `<i data-lucide="trash-2"></i>`;
          initIcons();
        }, 4000);
      }
    });

    grid.appendChild(card);
  });

  initIcons();
}

// ==========================================
// PROGRESSIVE WEB APP (PWA) & OFFLINE ENGINE
// ==========================================

let deferredPWAInstallPrompt = null;

// Immediately register beforeinstallprompt so we don't miss early triggers
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPWAInstallPrompt = e;
  console.log('[Yomikomi PWA] beforeinstallprompt event captured');

  // Trigger UI display if DOM is ready
  const btnNav = document.getElementById('btn-install-app');
  const wrapDrawer = document.getElementById('drawer-install-wrap');
  if (btnNav && !isPWARunningStandalone()) btnNav.classList.remove('hidden');
  if (wrapDrawer && !isPWARunningStandalone()) wrapDrawer.classList.remove('hidden');
  initIcons();
});

function isPWARunningStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://')
  );
}

function isDeviceIOS() {
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) && !window.MSStream;
}

function registerAppServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('[Yomikomi PWA] Service Worker aktif! Scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('[Yomikomi PWA] Registrasi Service Worker gagal:', err);
        });
    });
  }
}

function initPWA() {
  // 1. Register Service Worker for Offline App Shell
  registerAppServiceWorker();

  const installBtnNav = document.getElementById('btn-install-app');
  const installWrapDrawer = document.getElementById('drawer-install-wrap');
  const installBtnDrawer = document.getElementById('drawer-btn-install');
  const iosModal = document.getElementById('ios-install-modal');
  const btnCloseIosModal = document.getElementById('btn-close-ios-modal');
  const btnIosUnderstand = document.getElementById('btn-ios-understand');

  const hideAllInstallButtons = () => {
    if (installBtnNav) installBtnNav.classList.add('hidden');
    if (installWrapDrawer) installWrapDrawer.classList.add('hidden');
  };

  const showAllInstallButtons = () => {
    if (installBtnNav) installBtnNav.classList.remove('hidden');
    if (installWrapDrawer) installWrapDrawer.classList.remove('hidden');
    initIcons();
  };

  // 2. Hide buttons if user is ALREADY running standalone PWA
  if (isPWARunningStandalone()) {
    hideAllInstallButtons();
    return;
  }

  // 3. Show buttons immediately if beforeinstallprompt already fired or if iOS Safari
  if (deferredPWAInstallPrompt) {
    showAllInstallButtons();
  } else if (isDeviceIOS()) {
    showAllInstallButtons();
  }

  // 4. Handle install button clicks
  const handleInstallClick = async () => {
    if (deferredPWAInstallPrompt) {
      // Native Chromium / Android prompt
      try {
        deferredPWAInstallPrompt.prompt();
        const choice = await deferredPWAInstallPrompt.userChoice;
        console.log('[Yomikomi PWA] Pilihan user:', choice.outcome);
        if (choice.outcome === 'accepted') {
          showToast('Terima kasih telah memasang aplikasi Yomikomi! 🎉');
          hideAllInstallButtons();
        }
      } catch (err) {
        console.warn('[Yomikomi PWA] Gagal memanggil prompt:', err);
      }
      deferredPWAInstallPrompt = null;
    } else if (isDeviceIOS()) {
      // iOS Safari guide modal
      if (iosModal) {
        iosModal.classList.remove('hidden');
        initIcons();
      }
    } else {
      // Fallback instruction
      showToast('Aplikasi siap di-install! Buka menu browser (titik 3 di kanan atas) lalu pilih "Install Aplikasi" atau "Tambahkan ke Layar Utama".');
    }
  };

  installBtnNav?.addEventListener('click', handleInstallClick);
  installBtnDrawer?.addEventListener('click', () => {
    if (typeof closeMobileDrawer === 'function') {
      closeMobileDrawer();
    }
    handleInstallClick();
  });

  // 5. iOS Modal listeners
  btnCloseIosModal?.addEventListener('click', () => {
    iosModal?.classList.add('hidden');
  });
  btnIosUnderstand?.addEventListener('click', () => {
    iosModal?.classList.add('hidden');
  });
  iosModal?.addEventListener('click', (e) => {
    if (e.target === iosModal) {
      iosModal.classList.add('hidden');
    }
  });

  // 6. Listen to display-mode change (e.g. installed while running)
  try {
    const displayModeQuery = window.matchMedia('(display-mode: standalone)');
    displayModeQuery.addEventListener('change', (e) => {
      if (e.matches) {
        hideAllInstallButtons();
      }
    });
  } catch (e) { }

  // 7. App installed confirmation event
  window.addEventListener('appinstalled', () => {
    console.log('[Yomikomi PWA] Aplikasi berhasil di-install ke home screen!');
    showToast('Yomikomi berhasil terpasang di perangkat Anda! 📲');
    deferredPWAInstallPrompt = null;
    hideAllInstallButtons();
  });

  // 8. Offline & Online connectivity banners
  window.addEventListener('offline', () => {
    showToast('⚠️ Koneksi terputus. Anda dapat tetap membaca manga dari Offline Library!');
  });
  window.addEventListener('online', () => {
    showToast('✅ Koneksi internet kembali aktif.');
  });
}
