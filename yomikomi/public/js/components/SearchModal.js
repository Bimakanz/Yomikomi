/**
 * SearchModal Component
 * Full-screen / dialog search with live debounce, quick tag chips, and keyboard shortcuts (Ctrl+K, Esc)
 */

import { searchManga } from '../services/mangadex.js';
import { getMangaTitle, getCoverUrl, initIcons } from '../state.js';

let searchDebounceTimeout = null;

export function renderSearchModalMarkup() {
  return `
    <div class="modal-overlay hidden" id="search-modal">
      <div class="search-modal-box">
        <div class="search-input-wrapper">
          <i data-lucide="search" class="search-icon"></i>
          <input type="text" id="modal-search-input" placeholder="Ketik judul manga, manhwa, manhua..." autocomplete="off">
          <button class="search-clear-btn hidden" id="modal-search-clear">
            <i data-lucide="x"></i>
          </button>
          <kbd class="search-esc-kbd" id="modal-close-esc">ESC</kbd>
        </div>
        <div class="search-quick-tags" id="search-quick-tags">
          <span class="quick-tag-label">Genre Cepat:</span>
          <button class="quick-tag-chip" data-tag="Action">Action</button>
          <button class="quick-tag-chip" data-tag="Fantasy">Fantasy</button>
          <button class="quick-tag-chip" data-tag="Romance">Romance</button>
          <button class="quick-tag-chip" data-tag="Isekai">Isekai</button>
          <button class="quick-tag-chip" data-tag="Comedy">Comedy</button>
        </div>
        <div class="search-results-container" id="search-results">
          <div class="search-placeholder-state">
            <i data-lucide="sparkles"></i>
            <p>Ketik judul komik favorit Anda untuk mencari dari katalog komik</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function openSearchModal() {
  const modal = document.getElementById('search-modal');
  const input = document.getElementById('modal-search-input');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => input?.focus(), 100);
}

export function closeSearchModal() {
  const modal = document.getElementById('search-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

export function initSearchModalEvents({ onSelectManga } = {}) {
  const selectManga = onSelectManga || ((id) => {
    if (typeof window.openMangaDetail === 'function') {
      window.openMangaDetail(id);
    }
  });

  const modal = document.getElementById('search-modal');
  const input = document.getElementById('modal-search-input');
  const clearBtn = document.getElementById('modal-search-clear');
  const escBtn = document.getElementById('modal-close-esc');
  const resultsContainer = document.getElementById('search-results');

  escBtn?.addEventListener('click', closeSearchModal);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeSearchModal();
  });

  clearBtn?.addEventListener('click', () => {
    if (input) {
      input.value = '';
      input.focus();
      clearBtn.classList.add('hidden');
      if (resultsContainer) {
        resultsContainer.innerHTML = `
          <div class="search-placeholder-state">
            <i data-lucide="sparkles"></i>
            <p>Ketik judul komik favorit Anda untuk mencari dari katalog komik</p>
          </div>
        `;
        initIcons();
      }
    }
  });

  input?.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (q.length > 0) {
      clearBtn?.classList.remove('hidden');
    } else {
      clearBtn?.classList.add('hidden');
    }

    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      performSearch(q, selectManga);
    }, 350);
  });

  document.querySelectorAll('#search-quick-tags .quick-tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const tag = chip.dataset.tag;
      if (input) {
        input.value = tag;
        clearBtn?.classList.remove('hidden');
        performSearch(tag, selectManga);
      }
    });
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openSearchModal();
    }
    if (e.key === 'Escape') {
      closeSearchModal();
    }
  });

  initIcons();
}

async function performSearch(query, onSelectManga) {
  const container = document.getElementById('search-results');
  if (!container) return;

  if (!query) {
    container.innerHTML = `
      <div class="search-placeholder-state">
        <i data-lucide="sparkles"></i>
        <p>Ketik judul komik favorit Anda untuk mencari dari katalog komik</p>
      </div>
    `;
    initIcons();
    return;
  }

  container.innerHTML = `
    <div class="search-loading-state">
      <div class="spinner-small"></div>
      <span>Mencari komik "${query}"...</span>
    </div>
  `;

  try {
    const res = await searchManga(query);
    const results = res.data || [];

    if (results.length === 0) {
      container.innerHTML = `
        <div class="search-placeholder-state">
          <i data-lucide="alert-circle"></i>
          <p>Tidak ada hasil untuk "<strong>${query}</strong>"</p>
        </div>
      `;
      initIcons();
      return;
    }

    container.innerHTML = '';
    results.forEach(manga => {
      const title = getMangaTitle(manga.attributes);
      const coverUrl = getCoverUrl(manga);
      const year = manga.attributes.year || '';
      const status = manga.attributes.status ? manga.attributes.status.toUpperCase() : 'ONGOING';

      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `
        <img class="search-result-thumb" src="${coverUrl}" alt="${title}" loading="lazy" onerror="this.src='https://placehold.co/300x420/1e2025/ffffff?text=Cover';">
        <div class="search-result-info">
          <div class="search-result-title" title="${title}">${title}</div>
          <div class="search-result-meta">
            <span class="search-badge">${status}</span>
            ${year ? `<span class="search-badge">${year}</span>` : ''}
          </div>
        </div>
        <i data-lucide="chevron-right" class="search-result-arrow"></i>
      `;

      item.addEventListener('click', () => {
        closeSearchModal();
        if (typeof onSelectManga === 'function') {
          onSelectManga(manga.id);
        }
      });

      container.appendChild(item);
    });

    initIcons();
  } catch (err) {
    console.error('Search error:', err);
    container.innerHTML = `
      <div class="search-placeholder-state">
        <i data-lucide="alert-triangle"></i>
        <p>Gagal melakukan pencarian. Silakan coba lagi.</p>
      </div>
    `;
    initIcons();
  }
}
