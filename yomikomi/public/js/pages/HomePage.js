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
  MANGADEX_GENRES,
  MANGADEX_POPULAR_THEMES
} from '../state.js';
import { renderHeroBanner } from '../components/HeroBanner.js';

export function renderHomePageMarkup() {
  return `
    <section class="view-section active" id="view-home">
      <!-- Hero Featured Carousel -->
      <div class="hero-carousel-container" id="hero-carousel">
        <div class="hero-skeleton skeleton-pulse"></div>
      </div>

      <!-- Quick Filter & Tags Bar -->
      <div class="filter-bar">
        <div class="filter-tabs">
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

export function renderMangaGrid(mangaList) {
  const grid = document.getElementById('manga-grid');
  const countBadge = document.getElementById('grid-count-badge');
  if (countBadge) countBadge.textContent = `${mangaList.length} Judul`;

  if (!grid) return;

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

    card.addEventListener('click', () => {
      if (typeof window.openMangaDetail === 'function') {
        window.openMangaDetail(manga.id);
      }
    });
    grid.appendChild(card);
  });

  initIcons();
}

export async function loadPopularManga() {
  const sectionTitle = document.getElementById('grid-section-title');
  if (sectionTitle) sectionTitle.textContent = 'Komik Paling Populer (Trending)';
  showGridSkeleton();

  try {
    const res = await fetch('/api/popular');
    const data = await res.json();
    state.mangaList = data.data || [];
    state.mangaList.forEach(m => {
      CoverCache.set(m.id, getMangaTitle(m.attributes), getCoverUrl(m));
    });
    renderMangaGrid(state.mangaList);

    if (state.mangaList.length >= 3 && state.heroManga.length === 0) {
      state.heroManga = state.mangaList.slice(0, 5);
      renderHeroBanner(state.heroManga);
    }
  } catch (error) {
    console.error('Failed to load popular manga:', error);
    showToast('Gagal memuat manga populer');
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
    state.mangaList = data.data || [];
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
    const res = await fetch('/api/search?lang=id&limit=24');
    const data = await res.json();
    state.mangaList = data.data || [];
    renderMangaGrid(state.mangaList);
  } catch (error) {
    console.error('Failed to load Indonesian manga:', error);
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

    if (filteredGenres.length === 0 && filteredThemes.length === 0) {
      modalBody.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
          <i data-lucide="help-circle" style="width: 32px; height: 32px; margin-bottom: 0.5rem;"></i>
          <p>Genre "<strong>${filterText}</strong>" tidak ditemukan.</p>
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
  initFilters();
  initGenreFilter();
  loadPopularManga();
}
