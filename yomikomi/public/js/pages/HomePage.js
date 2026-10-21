/**
 * HomePage
 * Featured Hero slider, Filter tabs, Genre modal & chips, and Manga grid
 */

import {
  state,
  initIcons,
  showToast,
  getMangaTitle,
  getCoverUrl,
  CoverCache,
  getStoredList,
  STORAGE_KEY_HISTORY,
  getAnimeHistory,
  MANGADEX_GENRES,
  MANGADEX_POPULAR_THEMES,
  MANGADEX_FORMATS,
  MANGADEX_CONTENT_WARNINGS
} from '../state.js';
import { renderHeroBanner } from '../components/HeroBanner.js';
import { fetchKomikuLatest } from '../services/api.js';
import { attachMangaCardHoverPrefetch } from '../services/mangaCache.js';

export function renderHomePageMarkup() {
  return `
    <section class="view-section active" id="view-home">
      <!-- Hero Featured Carousel -->
      <div class="hero-carousel-container" id="hero-carousel">
        <div class="hero-skeleton skeleton-pulse"></div>
      </div>

      <!-- Horizontal Continue Reading / Watching Row ("▶️ Lanjutkan") -->
      <div class="continue-section hidden" id="continue-section">
        <div class="continue-header">
          <div class="continue-title-wrap">
            <h3 class="continue-title">Lanjutkan</h3>
          </div>
          <button class="continue-see-all-btn" id="btn-continue-all" type="button">Lihat Riwayat</button>
        </div>
        <div class="continue-cards-grid" id="continue-cards-grid">
          <!-- Populated dynamically by renderContinueRow() -->
        </div>
      </div>

      <!-- Quick Filter & Tags Bar -->
      <div class="filter-bar">
        <div class="filter-tabs" id="filter-tabs-container">
          <!-- Populated dynamically by renderFilterTabs() -->
        </div>

        <!-- Genre Full Grid Modal / Dropdown Panel -->
        <div class="genre-modal-backdrop hidden" id="genre-modal-backdrop"></div>
        <div class="genre-modal-panel hidden" id="genre-modal-panel">
          <div class="genre-modal-header">
            <div class="genre-modal-title">
              <i data-lucide="tag"></i>
              <span>Katalog Semua Genre Komik</span>
            </div>
            <button class="genre-modal-close" id="btn-close-genre-modal" aria-label="Tutup" type="button">
              <i data-lucide="x"></i>
            </button>
          </div>
          <div class="genre-modal-search-wrap">
            <i data-lucide="search"></i>
            <input type="text" id="genre-modal-search-input" placeholder="Cari genre... (misal: Romance, Action, Isekai)" autocomplete="off">
            <button class="genre-modal-clear-search hidden" id="btn-clear-genre-search" type="button" aria-label="Hapus Pencarian">
              <i data-lucide="x"></i>
            </button>
          </div>
          <div class="genre-modal-body" id="genre-modal-body">
            <!-- Rendered by JS -->
          </div>
        </div>
      </div>

      <!-- Manga Grid Section -->
      <div class="section-header">
        <div class="section-title-wrap">
          <h2 class="section-title" id="grid-section-title">Komik Sedang Tren</h2>
          <span class="section-badge" id="grid-count-badge">20 Judul</span>
        </div>
      </div>

      <div class="manga-grid" id="manga-grid">
        <div class="grid-loading-placeholder">
          <div class="card-skeleton skeleton-pulse"></div>
          <div class="card-skeleton skeleton-pulse"></div>
          <div class="card-skeleton skeleton-pulse"></div>
          <div class="card-skeleton skeleton-pulse"></div>
          <div class="card-skeleton skeleton-pulse"></div>
          <div class="card-skeleton skeleton-pulse"></div>
        </div>
      </div>
    </section>
  `;
}

export function showGridSkeleton() {
  const grid = document.getElementById('manga-grid');
  if (grid) {
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
}

export function renderContinueRow() {
  const container = document.getElementById('continue-cards-grid');
  const section = document.getElementById('continue-section');
  if (!container || !section) return;

  const isAnimeMode = state.activeMediaMode === 'anime';
  const animeHist = getAnimeHistory();
  const mangaHist = getStoredList(STORAGE_KEY_HISTORY);

  let items = [];
  if (isAnimeMode) {
    items = animeHist.length > 0 
      ? animeHist.map(h => ({ ...h, mediaType: 'anime' }))
      : mangaHist.map(h => ({ ...h, mediaType: 'manga' }));
  } else {
    items = mangaHist.length > 0 
      ? mangaHist.map(h => ({ ...h, mediaType: 'manga' }))
      : animeHist.map(h => ({ ...h, mediaType: 'anime' }));
  }

  const validItems = items.filter(it => it && (it.mangaId || it.animeId || it.id)).slice(0, 4);

  if (validItems.length === 0) {
    section.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');
  container.innerHTML = '';

  validItems.forEach(item => {
    const isItemAnime = item.mediaType === 'anime' || !!item.animeId;
    let title = 'Untitled';
    if (typeof item.title === 'string' && item.title !== '[object Object]') {
      title = item.title;
    } else if (typeof item.title === 'object' && item.title !== null) {
      title = item.title.romaji || item.title.english || item.title.native || item.mangaTitle || 'Untitled';
    } else if (item.titleObj) {
      title = item.titleObj.romaji || item.titleObj.english || item.titleObj.native || 'Untitled';
    } else if (item.mangaTitle) {
      title = item.mangaTitle;
    }

    let coverUrl = item.coverUrl && !item.coverUrl.includes('placehold.co') ? item.coverUrl : null;
    if (!coverUrl && isItemAnime) {
      const foundAnime = [...(state.popularAnime || []), ...(state.seasonalAnime || []), ...(state.latestAnime || [])].find(a => String(a.id) === String(item.animeId));
      if (foundAnime && foundAnime.coverUrl) {
        coverUrl = foundAnime.coverUrl;
        item.coverUrl = foundAnime.coverUrl;
      }
    }
    if (!coverUrl) {
      coverUrl = isItemAnime ? 'https://placehold.co/100x140/1e2025/ffffff?text=Anime' : 'https://placehold.co/100x140/1e2025/ffffff?text=Cover';
    }
    const lastLabel = isItemAnime 
      ? (item.episodeTitle || `Ep. ${item.episode || 1}`) 
      : (item.chapterNum ? `Ch. ${item.chapterNum}` : (item.chapterTitle || 'Chapter'));
    const progress = item.progress || (item.pageIndex && item.totalPages ? `${Math.round(((item.pageIndex + 1) / item.totalPages) * 100)}%` : '85%');

    const card = document.createElement('div');
    card.className = 'continue-card';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="continue-poster-wrap">
        <img class="continue-poster" src="${coverUrl}" alt="${title}" loading="lazy" onerror="this.src='https://placehold.co/100x140/1e2025/ffffff?text=Cover';">
        <span class="continue-type-badge">${isItemAnime ? 'Anime' : 'Komik'}</span>
      </div>
      <div class="continue-info">
        <h4 class="continue-item-title" title="${title}">${title}</h4>
        <div class="continue-badge-row">
          <span class="continue-chapter-badge">${lastLabel}</span>
        </div>
        <div class="continue-progress-wrap">
          <div class="continue-progress-bar">
            <div class="continue-progress-fill" style="width: ${progress};"></div>
          </div>
        </div>
      </div>
      <button class="continue-action-btn" type="button" title="Lanjut ${isItemAnime ? 'Nonton' : 'Baca'}">
        <i data-lucide="play"></i>
      </button>
    `;

    const handleAction = () => {
      if (isItemAnime) {
        if (typeof window.openAnimeWatch === 'function') {
          window.openAnimeWatch(item.animeId || item.id, item.episode || 1, item);
        }
      } else {
        if (typeof window.resumeReadingChapter === 'function') {
          window.resumeReadingChapter(item.mangaId || item.id, item.chapterId, item.chapterNum, item);
        } else if (typeof window.openMangaDetail === 'function') {
          window.openMangaDetail(item.mangaId || item.id);
        }
      }
    };

    card.addEventListener('click', handleAction);
    container.appendChild(card);
  });

  document.getElementById('btn-continue-all')?.addEventListener('click', () => {
    if (typeof window.switchView === 'function') {
      window.switchView('history');
      if (typeof window.switchCollectionTab === 'function') {
        window.switchCollectionTab(isAnimeMode ? 'anime-history' : 'history');
      }
    }
  });

  initIcons();
}

export function renderFilterTabs(activeMode = state.activeMediaMode) {
  const container = document.getElementById('filter-tabs-container');
  if (!container) return;

  const isAnime = activeMode === 'anime';

  if (isAnime) {
    container.innerHTML = `
      <button class="filter-tab active" data-filter="anime-popular">Semua Anime</button>
      <button class="filter-tab" data-filter="anime-seasonal">Sedang Tayang (Seasonal)</button>
      <button class="filter-tab" data-filter="anime-popular">Paling Populer</button>
      <button class="filter-tab" data-filter="anime-subindo">Sub Indo</button>
      <button class="filter-tab" data-filter="anime-movies">Movie</button>
      <button class="filter-tab genre-dropdown-toggle" id="btn-genre-toggle" type="button" aria-expanded="false" title="Pilih Genre">
        <i data-lucide="tag"></i>
        <span id="genre-toggle-text">Filter Genre</span>
        <i data-lucide="chevron-down" class="dropdown-chevron" id="genre-toggle-chevron"></i>
      </button>
    `;
  } else {
    container.innerHTML = `
      <button class="filter-tab active" data-filter="all">Semua Komik</button>
      <button class="filter-tab" data-filter="popular">Paling Populer</button>
      <button class="filter-tab" data-filter="latest">Baru Diupdate</button>
      <button class="filter-tab" data-filter="indo">🇮🇩 Indo Scan</button>
      <button class="filter-tab" data-filter="english">🇬🇧 English</button>
      <button class="filter-tab genre-dropdown-toggle" id="btn-genre-toggle" type="button" aria-expanded="false" title="Pilih Genre Komik">
        <i data-lucide="tag"></i>
        <span id="genre-toggle-text">Filter Genre</span>
        <i data-lucide="chevron-down" class="dropdown-chevron" id="genre-toggle-chevron"></i>
      </button>
    `;
  }

  initFilters();
  initGenreFilter();
  initIcons();
}

export function renderMediaGrid(mediaList, mediaType = state.activeMediaMode) {
  const grid = document.getElementById('manga-grid');
  const countBadge = document.getElementById('grid-count-badge');
  if (countBadge) countBadge.textContent = `${mediaList.length} Judul`;

  if (!grid) return;

  if (!mediaList || mediaList.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i data-lucide="${mediaType === 'anime' ? 'film' : 'book-x'}"></i>
        <h3>Tidak Ada ${mediaType === 'anime' ? 'Anime' : 'Komik'} Ditemukan</h3>
        <p>Coba gunakan kata kunci lain atau pilih filter yang berbeda.</p>
      </div>
    `;
    initIcons();
    return;
  }

  grid.innerHTML = '';
  mediaList.forEach((item) => {
    const isAnime = mediaType === 'anime' || item.mediaType === 'anime';
    const isKomiku = item.source === 'komiku' || item.id?.toString().startsWith('komiku-');
    const title = isAnime ? item.title : (isKomiku ? item.title : getMangaTitle(item.attributes));
    const coverUrl = isAnime ? item.coverUrl : (isKomiku ? item.coverUrl : getCoverUrl(item));
    const status = isAnime
      ? (item.status || 'RELEASING').toUpperCase()
      : (isKomiku 
          ? (item.status ? item.status.toUpperCase() : 'ONGOING') 
          : (item.attributes?.status ? item.attributes.status.toUpperCase() : 'ONGOING'));
    
    // Rating badge (e.g. ⭐ 8.4)
    let rating = isAnime ? item.rating : '';
    if (!rating && item.attributes?.rating) rating = `⭐ ${item.attributes.rating}`;
    if (!rating && item.averageScore) rating = `⭐ ${(item.averageScore / 10).toFixed(1)}`;

    // Latest chapter / episode badge
    const lastBadge = isAnime
      ? (item.latestEpisode || `Ep. ${item.episodes || '1'} • Sub`)
      : (isKomiku
          ? (item.latestChapter || item.lastChapter || 'Update')
          : (item.attributes?.lastChapter ? `Ch. ${item.attributes.lastChapter}` : 'Update'));

    const formatBadge = isAnime ? (item.format || 'ANIME') : (item.type || 'MANGA');

    const card = document.createElement('article');
    card.className = `manga-card ${isAnime ? 'anime-card' : ''}`;
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="card-poster">
        <img src="${coverUrl}" alt="${title}" loading="lazy" decoding="async" onerror="this.src='https://placehold.co/300x420/1e2025/ffffff?text=Cover';">
        <div class="card-overlay-gradient"></div>
        <span class="card-status-badge ${status.toLowerCase()}">${status}</span>
        ${rating ? `<span class="card-rating-badge">${rating}</span>` : ''}
        <span class="card-episode-badge">${lastBadge}</span>
      </div>
      <div class="card-content">
        <h3 class="card-title" title="${title}">${title}</h3>
        <div class="card-meta">
          <span>${formatBadge}</span>
          <div class="card-languages">
            ${isAnime ? '<span class="lang-flag" title="Subtitle Indonesia">🇮🇩 Sub</span>' : ''}
            ${!isAnime && isKomiku ? '<span class="lang-flag" title="Tersedia Bahasa Indonesia">🇮🇩 ID</span>' : ''}
            ${!isAnime && !isKomiku && item.attributes?.availableTranslatedLanguages?.includes('id') ? '<span class="lang-flag" title="Tersedia Bahasa Indonesia">🇮🇩</span>' : ''}
            ${!isAnime && !isKomiku && item.attributes?.availableTranslatedLanguages?.includes('en') ? '<span class="lang-flag" title="Tersedia English">🇬🇧</span>' : ''}
          </div>
        </div>
      </div>
    `;

    if (!isAnime) {
      attachMangaCardHoverPrefetch(card, item.id, item);
    }

    card.addEventListener('click', () => {
      if (isAnime) {
        if (typeof window.openAnimeWatch === 'function') {
          window.openAnimeWatch(item.id, 1, item);
        }
      } else {
        if (typeof window.openMangaDetail === 'function') {
          window.openMangaDetail(item.id, item);
        }
      }
    });
    grid.appendChild(card);
  });

  initIcons();
}

// Backward compatibility alias
export const renderMangaGrid = renderMediaGrid;

export async function loadPopularManga() {
  const sectionTitle = document.getElementById('grid-section-title');
  if (sectionTitle) sectionTitle.textContent = 'Komik Paling Populer (Trending)';

  // Instant 0ms render from memory or sessionStorage cache
  if (!state.popularManga || state.popularManga.length === 0) {
    try {
      const cached = sessionStorage.getItem('yomikomi_popular_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          state.popularManga = parsed;
          state.mangaList = parsed;
          renderMangaGrid(parsed);
          if (parsed.length >= 3) {
            state.heroManga = parsed.slice(0, 5);
            if (state.activeMediaMode !== 'anime') {
              renderHeroBanner(state.heroManga);
            }
          }
        }
      }
    } catch (e) {}
  } else {
    renderMangaGrid(state.popularManga);
    if (state.activeMediaMode !== 'anime' && (state.heroManga?.length >= 3 || state.popularManga?.length >= 3)) {
      renderHeroBanner(state.heroManga || state.popularManga.slice(0, 5));
    }
  }

  // Only show skeleton if zero data is cached
  if (!state.mangaList || state.mangaList.length === 0) {
    showGridSkeleton();
  }

  try {
    const res = await fetch('/api/popular');
    const data = await res.json();
    const freshList = (data.data || []).map(m => ({ ...m, source: 'mangadex' }));
    state.popularManga = freshList;
    state.mangaList = freshList;
    try {
      sessionStorage.setItem('yomikomi_popular_cache', JSON.stringify(freshList));
    } catch (e) {}

    freshList.forEach(m => {
      CoverCache.set(m.id, getMangaTitle(m.attributes), getCoverUrl(m));
    });
    renderMangaGrid(freshList);

    if (freshList.length >= 3) {
      state.heroManga = freshList.slice(0, 5);
      if (state.activeMediaMode !== 'anime') {
        renderHeroBanner(state.heroManga);
      }
    }
  } catch (error) {
    console.error('Failed to load popular manga:', error);
    if (!state.mangaList || state.mangaList.length === 0) {
      showToast('Gagal memuat manga populer');
    }
  }
}
window.loadPopularManga = loadPopularManga;

export async function loadLatestManga() {
  const sectionTitle = document.getElementById('grid-section-title');
  if (sectionTitle) sectionTitle.textContent = 'Rilis Chapter Terbaru';
  showGridSkeleton();

  try {
    const res = await fetch('/api/latest');
    const data = await res.json();
    state.mangaList = (data.data || []).map(m => ({ ...m, source: 'mangadex' }));
    renderMangaGrid(state.mangaList);
  } catch (error) {
    console.error('Failed to load latest manga:', error);
    showToast('Gagal memuat rilisan terbaru');
  }
}

export async function loadIndonesianManga() {
  const sectionTitle = document.getElementById('grid-section-title');
  if (sectionTitle) sectionTitle.textContent = 'Manga Terjemahan Bahasa Indonesia 🇮🇩';
  showGridSkeleton();

  try {
    // Combine MangaDex (ID) and Komiku (ID) using Promise.allSettled
    const [mangadexSettled, komikuSettled] = await Promise.allSettled([
      fetch('/api/search?lang=id&limit=24').then(r => r.json()),
      fetchKomikuLatest()
    ]);

    let mangadexList = [];
    if (mangadexSettled.status === 'fulfilled' && mangadexSettled.value?.data) {
      mangadexList = mangadexSettled.value.data.map(m => ({
        ...m,
        source: 'mangadex'
      }));
    }

    let komikuList = [];
    if (komikuSettled.status === 'fulfilled' && Array.isArray(komikuSettled.value)) {
      komikuList = komikuSettled.value.map(k => ({
        ...k,
        source: 'komiku'
      }));
    }

    // Interleave results so user sees comics from both MangaDex and Komiku Indo Scan
    const combined = [];
    const maxLen = Math.max(mangadexList.length, komikuList.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < komikuList.length) combined.push(komikuList[i]);
      if (i < mangadexList.length) combined.push(mangadexList[i]);
    }

    state.mangaList = combined.length > 0 ? combined : mangadexList;
    renderMangaGrid(state.mangaList);
  } catch (error) {
    console.error('Failed to load Indonesian manga:', error);
    showToast('Gagal memuat komik Bahasa Indonesia');
  }
}

export async function loadEnglishManga() {
  const sectionTitle = document.getElementById('grid-section-title');
  if (sectionTitle) sectionTitle.textContent = 'Manga Scanlation English 🇬🇧';
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

export async function loadMangaByGenre(tagId, tagName) {
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
window.loadMangaByGenre = loadMangaByGenre;

export async function loadExploreCategory(categoryTitle, fetchUrl) {
  const sectionTitle = document.getElementById('grid-section-title');
  if (sectionTitle) {
    sectionTitle.textContent = categoryTitle;
  }
  const countBadge = document.getElementById('grid-count-badge');
  if (countBadge) {
    countBadge.textContent = 'Memuat...';
  }

  // Deactivate filter tabs since this is a specific Explore category
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));

  if (typeof window.resetGenreSelection === 'function') {
    window.resetGenreSelection(false);
  }

  showGridSkeleton();

  try {
    const res = await fetch(fetchUrl);
    const data = await res.json();
    state.mangaList = (data.data || []).map(m => ({ ...m, source: 'mangadex' }));
    state.mangaList.forEach(m => {
      CoverCache.set(m.id, getMangaTitle(m.attributes), getCoverUrl(m));
    });
    renderMangaGrid(state.mangaList);
    if (countBadge) {
      countBadge.textContent = `${state.mangaList.length} Judul`;
    }
  } catch (error) {
    console.error(`Failed to load category ${categoryTitle}:`, error);
    showToast(`Gagal memuat ${categoryTitle}`);
    if (countBadge) {
      countBadge.textContent = '0 Judul';
    }
  }

  // Smoothly scroll down to grid header so user immediately sees the category results
  setTimeout(() => {
    const gridHeader = document.querySelector('.section-header') || document.getElementById('manga-grid');
    if (gridHeader) {
      gridHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 120);
}
window.loadExploreCategory = loadExploreCategory;

// Anime Feed Loaders
export async function loadPopularAnime() {
  const sectionTitle = document.getElementById('grid-section-title');
  if (sectionTitle) sectionTitle.textContent = 'Anime Paling Populer (Trending)';
  showGridSkeleton();

  try {
    const res = await fetch('/api/anime/popular');
    const data = await res.json();
    const list = data.data || [];
    state.popularAnime = list;
    state.animeList = list;

    renderMediaGrid(list, 'anime');

    if (list.length >= 3 && state.activeMediaMode === 'anime') {
      renderHeroBanner(list.slice(0, 5));
    }
  } catch (error) {
    console.error('Failed to load popular anime:', error);
    showToast('Gagal memuat anime populer');
  }
}
window.loadPopularAnime = loadPopularAnime;

export async function loadSeasonalAnime() {
  const sectionTitle = document.getElementById('grid-section-title');
  if (sectionTitle) sectionTitle.textContent = 'Anime Sedang Tayang (Seasonal)';
  showGridSkeleton();

  try {
    const res = await fetch('/api/anime/seasonal');
    const data = await res.json();
    state.animeList = data.data || [];
    renderMediaGrid(state.animeList, 'anime');
  } catch (error) {
    console.error('Failed to load seasonal anime:', error);
    showToast('Gagal memuat anime seasonal');
  }
}
window.loadSeasonalAnime = loadSeasonalAnime;

export async function loadLatestAnime() {
  const sectionTitle = document.getElementById('grid-section-title');
  if (sectionTitle) sectionTitle.textContent = 'Rilis Episode Anime Terbaru';
  showGridSkeleton();

  try {
    const res = await fetch('/api/anime/latest');
    const data = await res.json();
    state.animeList = data.data || [];
    renderMediaGrid(state.animeList, 'anime');
  } catch (error) {
    console.error('Failed to load latest anime:', error);
    showToast('Gagal memuat episode terbaru');
  }
}
window.loadLatestAnime = loadLatestAnime;

export async function loadSubIndoAnime() {
  const sectionTitle = document.getElementById('grid-section-title');
  if (sectionTitle) sectionTitle.textContent = 'Anime Subtitle Indonesia 🇮🇩';
  showGridSkeleton();

  try {
    const res = await fetch('/api/anime/popular');
    const data = await res.json();
    const list = (data.data || []).map(a => ({
      ...a,
      subIndo: true,
      latestEpisode: a.latestEpisode ? `${a.latestEpisode} • Sub ID` : 'Sub Indo'
    }));
    state.animeList = list;
    renderMediaGrid(list, 'anime');
  } catch (error) {
    console.error('Failed to load sub indo anime:', error);
  }
}
window.loadSubIndoAnime = loadSubIndoAnime;

export async function loadMovieAnime() {
  const sectionTitle = document.getElementById('grid-section-title');
  if (sectionTitle) sectionTitle.textContent = 'Anime Movies (Film Layar Lebar)';
  showGridSkeleton();

  try {
    const res = await fetch('/api/anime/movies');
    const data = await res.json();
    state.animeList = data.data || [];
    renderMediaGrid(state.animeList, 'anime');
  } catch (error) {
    console.error('Failed to load anime movies:', error);
    showToast('Gagal memuat anime movies');
  }
}
window.loadMovieAnime = loadMovieAnime;

export function initFilters() {
  const tabs = document.querySelectorAll('.filter-tab:not(.genre-dropdown-toggle)');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const filter = tab.dataset.filter;

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
      } else if (filter === 'anime-popular' || filter === 'anime-all') {
        loadPopularAnime();
      } else if (filter === 'anime-seasonal') {
        loadSeasonalAnime();
      } else if (filter === 'anime-latest') {
        loadLatestAnime();
      } else if (filter === 'anime-subindo') {
        loadSubIndoAnime();
      } else if (filter === 'anime-movies') {
        loadMovieAnime();
      }
    });
  });
}

export function initGenreFilter() {
  const modalBody = document.getElementById('genre-modal-body');
  const toggleBtn = document.getElementById('btn-genre-toggle');
  const toggleText = document.getElementById('genre-toggle-text');
  const modalBackdrop = document.getElementById('genre-modal-backdrop');
  const modalPanel = document.getElementById('genre-modal-panel');
  const closeBtn = document.getElementById('btn-close-genre-modal');
  const searchInput = document.getElementById('genre-modal-search-input');
  const clearSearchBtn = document.getElementById('btn-clear-genre-search');

  if (!modalBody) return;

  function renderModalContent(filterText = '') {
    modalBody.innerHTML = '';
    const q = filterText.toLowerCase().trim();

    if (state.selectedGenre) {
      const resetBanner = document.createElement('div');
      resetBanner.className = 'genre-modal-active-banner';
      resetBanner.innerHTML = `
        <span>Filter aktif: <strong>${state.selectedGenre.name}</strong></span>
        <button type="button" class="btn-clear-active-genre" id="btn-clear-active-genre">
          <i data-lucide="x"></i> Hapus Filter
        </button>
      `;
      resetBanner.querySelector('#btn-clear-active-genre')?.addEventListener('click', () => {
        closeGenreModal();
        if (typeof window.resetGenreSelection === 'function') {
          window.resetGenreSelection(true);
        }
      });
      modalBody.appendChild(resetBanner);
    }

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

    const filteredFormats = MANGADEX_FORMATS.filter(g => !q || g.name.toLowerCase().includes(q));
    if (filteredFormats.length > 0) {
      const fSection = document.createElement('div');
      fSection.innerHTML = `<div class="genre-modal-group-title">Format Komik (${filteredFormats.length})</div>`;
      const fGrid = document.createElement('div');
      fGrid.className = 'genre-modal-grid';
      filteredFormats.forEach(g => {
        const itemBtn = document.createElement('button');
        itemBtn.className = `genre-modal-tag-btn ${state.selectedGenre?.id === g.id ? 'active' : ''}`;
        itemBtn.type = 'button';
        itemBtn.dataset.genreId = g.id;
        itemBtn.innerHTML = `<i data-lucide="${g.icon || 'tag'}"></i><span>${g.name}</span>`;
        itemBtn.addEventListener('click', () => {
          selectGenre(g.id, g.name);
          closeGenreModal();
        });
        fGrid.appendChild(itemBtn);
      });
      fSection.appendChild(fGrid);
      modalBody.appendChild(fSection);
    }

    const filteredWarnings = MANGADEX_CONTENT_WARNINGS.filter(g => !q || g.name.toLowerCase().includes(q));
    if (filteredWarnings.length > 0) {
      const wSection = document.createElement('div');
      wSection.innerHTML = `<div class="genre-modal-group-title">Konten Khusus & Peringatan (${filteredWarnings.length})</div>`;
      const wGrid = document.createElement('div');
      wGrid.className = 'genre-modal-grid';
      filteredWarnings.forEach(g => {
        const itemBtn = document.createElement('button');
        itemBtn.className = `genre-modal-tag-btn ${state.selectedGenre?.id === g.id ? 'active' : ''}`;
        itemBtn.type = 'button';
        itemBtn.dataset.genreId = g.id;
        itemBtn.innerHTML = `<i data-lucide="${g.icon || 'tag'}"></i><span>${g.name}</span>`;
        itemBtn.addEventListener('click', () => {
          selectGenre(g.id, g.name);
          closeGenreModal();
        });
        wGrid.appendChild(itemBtn);
      });
      wSection.appendChild(wGrid);
      modalBody.appendChild(wSection);
    }

    if (filteredGenres.length === 0 && filteredThemes.length === 0 && filteredFormats.length === 0 && filteredWarnings.length === 0) {
      modalBody.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
          <i data-lucide="help-circle" style="width: 32px; height: 32px; margin-bottom: 0.5rem;"></i>
          <p>Filter "<strong>${filterText}</strong>" tidak ditemukan.</p>
        </div>
      `;
    }

    initIcons();
  }

  renderModalContent();
  initIcons();

  function openGenreModal() {
    modalBackdrop?.classList.remove('hidden');
    modalPanel?.classList.remove('hidden');
    toggleBtn?.classList.add('open');
    if (searchInput) {
      searchInput.value = '';
      clearSearchBtn?.classList.add('hidden');
      renderModalContent();
      setTimeout(() => searchInput.focus(), 150);
    }
  }

  function closeGenreModal() {
    modalBackdrop?.classList.add('hidden');
    modalPanel?.classList.add('hidden');
    toggleBtn?.classList.remove('open');
  }

  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.selectedGenre) {
      if (typeof window.resetGenreSelection === 'function') {
        window.resetGenreSelection(true);
      }
      return;
    }
    if (modalPanel?.classList.contains('hidden')) {
      openGenreModal();
    } else {
      closeGenreModal();
    }
  });

  closeBtn?.addEventListener('click', closeGenreModal);
  modalBackdrop?.addEventListener('click', closeGenreModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalPanel && !modalPanel.classList.contains('hidden')) {
      closeGenreModal();
    }
  });

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

  function selectGenre(id, name) {
    if (state.selectedGenre?.id === id) {
      if (typeof window.resetGenreSelection === 'function') {
        window.resetGenreSelection(true);
      }
      return;
    }

    state.selectedGenre = { id, name };

    document.querySelectorAll('.filter-tab:not(.genre-dropdown-toggle)').forEach(t => t.classList.remove('active'));

    if (toggleBtn) {
      toggleBtn.classList.add('has-selection', 'active');
      toggleText.innerHTML = `Genre: ${name} <i data-lucide="x" style="width:12px;height:12px;margin-left:4px;vertical-align:middle;"></i>`;
      initIcons();
    }

    renderModalContent();
    loadMangaByGenre(id, name);
  }

  window.resetGenreSelection = function (reloadDefault = true) {
    state.selectedGenre = null;

    if (toggleBtn) {
      toggleBtn.classList.remove('has-selection', 'active');
      toggleText.textContent = 'Filter Genre';
      initIcons();
    }

    renderModalContent();

    if (reloadDefault) {
      document.querySelectorAll('.filter-tab').forEach(t => {
        if (t.dataset.filter === 'all') t.classList.add('active');
        else if (!t.classList.contains('genre-dropdown-toggle')) t.classList.remove('active');
      });
      loadPopularManga();
    }
  };
}

export function initHomePage() {
  renderContinueRow();
  renderFilterTabs(state.activeMediaMode);

  if (state.activeMediaMode === 'anime') {
    const sectionTitle = document.getElementById('grid-section-title');
    if (sectionTitle) sectionTitle.textContent = 'Anime Paling Populer (Trending)';
    loadPopularAnime();
  } else {
    loadPopularManga();
  }

  // Reactive listener when user switches media mode from navbar / drawer
  window.addEventListener('yomikomi:mediamode', (e) => {
    const newMode = e.detail?.mode || state.activeMediaMode;
    renderFilterTabs(newMode);
    renderContinueRow();
    const sectionTitle = document.getElementById('grid-section-title');

    if (newMode === 'anime') {
      if (sectionTitle) sectionTitle.textContent = 'Anime Paling Populer (Trending)';
      if (state.popularAnime && state.popularAnime.length >= 3) {
        renderHeroBanner(state.popularAnime.slice(0, 5));
      }
      loadPopularAnime();
    } else {
      if (sectionTitle) sectionTitle.textContent = 'Komik Paling Populer (Trending)';
      const mangaHeroPool = (state.heroManga && state.heroManga.length >= 3) 
        ? state.heroManga 
        : (state.popularManga && state.popularManga.length >= 3 ? state.popularManga.slice(0, 5) : null);
      if (mangaHeroPool) {
        renderHeroBanner(mangaHeroPool);
      }
      loadPopularManga();
    }
  });

  // Re-check continue row on window focus / visibility change
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.currentView === 'home') {
      renderContinueRow();
    }
  });
}

// Global window bindings
if (typeof window !== 'undefined') {
  window.renderContinueRow = renderContinueRow;
  window.renderFilterTabs = renderFilterTabs;
  window.renderMediaGrid = renderMediaGrid;
}
