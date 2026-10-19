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
  readerModePreference: localStorage.getItem('yomikomi_reader_mode_pref') || 'auto', // 'auto', 'long-strip', 'single', 'double'
  readerMode: 'long-strip', // active effective mode ('long-strip', 'single', 'double')
  readerQuality: 'dataSaver', // 'dataSaver' or 'pages' (original)
  currentPageIndex: 0,
  currentSingleSlice: 0,
  isAutoNavigatingNext: false,
  heroSlideInterval: null,
  activeHeroIndex: 0,
  isExternal: false,
  externalChapters: [],
  mirrorOrder: 'asc',
  activeMirrorComic: null,
  rawMirrorChapters: [],
  matchedMirrorComics: [],
  englishChapters: [],
  englishOrder: 'asc',
  activeEnglishComic: null,
  rawEnglishChapters: [],
  matchedEnglishComics: [],
  currentSource: 'mangadex', // 'mangadex', 'bacakomik', or 'english'
  activeObjectUrls: [],
  selectedGenre: null, // { id, name }
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
  initGenreFilter();
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
// FILTER TABS & GENRE CATALOG
// ==========================================

const MANGADEX_GENRES = [
  { id: '391b0423-d847-456f-aff0-8b0cfc03066b', name: 'Action', icon: 'zap' },
  { id: '87cc87cd-a395-47af-b27a-93258283bbc6', name: 'Adventure', icon: 'compass' },
  { id: '4d32cc48-9f00-4cca-9b5a-a839f0764984', name: 'Comedy', icon: 'smile' },
  { id: 'b9af3a63-f058-46de-a9a0-e0c13906197a', name: 'Drama', icon: 'film' },
  { id: 'cdc58593-87dd-415e-bbc0-2ec27bf404cc', name: 'Fantasy', icon: 'sparkles' },
  { id: 'ace04997-f6bd-436e-b261-779182193d3d', name: 'Isekai', icon: 'globe' },
  { id: '423e2eae-a7a2-4a8b-ac03-a8351462d71d', name: 'Romance', icon: 'heart' },
  { id: '256c8bd9-4904-4360-bf4f-508a76d67183', name: 'Sci-Fi', icon: 'cpu' },
  { id: 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9', name: 'Slice of Life', icon: 'coffee' },
  { id: '69964a64-2f90-4d33-beeb-f3ed2875eb4c', name: 'Sports', icon: 'award' },
  { id: 'cdad7e68-1419-41dd-bdce-27753074a640', name: 'Horror', icon: 'skull' },
  { id: 'ee968100-4191-4968-93d3-f82d72be7e46', name: 'Mystery', icon: 'help-circle' },
  { id: '33771934-028e-4cb3-8744-691e866a923e', name: 'Historical', icon: 'hourglass' },
  { id: '3b60b75c-a2d7-4860-ab56-05f391bb889c', name: 'Psychological', icon: 'eye' },
  { id: '07251805-a27e-4d59-b488-f0bfbec15168', name: 'Thriller', icon: 'alert-triangle' },
  { id: 'f8f62932-27da-4fe4-8ee1-6779a8c5edba', name: 'Tragedy', icon: 'cloud-rain' },
  { id: '50880a9d-5440-4732-9afb-8f457127e836', name: 'Mecha', icon: 'bot' },
  { id: '5ca48985-9a9d-4bd8-be29-80dc0303db72', name: 'Crime', icon: 'shield-alert' },
  { id: '7064a261-a137-4d3a-8848-2d385de3a99c', name: 'Superhero', icon: 'shield' },
  { id: 'acc803a4-c95a-4c22-86fc-eb6b582d82a2', name: 'Wuxia', icon: 'feather' },
  { id: '5920b825-4181-4a17-beeb-9918b0ff7a30', name: "Boys' Love", icon: 'heart' },
  { id: 'a3c67850-4684-404e-9b7f-c69850ee5da6', name: "Girls' Love", icon: 'heart' },
  { id: '81c836c9-914a-4eca-981a-560dad663e73', name: 'Magical Girls', icon: 'wand' },
  { id: 'c8cbe35b-1b2b-4a3f-9c37-db84c4514856', name: 'Medical', icon: 'activity' },
  { id: 'b1e97889-25b4-4258-b28b-cd7f4d28ea9b', name: 'Philosophical', icon: 'book' }
];

const MANGADEX_POPULAR_THEMES = [
  { id: 'eabc5b4c-6aff-42f3-b657-3e90cbd00b75', name: 'Supernatural', icon: 'flame' },
  { id: '799c202e-7daa-44eb-9cf7-8a3c0441531e', name: 'Martial Arts', icon: 'swords' },
  { id: 'caaa44eb-cd40-4177-b930-79d3ef2afe87', name: 'School Life', icon: 'graduation-cap' },
  { id: '0bc90acb-ccc1-44ca-a34a-b9f3a73259d0', name: 'Reincarnation', icon: 'refresh-ccw' },
  { id: 'aafb99c1-7f60-43fa-b75f-fc9502ce29c7', name: 'Harem', icon: 'users' },
  { id: '5fff9cde-849c-4d78-aab0-0d52b2ee1d25', name: 'Survival', icon: 'life-buoy' },
  { id: '292e862b-2d17-4062-90a2-0356caa4ae27', name: 'Time Travel', icon: 'clock' },
  { id: '36fd93ea-e8b8-445e-b836-358f02b3d33d', name: 'Monsters', icon: 'target' },
  { id: '39730448-9a5f-48a2-85b0-a70db87b1233', name: 'Demons', icon: 'skull' },
  { id: '9438db5a-7e2a-4ac0-b39e-e0d95a34b8a8', name: 'Video Games', icon: 'gamepad-2' },
  { id: '9467335a-1b83-4497-9231-765337a00b96', name: 'Post-Apocalyptic', icon: 'radioactive' },
  { id: 'a1f53773-c69a-4ce5-8cab-fffcd90b1565', name: 'Magic', icon: 'sparkles' },
  { id: 'ac72833b-c4e9-4878-b9db-6c8a4a99444a', name: 'Military', icon: 'crosshair' },
  { id: 'd14322ac-4d6f-4e9b-afd9-629d5f4d8a41', name: 'Villainess', icon: 'crown' },
  { id: 'd7d1730f-6eb0-4ba6-9437-602cac38664c', name: 'Vampires', icon: 'moon' },
  { id: 'e64f6742-c834-471d-8d72-dd51fc02b835', name: 'Aliens', icon: 'radar' },
  { id: 'ea2bc92d-1c26-4930-9b7c-d5c0dc1b6869', name: 'Cooking', icon: 'utensils' },
  { id: 'f42fbf9e-188a-447b-9fdc-f19dc1e4d685', name: 'Music', icon: 'music' },
  { id: 'da2d50ca-3018-4cc0-ac7a-6b7d472a29ea', name: 'Delinquents', icon: 'frown' },
  { id: '631ef465-9aba-4afb-b0fc-ea10efe274a8', name: 'Zombies', icon: 'biohazard' }
];

function initFilters() {
  const tabs = document.querySelectorAll('.filter-tab:not(.genre-dropdown-toggle)');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const filter = tab.dataset.filter;

      // Reset genre selection when switching between primary tabs
      if (typeof window.resetGenreSelection === 'function') {
        window.resetGenreSelection(false);
      }

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

function initGenreFilter() {
  const chipsScroll = document.getElementById('genre-chips-scroll');
  const modalBody = document.getElementById('genre-modal-body');
  const toggleBtn = document.getElementById('btn-genre-toggle');
  const toggleText = document.getElementById('genre-toggle-text');
  const modalBackdrop = document.getElementById('genre-modal-backdrop');
  const modalPanel = document.getElementById('genre-modal-panel');
  const closeBtn = document.getElementById('btn-close-genre-modal');
  const searchInput = document.getElementById('genre-modal-search-input');
  const clearSearchBtn = document.getElementById('btn-clear-genre-search');

  if (!chipsScroll || !modalBody) return;

  // 1. Populate Horizontal Scrollable Chips
  const allChips = [...MANGADEX_GENRES, ...MANGADEX_POPULAR_THEMES];
  allChips.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'genre-chip';
    btn.type = 'button';
    btn.dataset.genreId = g.id;
    btn.dataset.genreName = g.name;
    btn.innerHTML = `<i data-lucide="${g.icon || 'tag'}"></i><span>${g.name}</span>`;
    btn.addEventListener('click', () => {
      selectGenre(g.id, g.name);
    });
    chipsScroll.appendChild(btn);
  });

  // Handler for 'Semua Genre' chip
  const allChip = chipsScroll.querySelector('[data-genre-id="all"]');
  allChip?.addEventListener('click', () => {
    window.resetGenreSelection(true);
  });

  // 2. Populate Modal Grid
  function renderModalContent(filterText = '') {
    modalBody.innerHTML = '';
    const q = filterText.toLowerCase().trim();

    // Section 1: Main Genres
    const filteredGenres = MANGADEX_GENRES.filter(g => !q || g.name.toLowerCase().includes(q));
    if (filteredGenres.length > 0) {
      const gSection = document.createElement('div');
      gSection.innerHTML = `<div class="genre-modal-group-title">Kategori Genre Utama (${filteredGenres.length})</div>`;
      const gGrid = document.createElement('div');
      gGrid.className = 'genre-modal-grid';
      filteredGenres.forEach(g => {
        const itemBtn = document.createElement('button');
        itemBtn.className = `genre-modal-tag-btn ${state.selectedGenre?.id === g.id ? 'active' : ''}`;
        itemBtn.type = 'button';
        itemBtn.dataset.genreId = g.id;
        itemBtn.innerHTML = `<i data-lucide="${g.icon || 'tag'}"></i><span>${g.name}</span>`;
        itemBtn.addEventListener('click', () => {
          selectGenre(g.id, g.name);
          closeGenreModal();
        });
        gGrid.appendChild(itemBtn);
      });
      gSection.appendChild(gGrid);
      modalBody.appendChild(gSection);
    }

    // Section 2: Popular Themes
    const filteredThemes = MANGADEX_POPULAR_THEMES.filter(g => !q || g.name.toLowerCase().includes(q));
    if (filteredThemes.length > 0) {
      const tSection = document.createElement('div');
      tSection.innerHTML = `<div class="genre-modal-group-title">Tema & Sub-Genre Populer (${filteredThemes.length})</div>`;
      const tGrid = document.createElement('div');
      tGrid.className = 'genre-modal-grid';
      filteredThemes.forEach(g => {
        const itemBtn = document.createElement('button');
        itemBtn.className = `genre-modal-tag-btn ${state.selectedGenre?.id === g.id ? 'active' : ''}`;
        itemBtn.type = 'button';
        itemBtn.dataset.genreId = g.id;
        itemBtn.innerHTML = `<i data-lucide="${g.icon || 'tag'}"></i><span>${g.name}</span>`;
        itemBtn.addEventListener('click', () => {
          selectGenre(g.id, g.name);
          closeGenreModal();
        });
        tGrid.appendChild(itemBtn);
      });
      tSection.appendChild(tGrid);
      modalBody.appendChild(tSection);
    }

    if (filteredGenres.length === 0 && filteredThemes.length === 0) {
      modalBody.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
          <i data-lucide="help-circle" style="width: 32px; height: 32px; margin-bottom: 0.5rem;"></i>
          <p>Genre "<strong>${filterText}</strong>" tidak ditemukan.</p>
        </div>
      `;
    }

    if (window.lucide) window.lucide.createIcons({ root: modalBody });
  }

  renderModalContent();
  if (window.lucide) window.lucide.createIcons({ root: chipsScroll });

  // 3. Modal Controls
  function openGenreModal() {
    modalBackdrop.classList.remove('hidden');
    modalPanel.classList.remove('hidden');
    toggleBtn?.classList.add('open');
    if (searchInput) {
      searchInput.value = '';
      clearSearchBtn?.classList.add('hidden');
      renderModalContent();
      setTimeout(() => searchInput.focus(), 150);
    }
  }

  function closeGenreModal() {
    modalBackdrop.classList.add('hidden');
    modalPanel.classList.add('hidden');
    toggleBtn?.classList.remove('open');
  }

  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    // If active selection and user clicks toggle, reset selection
    if (state.selectedGenre) {
      window.resetGenreSelection(true);
      return;
    }
    if (modalPanel.classList.contains('hidden')) {
      openGenreModal();
    } else {
      closeGenreModal();
    }
  });

  closeBtn?.addEventListener('click', closeGenreModal);
  modalBackdrop?.addEventListener('click', closeGenreModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalPanel.classList.contains('hidden')) {
      closeGenreModal();
    }
  });

  // 4. Modal Search Handling
  searchInput?.addEventListener('input', (e) => {
    const val = e.target.value;
    if (val) {
      clearSearchBtn?.classList.remove('hidden');
    } else {
      clearSearchBtn?.classList.add('hidden');
    }
    renderModalContent(val);
  });

  clearSearchBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    clearSearchBtn?.classList.add('hidden');
    renderModalContent();
    searchInput?.focus();
  });

  // 5. Select a Genre
  function selectGenre(id, name) {
    state.selectedGenre = { id, name };

    // Update chips state
    chipsScroll.querySelectorAll('.genre-chip').forEach(c => {
      if (c.dataset.genreId === id) {
        c.classList.add('active');
        c.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } else {
        c.classList.remove('active');
      }
    });

    // Deselect main tabs to highlight active genre filtering
    document.querySelectorAll('.filter-tab:not(.genre-dropdown-toggle)').forEach(t => t.classList.remove('active'));

    // Update toggle button
    if (toggleBtn) {
      toggleBtn.classList.add('has-selection');
      toggleText.innerHTML = `Genre: ${name} <i data-lucide="x" style="width:12px;height:12px;margin-left:4px;vertical-align:middle;"></i>`;
      if (window.lucide) window.lucide.createIcons({ root: toggleBtn });
    }

    renderModalContent();
    loadMangaByGenre(id, name);
  }

  // 6. Reset Genre Selection
  window.resetGenreSelection = function (reloadDefault = true) {
    state.selectedGenre = null;

    chipsScroll.querySelectorAll('.genre-chip').forEach(c => {
      if (c.dataset.genreId === 'all') {
        c.classList.add('active');
      } else {
        c.classList.remove('active');
      }
    });

    if (toggleBtn) {
      toggleBtn.classList.remove('has-selection');
      toggleText.textContent = 'Filter Genre';
      if (window.lucide) window.lucide.createIcons({ root: toggleBtn });
    }

    renderModalContent();

    if (reloadDefault) {
      // Re-activate 'Semua Komik' tab
      document.querySelectorAll('.filter-tab').forEach(t => {
        if (t.dataset.filter === 'all') t.classList.add('active');
        else if (!t.classList.contains('genre-dropdown-toggle')) t.classList.remove('active');
      });
      loadPopularManga();
    }
  };
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

// 5. Load Manga by Genre
async function loadMangaByGenre(tagId, tagName) {
  const sectionTitle = document.getElementById('grid-section-title');
  if (sectionTitle) {
    sectionTitle.textContent = `Komik Genre: ${tagName}`;
  }
  const countBadge = document.getElementById('grid-count-badge');
  if (countBadge) {
    countBadge.textContent = 'Memuat...';
  }
  showGridSkeleton();

  try {
    let url = `/api/search?tag=${encodeURIComponent(tagId)}&limit=24&order=followedCount`;
    if (state.currentLang === 'id') {
      url += '&lang=id';
    } else if (state.currentLang === 'en') {
      url += '&lang=en';
    }
    const res = await fetch(url);
    const data = await res.json();
    state.mangaList = data.data || [];
    state.mangaList.forEach(m => {
      CoverCache.set(m.id, getMangaTitle(m.attributes), getCoverUrl(m));
    });
    renderMangaGrid(state.mangaList);
    if (countBadge) {
      countBadge.textContent = `${state.mangaList.length} Judul`;
    }
  } catch (error) {
    console.error(`Failed to load genre ${tagName}:`, error);
    showToast(`Gagal memuat komik genre ${tagName}`);
    if (countBadge) {
      countBadge.textContent = '0 Judul';
    }
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
          <span>${(() => {
            const hList = getStoredList(STORAGE_KEY_HISTORY);
            const last = hList.find(item => item.mangaId === manga.id);
            return last ? `Lanjut Baca (${last.chapterNum})` : 'Mulai Baca (Chapter 1)';
          })()}</span>
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
    const hList = getStoredList(STORAGE_KEY_HISTORY);
    const last = hList.find(item => item.mangaId === manga.id);
    if (last && last.chapterId && window.resumeReadingChapter) {
      window.resumeReadingChapter(manga.id, last.chapterId, last.chapterNum);
      return;
    }
    if (state.currentChapters.length > 0) {
      // Pick the first chapter
      openReader(state.currentChapters[0].id, 0);
    } else {
      showToast('Tidak ada chapter yang tersedia untuk dibaca.');
    }
  });

  initIcons();
}

function updateSortButtonLabel(order) {
  const btn = document.getElementById('chapter-sort-btn');
  const label = document.getElementById('chapter-sort-label');
  if (btn) btn.dataset.order = order;
  if (label) label.textContent = order === 'asc' ? 'Chapter 1 → Akhir' : 'Terbaru → Awal';
}

// Multi-Source Chapter Feed Controller
function initSourceTabs() {
  const tabMd = document.getElementById('source-tab-mangadex');
  const tabBk = document.getElementById('source-tab-bacakomik');
  const tabEn = document.getElementById('source-tab-english');
  const langPills = document.getElementById('mangadex-lang-pills');

  tabMd?.addEventListener('click', () => {
    tabMd.classList.add('active');
    tabBk?.classList.remove('active');
    tabEn?.classList.remove('active');
    if (langPills) langPills.style.display = 'flex';
    updateSortButtonLabel(state.currentSort || 'asc');
    state.currentSource = 'mangadex';
    if (state.currentManga) loadChaptersFeed(state.currentManga.id);
  });

  tabBk?.addEventListener('click', () => {
    tabBk.classList.add('active');
    tabMd?.classList.remove('active');
    tabEn?.classList.remove('active');
    if (langPills) langPills.style.display = 'none';
    updateSortButtonLabel(state.mirrorOrder || 'asc');
    state.currentSource = 'bacakomik';
    if (state.currentManga) loadBacakomikChaptersFeed();
  });

  tabEn?.addEventListener('click', () => {
    tabEn.classList.add('active');
    tabMd?.classList.remove('active');
    tabBk?.classList.remove('active');
    if (langPills) langPills.style.display = 'none';
    updateSortButtonLabel(state.englishOrder || 'asc');
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
  const langPills = document.getElementById('mangadex-lang-pills');
  if (langPills) langPills.style.display = 'flex';
  updateSortButtonLabel(state.currentSort || 'asc');
  state.currentSource = 'mangadex';

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

// ==========================================
// TITLE NORMALIZATION & FUZZY MATCH HELPER
// ==========================================

function normalizeTitle(t) {
  if (!t) return '';
  return t
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '') // remove brackets like (Official), [Raw]
    .replace(/[-_:]/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')   // keep alphanumeric & spaces
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateTitleSimilarity(titleA, titleB) {
  const normA = normalizeTitle(titleA);
  const normB = normalizeTitle(titleB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const compactA = normA.replace(/\s+/g, '');
  const compactB = normB.replace(/\s+/g, '');
  if (compactA === compactB) return 1.0;

  // Check containment for long titles (e.g. "Unemployed Gye Baeksun" vs "Gye Baeksun")
  if (compactA.includes(compactB) || compactB.includes(compactA)) {
    const minLen = Math.min(compactA.length, compactB.length);
    const maxLen = Math.max(compactA.length, compactB.length);
    if (minLen >= 4 && (minLen / maxLen) >= 0.5) {
      return 0.85;
    }
  }

  // Token-based Jaccard similarity
  const wordsA = new Set(normA.split(' ').filter(w => w.length > 1));
  const wordsB = new Set(normB.split(' ').filter(w => w.length > 1));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = intersection / union;
  const overlapA = intersection / wordsA.size;
  const overlapB = intersection / wordsB.size;

  return Math.max(jaccard, Math.min(overlapA, overlapB));
}

function filterAndSortMatchingComics(targetTitles, candidateComics) {
  if (!candidateComics || !Array.isArray(candidateComics) || candidateComics.length === 0) return [];

  const scored = [];
  for (const comic of candidateComics) {
    let maxScore = 0;
    for (const target of targetTitles) {
      const score = calculateTitleSimilarity(target, comic.title);
      if (score > maxScore) maxScore = score;
    }
    // Strict threshold: at least 0.55 similarity to prevent false matches
    if (maxScore >= 0.55) {
      scored.push({ comic, score: maxScore });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.comic);
}

// ==========================================
// INDO MIRROR (Bacakomik / Komikindo)
// ==========================================

async function loadBacakomikChaptersFeed() {
  const chaptersContainer = document.getElementById('chapters-list');
  chaptersContainer.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
  const badge = document.getElementById('chapters-total-badge');
  badge.textContent = 'Mencari Indo mirror...';

  const attrs = state.currentManga?.attributes;
  const primaryTitle = getMangaTitle(attrs);

  // Gather candidate titles from primary & altTitles
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

  // Add variants
  const variants = [];
  candidates.forEach(c => {
    const s1 = c.replace(/[-_:]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!candidates.includes(s1)) variants.push(s1);
    const s2 = c.replace(/[-_:]/g, '').replace(/\s+/g, ' ').trim();
    if (!candidates.includes(s2)) variants.push(s2);
  });
  const allQueries = [...candidates, ...variants];

  let matchedComics = [];

  for (const q of allQueries) {
    try {
      const res = await fetch(`/api/external/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.data && data.data.length > 0) {
        const matches = filterAndSortMatchingComics(candidates, data.data);
        if (matches.length > 0) {
          matchedComics = matches;
          break;
        }
      }
    } catch (e) { }
  }

  if (matchedComics.length === 0) {
    chaptersContainer.innerHTML = `
      <div class="empty-state">
        <i data-lucide="book-x"></i>
        <h4>Komik Ini Tidak Tersedia di Indo Mirror</h4>
        <p>Komik "<strong>${primaryTitle}</strong>" belum ditemukan di server Indo Mirror. Silakan gunakan Server Utama.</p>
      </div>
    `;
    badge.textContent = '0 Chapter (Indo Mirror)';
    initIcons();
    return;
  }

  const comic = matchedComics[0];
  state.activeMirrorComic = comic;
  state.matchedMirrorComics = matchedComics;

  try {
    const chRes = await fetch(`/api/external/chapters?url=${encodeURIComponent(comic.url)}`);
    const chData = await chRes.json();
    const chapters = chData.chapters || [];
    state.rawMirrorChapters = chapters;
    badge.textContent = `${chapters.length} Chapter (Indo Mirror)`;

    renderBacakomikChaptersList(chapters, comic, matchedComics);
  } catch (err) {
    console.error('Failed to load bacakomik chapters:', err);
    chaptersContainer.innerHTML = `<p class="empty-state">Gagal memuat chapter dari mirror Indo.</p>`;
    badge.textContent = 'Error';
    initIcons();
  }
}

async function renderBacakomikChaptersList(chapters, activeComic, allMatchedComics = []) {
  const container = document.getElementById('chapters-list');
  const badge = document.getElementById('chapters-total-badge');
  if (badge && chapters) {
    badge.textContent = `${chapters.length} Chapter (Indo Mirror)`;
  }

  if (chapters.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="folder-x"></i>
        <h4>Tidak Ada Chapter Tersedia di Indo Mirror</h4>
        <p>Belum ada rilis chapter untuk komik ini di mirror.</p>
      </div>
    `;
    initIcons();
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

  // Query offline downloaded chapters for this mirror comic
  const mangaId = state.currentManga?.id || activeComic.url;
  const downloadedSet = window.OfflineManager
    ? await OfflineManager.getDownloadedChapterIds(mangaId)
    : new Set();

  let html = '';

  // If multiple comics matched, show switch chips
  if (allMatchedComics.length > 1) {
    html += `
      <div class="mirror-matches-row">
        <span class="quick-tag-label">Pilih Judul Cocok:</span>
        ${allMatchedComics.map((c) => {
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

  // Chips click handler to switch between matched versions
  container.querySelectorAll('.mirror-matches-row .quick-tag-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const u = chip.dataset.url;
      container.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
      try {
        const res = await fetch(`/api/external/chapters?url=${encodeURIComponent(u)}`);
        const data = await res.json();
        const chs = data.chapters || [];
        const matchC = allMatchedComics.find(x => x.url === u) || { url: u, title: chip.textContent };
        state.activeMirrorComic = matchC;
        state.rawMirrorChapters = chs;
        renderBacakomikChaptersList(chs, matchC, allMatchedComics);
      } catch (e) {
        showToast('Gagal memuat chapter untuk judul ini');
      }
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

  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const readerContainer = document.getElementById('view-reader');
  if (readerContainer) readerContainer.scrollTop = 0;

  const viewport = document.getElementById('reader-viewport');
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

async function loadEnglishChaptersFeed() {
  const chaptersContainer = document.getElementById('chapters-list');
  chaptersContainer.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
  const badge = document.getElementById('chapters-total-badge');
  badge.textContent = 'Mencari mirror EN...';

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

  let matchedComics = [];

  for (const q of allQueries) {
    try {
      const res = await fetch(`/api/external/en/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.data && data.data.length > 0) {
        const matches = filterAndSortMatchingComics(candidates, data.data);
        if (matches.length > 0) {
          matchedComics = matches;
          break;
        }
      }
    } catch (e) { }
  }

  if (matchedComics.length === 0) {
    chaptersContainer.innerHTML = `
      <div class="empty-state">
        <i data-lucide="book-x"></i>
        <h4>Komik Ini Tidak Tersedia di English Mirror</h4>
        <p>Komik "<strong>${primaryTitle}</strong>" belum ditemukan di server English Mirror. Silakan gunakan Server Utama.</p>
      </div>
    `;
    badge.textContent = '0 Chapter (EN Mirror)';
    initIcons();
    return;
  }

  const comic = matchedComics[0];
  state.activeEnglishComic = comic;
  state.matchedEnglishComics = matchedComics;

  try {
    const chRes = await fetch(`/api/external/en/chapters?url=${encodeURIComponent(comic.url)}`);
    const chData = await chRes.json();
    const chapters = chData.chapters || [];
    state.rawEnglishChapters = chapters;
    badge.textContent = `${chapters.length} Chapter (EN Mirror)`;

    renderEnglishChaptersList(chapters, comic, matchedComics);
  } catch (err) {
    console.error('Failed to load English mirror chapters:', err);
    chaptersContainer.innerHTML = `<p class="empty-state">Gagal memuat chapter dari English mirror.</p>`;
    badge.textContent = 'Error';
    initIcons();
  }
}

async function renderEnglishChaptersList(chapters, activeComic, allMatchedComics = []) {
  const container = document.getElementById('chapters-list');
  const badge = document.getElementById('chapters-total-badge');
  if (badge && chapters) {
    badge.textContent = `${chapters.length} Chapter (EN Mirror)`;
  }

  if (chapters.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="folder-x"></i>
        <h4>Tidak Ada Chapter Tersedia di English Mirror</h4>
        <p>Belum ada rilis chapter untuk komik ini di mirror.</p>
      </div>
    `;
    initIcons();
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

  let html = '';

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

  container.querySelectorAll('.mirror-matches-row .quick-tag-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const u = chip.dataset.url;
      container.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
      try {
        const res = await fetch(`/api/external/en/chapters?url=${encodeURIComponent(u)}`);
        const data = await res.json();
        const chs = data.chapters || [];
        const matchC = allMatchedComics.find(x => x.url === u) || { url: u, title: chip.textContent };
        state.activeEnglishComic = matchC;
        state.rawEnglishChapters = chs;
        renderEnglishChaptersList(chs, matchC, allMatchedComics);
      } catch (e) {
        showToast('Gagal memuat chapter untuk judul ini');
      }
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

  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const readerContainer = document.getElementById('view-reader');
  if (readerContainer) readerContainer.scrollTop = 0;

  const viewport = document.getElementById('reader-viewport');
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
  const currentOrder = btn?.dataset.order || 'asc';
  const newOrder = currentOrder === 'asc' ? 'desc' : 'asc';
  updateSortButtonLabel(newOrder);

  if (state.currentSource === 'mangadex') {
    state.currentSort = newOrder;
    if (state.allMangaDexChapters && state.allMangaDexChapters.length > 0) {
      state.allMangaDexChapters.reverse();
      filterAndRenderMangaDexChapters();
    } else if (state.currentManga) {
      loadChaptersFeed(state.currentManga.id);
    }
  } else if (state.currentSource === 'bacakomik') {
    state.mirrorOrder = newOrder;
    if (state.activeMirrorComic && state.rawMirrorChapters && state.rawMirrorChapters.length > 0) {
      renderBacakomikChaptersList(state.rawMirrorChapters, state.activeMirrorComic, state.matchedMirrorComics);
    }
  } else if (state.currentSource === 'english') {
    state.englishOrder = newOrder;
    if (state.activeEnglishComic && state.rawEnglishChapters && state.rawEnglishChapters.length > 0) {
      renderEnglishChaptersList(state.rawEnglishChapters, state.activeEnglishComic, state.matchedEnglishComics);
    }
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

// ==========================================
// READER IMAGE ENGINE: 3-STAGE AUTO-FALLBACK & WINDOWED CONCURRENCY
// ==========================================

/**
 * Stage 0: Internal hardened proxy (/api/proxy/image)
 * Stage 1: Direct URL with no-referrer & crossOrigin="anonymous"
 * Stage 2: Alternative proxy (wsrv.nl with &we=1&n=-1) + cache-bust ?t=...
 */
window.getReaderStageUrl = function (rawUrl, stage = 0, retryTimestamp = null) {
  if (!rawUrl) return '';
  // Local offline blob or base64 data URLs: always load directly
  if (rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) {
    return rawUrl;
  }

  // Ensure rawUrl is clean and not already multiply wrapped
  let cleanUrl = rawUrl;
  while (typeof cleanUrl === 'string' && (cleanUrl.startsWith('/api/proxy-image?url=') || cleanUrl.startsWith('/api/proxy/image?url='))) {
    cleanUrl = decodeURIComponent(cleanUrl.replace(/^\/api\/proxy[-/]image\?url=/, ''));
  }

  const isMangaDex = cleanUrl.includes('mangadex.org') || cleanUrl.includes('mangadex.network');

  if (isMangaDex) {
    // CRITICAL: Direct browser requests to uploads.mangadex.org from third-party websites
    // are ALWAYS intercepted by MangaDex Cloudflare to serve the "You can read this at MangaDex" banner.
    // Therefore, MangaDex images MUST always be loaded through our backend proxy!
    const qs = retryTimestamp ? `&retry=${retryTimestamp}` : '';
    if (stage === 0) {
      // Stage 0: Standard proxy
      return `/api/proxy/image?url=${encodeURIComponent(cleanUrl)}${qs}`;
    } else if (stage === 1) {
      // Stage 1: Fallback proxy with cache-bust & alternative routing
      const cacheBust = retryTimestamp || Date.now();
      return `/api/proxy/image?url=${encodeURIComponent(cleanUrl)}&t=${cacheBust}&stage=1`;
    } else {
      // Stage 2: Secondary proxy retry with timestamp
      const cacheBust = retryTimestamp || Date.now();
      return `/api/proxy/image?url=${encodeURIComponent(cleanUrl)}&t=${cacheBust}&retry=last`;
    }
  }

  // For other comic sources (Komikindo, Mangapill, etc.)
  if (stage === 0) {
    // Stage 0: Internal proxy
    const qs = retryTimestamp ? `&retry=${retryTimestamp}` : '';
    return `/api/proxy/image?url=${encodeURIComponent(cleanUrl)}${qs}`;
  } else if (stage === 1) {
    // Stage 1: Direct No-Referer
    const sep = cleanUrl.includes('?') ? '&' : '?';
    const qs = retryTimestamp ? `${sep}retry=${retryTimestamp}` : '';
    return cleanUrl + qs;
  } else if (stage === 2) {
    // Stage 2: wsrv.nl proxy
    const cacheBust = retryTimestamp || Date.now();
    return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&we=1&n=-1&t=${cacheBust}`;
  }
  return cleanUrl;
};

/**
 * Progressive loading activator for a single page image
 */
window.loadReaderPageImage = function (imgEl) {
  if (!imgEl) return;
  if (imgEl.dataset.startedLoading === 'true') return;
  imgEl.dataset.startedLoading = 'true';

  const rawUrl = imgEl.dataset.rawUrl;
  if (!rawUrl) return;

  imgEl.dataset.retryStage = '0';
  imgEl.removeAttribute('referrerpolicy');
  imgEl.crossOrigin = 'anonymous';
  imgEl.src = window.getReaderStageUrl(rawUrl, 0);
};

/**
 * Trigger subsequent page loads sequentially when a page finishes loading
 */
window.triggerNextPageLoad = function (imgEl) {
  const pageNum = parseInt(imgEl.dataset.page || '0', 10);
  if (!pageNum) return;

  // Preload next 2 pages in sequence for silky smooth progressive scrolling
  for (let offset = 1; offset <= 2; offset++) {
    const nextWrap = document.querySelector(`.reader-page-wrapper[data-page="${pageNum + offset}"]`);
    if (nextWrap) {
      const nextImg = nextWrap.querySelector('.reader-page-img');
      if (nextImg && nextImg.dataset.startedLoading !== 'true') {
        window.loadReaderPageImage(nextImg);
      }
    }
  }
};

/**
 * Handle successful page image load
 */
window.handlePageImageLoad = function (imgEl) {
  // Client-side guard against MangaDex Anti-Hotlink Placeholder Banner:
  // MangaDex banner is exactly 600x642 (or ~59,480 bytes) with cat mascot icons
  // Real manga panels are either tall webtoon vertical strips or standard tankobon pages
  if (imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
    const isMangaDexBanner = (imgEl.naturalWidth === 600 && imgEl.naturalHeight === 642) ||
      (Math.abs(imgEl.naturalWidth - 600) <= 20 && Math.abs(imgEl.naturalHeight - 642) <= 20) ||
      (Math.abs(imgEl.naturalWidth - imgEl.naturalHeight) <= 60 && imgEl.naturalWidth >= 550 && imgEl.naturalWidth <= 650);

    if (isMangaDexBanner) {
      console.warn(`[ReaderImage] Intercepted MangaDex placeholder banner (${imgEl.naturalWidth}x${imgEl.naturalHeight}). Discarding and recovering...`);
      imgEl.classList.remove('visible');

      // If loaded from corrupt offline Dexie storage, auto-purge the corrupt chapter and reload fresh online
      if (imgEl.src && imgEl.src.startsWith('blob:') && state.currentChapterId && window.OfflineManager) {
        window.OfflineManager.deleteChapter(state.currentChapterId, true).then(() => {
          console.log('[ReaderImage] Purged corrupt offline chapter. Reloading fresh online...');
          openReader(state.currentChapterId, state.currentChapterIndex);
        });
        return;
      }

      window.handlePageImageError(imgEl);
      return;
    }
  }

  // Hide skeleton in single mode if present
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

  // Trigger progressive next-page pipeline
  window.triggerNextPageLoad(imgEl);
};

/**
 * Multi-Stage Auto-Fallback Error Handler
 */
window.handlePageImageError = function (imgEl) {
  const wrapper = imgEl.closest('.reader-page-wrapper') || imgEl.parentElement;
  if (!wrapper) return;

  const rawUrl = imgEl.dataset.rawUrl;
  const pageNum = parseInt(imgEl.dataset.page || '1', 10);
  let stage = parseInt(imgEl.dataset.retryStage || '0', 10);

  // If stage 0 or 1 failed, automatically advance to next stage without showing error UI
  if (stage < 2) {
    const nextStage = stage + 1;
    imgEl.dataset.retryStage = String(nextStage);

    if (nextStage === 1) {
      // Stage 1
      imgEl.referrerPolicy = 'no-referrer';
      imgEl.crossOrigin = 'anonymous';
      imgEl.src = window.getReaderStageUrl(rawUrl, 1);
      return;
    } else if (nextStage === 2) {
      // Stage 2
      imgEl.removeAttribute('crossorigin');
      imgEl.removeAttribute('referrerpolicy');
      imgEl.src = window.getReaderStageUrl(rawUrl, 2, Date.now());
      return;
    }
  }

  // Stage 3: All 3 automated fallback routes failed! Display the error card with "Muat Ulang"
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

  retryCard.querySelector('.btn-retry-page').addEventListener('click', (e) => {
    e.stopPropagation();
    retryCard.remove();
    if (skeleton) skeleton.classList.remove('fade-out');
    imgEl.classList.remove('visible');

    // Reset retryStage to 0 and add ?retry=${Date.now()}
    imgEl.dataset.retryStage = '0';
    imgEl.removeAttribute('referrerpolicy');
    imgEl.crossOrigin = 'anonymous';
    const retryTimestamp = Date.now();
    imgEl.src = window.getReaderStageUrl(rawUrl, 0, retryTimestamp);
  });

  wrapper.appendChild(retryCard);
  if (window.lucide) window.lucide.createIcons({ root: retryCard });
};

async function openReader(chapterId, chapterIndex) {
  state.isExternal = false;
  state.currentChapterId = chapterId;
  state.currentChapterIndex = chapterIndex;
  state.currentPageIndex = 0;
  state.currentSingleSlice = 0;
  state.isAutoNavigatingNext = false;

  switchView('reader');

  // Instant scroll to top (No smooth scroll stutter)
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const readerContainer = document.getElementById('view-reader');
  if (readerContainer) readerContainer.scrollTop = 0;

  // Title and Chapter numbers
  const mangaTitle = getMangaTitle(state.currentManga?.attributes);
  const chObj = state.currentChapters[chapterIndex] || state.allMangaDexChapters.find(c => c.id === chapterId);
  const chNum = chObj?.attributes?.chapter ? `Chapter ${chObj.attributes.chapter}` : 'Special Chapter';
  if (chObj?.attributes?.translatedLanguage) {
    state.currentReadingLang = chObj.attributes.translatedLanguage;
  }

  // Instant Chapter Transition Skeleton Stream (Never stuck on finished card)
  const viewport = document.getElementById('reader-viewport');
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

  document.getElementById('reader-manga-title').textContent = mangaTitle;
  document.getElementById('reader-chapter-title').textContent = chNum;
  const footerPill = document.getElementById('footer-chapter-pill');
  if (footerPill) footerPill.textContent = chNum;

  // Ensure bars are visible when opening new chapter
  document.getElementById('reader-toolbar')?.classList.remove('hidden-bar');
  document.getElementById('reader-footer')?.classList.remove('hidden-bar');

  // Populate Custom Chapter Dropdown in toolbar
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
      const offlinePages = await OfflineManager.getOfflinePages(chapterId);
      const hasCorrupt = !offlinePages || offlinePages.length === 0 || offlinePages.some(p => !p.blob || (p.blob.size >= 59400 && p.blob.size <= 59600));

      if (hasCorrupt) {
        console.warn(`[Reader] Chapter ${chapterId} has corrupted/banner pages in IndexedDB. Purging and loading fresh from server...`);
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

/**
 * Smart Auto-Detect Reader Mode:
 * Detects whether a title is a continuous Webtoon (Manhwa/Manhua/Web Comic)
 * or a traditional discrete Manga (Single Page per screen).
 */
function detectOptimalReaderMode(manga, pages) {
  // Layer 1: MangaDex Metadata Inspection
  if (manga && manga.attributes) {
    const attrs = manga.attributes;
    const lang = (attrs.originalLanguage || '').toLowerCase();

    // Korean (Manhwa) and Chinese (Manhua) are universally long-strip webtoons
    if (lang === 'ko' || lang === 'zh' || lang === 'zh-hk' || lang === 'zh-ro') {
      return 'long-strip';
    }

    // Check tags: 'Long Strip' or 'Web Comic'
    if (Array.isArray(attrs.tags)) {
      const hasLongStripTag = attrs.tags.some(t => {
        const name = (t.attributes?.name?.en || '').toLowerCase();
        return name.includes('long strip') || name.includes('web comic');
      });
      if (hasLongStripTag) return 'long-strip';
    }

    // Japanese manga without long-strip tag is traditional single-page format
    if (lang === 'ja') {
      return 'single';
    }
  }

  // Layer 2: External mirrors (Komikindo, Bacakomik, etc.) - check title / type keywords
  const titleString = [
    manga?.title,
    manga?.type,
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

  // Default fallback
  return 'long-strip';
}

function renderReaderPages(data) {
  const viewport = document.getElementById('reader-viewport');
  viewport.innerHTML = '';

  const readerContainer = document.getElementById('view-reader');
  if (readerContainer) {
    readerContainer.scrollTop = 0;
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  requestAnimationFrame(() => {
    if (readerContainer) readerContainer.scrollTop = 0;
  });

  // Quality selection: prioritize data-saver for manhwa > 30 pages and by default (unless user explicitly selected 'original')
  const isHighPageChapter = (data.totalPages > 30) || (data.pages && data.pages.length > 30);
  const useDataSaver = state.readerQuality === 'dataSaver' || (state.readerQuality !== 'original') || isHighPageChapter;
  const pages = (useDataSaver && data.dataSaverPages && data.dataSaverPages.length > 0)
    ? data.dataSaverPages
    : (data.pages || data.dataSaverPages || []);
  const total = pages.length;

  // Smart Auto-Detect Reader Mode (Webtoon for long continuous strips, Single for Manga)
  if (state.readerModePreference === 'auto') {
    state.readerMode = detectOptimalReaderMode(state.currentManga, pages);

    // Update Auto status indicator in menu
    const autoStatusEl = document.getElementById('mode-auto-status');
    if (autoStatusEl) {
      autoStatusEl.textContent = state.readerMode === 'long-strip' 
        ? 'Auto: Webtoon (Aktif)' 
        : 'Auto: Single (Aktif)';
    }

    // Layer 3: Physical Image Aspect Ratio Probe on first page to guarantee 100% precision
    if (pages.length > 0) {
      const probeImg = new Image();
      probeImg.src = window.getReaderStageUrl(pages[0], 0);
      const verifyRatio = () => {
        if (probeImg.naturalWidth > 0 && probeImg.naturalHeight > 0) {
          const ratio = probeImg.naturalHeight / probeImg.naturalWidth;
          // Standard manga tankobon page is <= 1.6x height/width. Webtoon continuous strip is > 1.65x
          const probedMode = ratio > 1.65 ? 'long-strip' : 'single';
          if (state.readerModePreference === 'auto' && probedMode !== state.readerMode) {
            state.readerMode = probedMode;
            renderReaderPages(data);
          }
        }
      };
      if (probeImg.complete && probeImg.naturalWidth > 0) {
        const ratio = probeImg.naturalHeight / probeImg.naturalWidth;
        state.readerMode = ratio > 1.65 ? 'long-strip' : 'single';
      } else {
        probeImg.onload = verifyRatio;
      }
    }
  } else {
    state.readerMode = state.readerModePreference;
  }

  document.getElementById('page-counter-text').textContent = `1 / ${total}`;

  if (state.readerMode === 'long-strip') {
    viewport.className = 'reader-viewport long-strip-mode';

    // Disconnect old observer if active
    if (window.readerPageObserver) {
      window.readerPageObserver.disconnect();
      window.readerPageObserver = null;
    }

    // Setup windowed progressive IntersectionObserver with rootMargin: 1500px 0px
    window.readerPageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const wrap = entry.target;
          const img = wrap.querySelector('.reader-page-img');
          if (img && img.dataset.startedLoading !== 'true') {
            window.loadReaderPageImage(img);
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
          onload="handlePageImageLoad(this)"
          onerror="handlePageImageError(this)"
        >
        <span class="reader-page-number">${pageNum} / ${total}</span>
      `;
      viewport.appendChild(pageWrap);

      const img = pageWrap.querySelector('img');

      // Windowed Concurrency Limit:
      // Initial batch: Only load Pages 1 to 4 immediately
      if (idx < 4) {
        window.loadReaderPageImage(img);
      } else {
        // Pages 5+ are queued and activated via IntersectionObserver OR prior image onLoad
        window.readerPageObserver.observe(pageWrap);
      }
    });

    // Append Webtoon Chapter End Card (No checkmark icon, compact chapter switcher)
    const endCard = document.createElement('div');
    endCard.className = 'webtoon-chapter-end-card';
    endCard.id = 'webtoon-end-card';
    const chTitleText = document.getElementById('reader-chapter-title')?.textContent || 'Chapter ini';
    const nextCandidate = findSmartNextChapter();

    // Prepare chapters for end-card selector
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
      <!-- Compact Chapter Selector (Replaces checkmark) -->
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

    // Dropdown interaction in End Card
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

  // Preload neighboring next page for instant page-flipping
  if (state.currentPageIndex < total - 1) {
    const preloadImg = new Image();
    preloadImg.src = window.getReaderStageUrl(pages[state.currentPageIndex + 1], 0);
  }

  // Inspect image dimensions to check if it's a tall strip (webtoon)
  const testImg = new Image();
  testImg.src = window.getReaderStageUrl(currentUrl, 0);

  const renderContent = () => {
    // If in Auto mode and first image is a long strip, dynamically switch to webtoon mode
    if (state.readerModePreference === 'auto' && testImg.naturalWidth > 0 && (testImg.naturalHeight / testImg.naturalWidth) > 1.65) {
      state.readerMode = 'long-strip';
      if (state.currentChapterData) {
        renderReaderPages(state.currentChapterData);
        return;
      }
    }

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
            <img 
              src="${window.getReaderStageUrl(currentUrl, 0)}" 
              class="single-page-slice-img" 
              style="transform: translateY(-${offsetPercent}%);" 
              alt="Halaman ${state.currentPageIndex + 1} Panel ${currSlice + 1}"
              data-page="${state.currentPageIndex + 1}"
              data-raw-url="${currentUrl}"
              data-retry-stage="0"
              onload="window.handlePageImageLoad(this)"
              onerror="handlePageImageError(this)"
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
      // Standard book-format Manga page
      document.getElementById('page-counter-text').textContent = `${state.currentPageIndex + 1} / ${total}`;

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
            src="${window.getReaderStageUrl(currentUrl, 0)}" 
            class="single-page-img" 
            alt="Halaman ${state.currentPageIndex + 1}"
            data-page="${state.currentPageIndex + 1}"
            data-raw-url="${currentUrl}"
            data-retry-stage="0"
            onload="window.handlePageImageLoad(this)"
            onerror="handlePageImageError(this)"
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
          src="${window.getReaderStageUrl(currentUrl, 0)}" 
          class="single-page-img" 
          alt="Halaman ${state.currentPageIndex + 1}"
          data-page="${state.currentPageIndex + 1}"
          data-raw-url="${currentUrl}"
          data-retry-stage="0"
          onload="const sk = document.getElementById('single-page-skeleton'); if (sk) sk.style.display = 'none'; this.classList.add('visible');"
          onerror="handlePageImageError(this)"
        >
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
          <img 
            src="${window.getReaderStageUrl(page1Url, 0)}" 
            class="double-page-img" 
            alt="Halaman ${page1Index + 1}"
            data-page="${page1Index + 1}"
            data-raw-url="${page1Url}"
            data-retry-stage="0"
            onload="window.handlePageImageLoad(this)"
            onerror="handlePageImageError(this)"
          >
          <span class="double-page-tag">${page1Index + 1}</span>
        </div>
        ${page2Url ? `
          <div class="double-page-item right">
            <img 
              src="${window.getReaderStageUrl(page2Url, 0)}" 
              class="double-page-img" 
              alt="Halaman ${page2Index + 1}"
              data-page="${page2Index + 1}"
              data-raw-url="${page2Url}"
              data-retry-stage="0"
              onload="window.handlePageImageLoad(this)"
              onerror="handlePageImageError(this)"
            >
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
        prevText.textContent = isAtStart ? 'Chapter Sblm' : 'Prev';
      }
    }

    // Next Button
    if (nextBtn) {
      nextBtn.disabled = isAtEnd && !hasNextChapter;
      nextBtn.style.opacity = (isAtEnd && !hasNextChapter) ? '0.35' : '1';
      if (nextText) {
        nextText.textContent = isAtEnd ? 'Chapter Lanjut' : 'Next';
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
    // Sync active selection in mode menu
    document.querySelectorAll('.reader-mode-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === state.readerModePreference);
    });
    const autoStatusEl = document.getElementById('mode-auto-status');
    if (autoStatusEl && state.readerModePreference === 'auto') {
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

  // Mode Options inside 3-dots Menu
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

    // Auto-navigate to next chapter at bottom in Webtoon mode (instant, no stutter)
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

  // Tap / Click reader viewport to toggle toolbars (convenient for mobile and desktop)
  document.getElementById('reader-viewport')?.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('select') || e.target.closest('a') || e.target.closest('.nav-click-zone')) return;
    isBarsVisible = !isBarsVisible;
    toolbar?.classList.toggle('hidden-bar', !isBarsVisible);
    footer?.classList.toggle('hidden-bar', !isBarsVisible);
  });

  // Touch Swipe for Single / Double Mode in Reader (Mobile Friendly)
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

    // Horizontal swipe threshold: > 45px and predominantly horizontal
    if (Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.4) {
      if (diffX < 0) {
        // Swipe left -> Next Page / Chapter
        handleReaderNext();
      } else {
        // Swipe right -> Previous Page / Chapter
        handleReaderPrev();
      }
    }
  }, { passive: true });
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

/**
 * Directly resumes reading at the last read chapter (online or offline),
 * bypassing having to manually pick chapters again.
 */
async function resumeReadingChapter(mangaId, chapterId, chapterNum) {
  showToast(`Melanjutkan ${chapterNum || 'chapter'}...`);

  // 1. Check if chapter is saved offline in IndexedDB
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

  // 2. MangaDex Online Chapter
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

    if (!state.currentChapters || state.currentChapters.length === 0 || state.currentChapters[0]?.mangaId !== mangaId) {
      try {
        const chRes = await fetch(`/api/manga/${mangaId}/chapters`);
        if (chRes.ok) {
          const chData = await chRes.json();
          state.allMangaDexChapters = chData.data || [];
          state.currentChapters = filterChaptersByLang(state.allMangaDexChapters, state.currentLang);
        }
      } catch (e) {}
    }

    const idx = state.currentChapters.findIndex(c => c.id === chapterId);
    openReader(chapterId, idx !== -1 ? idx : 0);
    return;
  }

  // 3. Mirror Online Chapter
  if (chapterId && chapterId.startsWith('http')) {
    if (mangaId.includes('english') || chapterId.includes('asuracomic') || chapterId.includes('flamecomic')) {
      state.currentSource = 'english';
      openEnglishReader(chapterId, chapterNum || 'Chapter', state.englishChapters || [{ url: chapterId, title: chapterNum || 'Chapter' }], 0);
    } else {
      state.currentSource = 'bacakomik';
      openExternalReader(chapterId, chapterNum || 'Chapter', state.externalChapters || [{ url: chapterId, title: chapterNum || 'Chapter' }], 0);
    }
    return;
  }

  // Fallback to detail
  openMangaDetail(mangaId);
}
window.resumeReadingChapter = resumeReadingChapter;

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
    const safeChNum = (item.chapterNum || '').replace(/'/g, "\\'");

    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <img src="${isPlaceholder ? 'https://placehold.co/300x420/1e2025/ffffff?text=Cover' : coverSrc}" 
           class="history-thumb" 
           alt="${item.title}" 
           data-manga-id="${item.mangaId || ''}"
           data-manga-title="${item.title || ''}"
           style="cursor: pointer;"
           onclick="openMangaDetail('${item.mangaId}')"
           onerror="resolveMissingHistoryCover(this, '${safeTitle}', '${item.mangaId || ''}')">
      <div class="history-info" style="cursor: pointer;" onclick="openMangaDetail('${item.mangaId}')">
        <h4 class="history-title">${item.title}</h4>
        <div class="history-chapter">Terakhir dibaca: <strong>${item.chapterNum}</strong></div>
        <div class="history-date">Dibaca pada ${dateStr}</div>
      </div>
      <button class="btn-primary" onclick="resumeReadingChapter('${item.mangaId}', '${item.chapterId}', '${safeChNum}')">
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
            <i data-lucide="play"></i> Lanjut Baca
          </button>
          <button class="btn-delete-download" title="Hapus seluruh data offline manga ini" data-del-id="${m.id}">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;

    // Click Lanjut Baca: directly launches reader at the last read chapter (or first downloaded)
    card.querySelector('.btn-read-offline')?.addEventListener('click', async () => {
      const chs = await OfflineManager.db.chapters.where('mangaId').equals(m.id).toArray();
      if (chs.length > 0) {
        const sortedChs = chs.sort((a, b) => parseFloat(a.chapterNumber || '0') - parseFloat(b.chapterNumber || '0'));
        
        // Find last read chapter from shared reading history
        const historyList = getStoredList(STORAGE_KEY_HISTORY);
        const lastRead = historyList.find(h => h.mangaId === m.id);

        let targetCh = null;
        if (lastRead) {
          targetCh = sortedChs.find(c => c.id === lastRead.chapterId);
          if (!targetCh && lastRead.chapterNum) {
            const cleanNum = lastRead.chapterNum.replace(/[^\d.]/g, '');
            if (cleanNum) {
              targetCh = sortedChs.find(c => String(c.chapterNumber) === cleanNum);
            }
          }
        }
        if (!targetCh) {
          targetCh = sortedChs[0];
        }

        const targetIndex = sortedChs.findIndex(c => c.id === targetCh.id);
        const resolvedIndex = targetIndex !== -1 ? targetIndex : 0;

        // Check if pages are corrupted from previous old download
        const validPages = await OfflineManager.getOfflinePages(targetCh.id);
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
          openEnglishReader(targetCh.id, targetCh.title, allExternal, resolvedIndex);
        } else if (m.source === 'bacakomik') {
          state.isExternal = true;
          const allExternal = sortedChs.map(c => ({
            url: c.id,
            title: c.title,
            num: parseFloat(c.chapterNumber || '1')
          }));
          state.externalChapters = allExternal;
          openExternalReader(targetCh.id, targetCh.title, allExternal, resolvedIndex);
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
          openReader(targetCh.id, resolvedIndex);
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
