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

export function initSearchModalEvents({ onSelectManga }) {
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
      performSearch(q, onSelectManga);
    }, 350);
  });

  // Quick Tags
  document.querySelectorAll('.quick-tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const tag = chip.dataset.tag;
      if (input && tag) {
        input.value = tag;
        clearBtn?.classList.remove('hidden');
        performSearch(tag, onSelectManga);
      }
    });
  });

  // Global Ctrl + K / Esc shortcuts
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const isHidden = modal?.classList.contains('hidden');
      if (isHidden) openSearchModal();
      else closeSearchModal();
    } else if (e.key === 'Escape' && !modal?.classList.contains('hidden')) {
      closeSearchModal();
    }
  });
}

async function performSearch(query, onSelectManga) {
  const resultsContainer = document.getElementById('search-results');
  if (!resultsContainer) return;

  if (!query) {
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
    <div class="search-loading-state">
      <div class="spinner"></div>
      <p>Mencari komik "${query}"...</p>
    </div>
  `;

  try {
    const results = await searchManga(query);
    if (!results || results.length === 0) {
      resultsContainer.innerHTML = `
        <div class="search-empty-state">
          <i data-lucide="frown"></i>
          <h4>Komik Tidak Ditemukan</h4>
          <p>Tidak ada hasil untuk kata kunci "${query}". Coba cari dengan judul lain.</p>
        </div>
      `;
      initIcons();
      return;
    }

    resultsContainer.innerHTML = '';
    results.forEach(manga => {
      const title = getMangaTitle(manga.attributes);
      const cover = getCoverUrl(manga);
      const status = manga.attributes.status ? manga.attributes.status.toUpperCase() : 'ONGOING';
      const year = manga.attributes.year || '';

      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `
        <img class="search-result-cover" src="${cover}" alt="${title}" loading="lazy" onerror="this.src='https://placehold.co/100x140/1e2025/ffffff?text=Cover';">
        <div class="search-result-meta">
          <h4 class="search-result-title">${title}</h4>
          <div class="search-result-tags">
            <span class="search-tag-status">${status}</span>
            ${year ? `<span class="search-tag-year">${year}</span>` : ''}
          </div>
        </div>
        <i data-lucide="chevron-right" class="search-result-arrow"></i>
      `;

      item.addEventListener('click', () => {
        closeSearchModal();
        if (typeof onSelectManga === 'function') {
          onSelectManga(manga.id);
        } else if (typeof window.openMangaDetail === 'function') {
          window.openMangaDetail(manga.id);
        }
      });

      resultsContainer.appendChild(item);
    });

    initIcons();
  } catch (err) {
    resultsContainer.innerHTML = `
      <div class="search-empty-state">
        <i data-lucide="alert-circle"></i>
        <h4>Terjadi Kesalahan</h4>
        <p>Gagal menghubungi server pencarian: ${err.message}</p>
      </div>
    `;
    initIcons();
  }
}
