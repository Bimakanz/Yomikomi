/**
 * SearchModal Component
 * Full-screen / dialog search with live debounce, quick tag chips, and keyboard shortcuts (Ctrl+K, Esc)
 */

import { searchManga } from '../services/mangadex.js';
import { fetchKomikuSearch } from '../services/api.js';
import { getMangaTitle, getCoverUrl, getLanguageFlag, initIcons } from '../state.js';
import { attachMangaCardHoverPrefetch } from '../services/mangaCache.js';

let searchDebounceTimeout = null;

export function renderSearchModalMarkup() {
  return `
    <div class="modal-overlay hidden" id="search-modal">
      <div class="search-modal-box">
        <div class="search-input-wrapper">
          <i data-lucide="search" class="search-icon"></i>
          <input type="text" id="modal-search-input" placeholder="Ketik judul manga, manhwa, manhua..." autocomplete="off">
          <button class="search-clear-btn hidden" id="modal-search-clear" type="button" aria-label="Hapus kata kunci">
            <i data-lucide="x"></i>
          </button>
          <kbd class="search-esc-kbd" id="modal-close-esc" title="Tutup pencarian (Esc)">ESC</kbd>
        </div>
        <div class="search-quick-tags" id="search-quick-tags">
          <span class="quick-tag-label">Genre Cepat:</span>
          <button class="quick-tag-chip" type="button" data-tag="Action">Action</button>
          <button class="quick-tag-chip" type="button" data-tag="Fantasy">Fantasy</button>
          <button class="quick-tag-chip" type="button" data-tag="Romance">Romance</button>
          <button class="quick-tag-chip" type="button" data-tag="Isekai">Isekai</button>
          <button class="quick-tag-chip" type="button" data-tag="Comedy">Comedy</button>
        </div>
        <div class="search-results-container" id="search-results">
          <div class="search-placeholder-state">
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
      const isHidden = modal?.classList.contains('hidden');
      if (isHidden) openSearchModal();
      else closeSearchModal();
    }
    if (e.key === 'Escape' && !modal?.classList.contains('hidden')) {
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
    const [mangadexSettled, komikuSettled] = await Promise.allSettled([
      searchManga(query),
      fetchKomikuSearch(query)
    ]);

    let mangadexResults = [];
    if (mangadexSettled.status === 'fulfilled' && mangadexSettled.value?.data) {
      mangadexResults = mangadexSettled.value.data.map(m => ({
        ...m,
        source: 'mangadex'
      }));
    }

    let komikuResults = [];
    if (komikuSettled.status === 'fulfilled' && Array.isArray(komikuSettled.value)) {
      komikuResults = komikuSettled.value.map(k => ({
        ...k,
        source: 'komiku'
      }));
    }

    // Interleave results so user gets both MangaDex and Komiku matches
    const results = [];
    const maxLen = Math.max(mangadexResults.length, komikuResults.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < mangadexResults.length) results.push(mangadexResults[i]);
      if (i < komikuResults.length) results.push(komikuResults[i]);
    }

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
      const isKomiku = manga.source === 'komiku' || manga.id?.startsWith('komiku-');
      const title = isKomiku ? manga.title : getMangaTitle(manga.attributes);
      const coverUrl = isKomiku ? manga.coverUrl : getCoverUrl(manga);
      const year = (!isKomiku && manga.attributes?.year) ? manga.attributes.year : '';
      const status = (!isKomiku && manga.attributes?.status) ? manga.attributes.status.toUpperCase() : 'ONGOING';
      const statusClass = 'status-' + status.toLowerCase();
      const origLang = (!isKomiku && manga.attributes?.originalLanguage) ? manga.attributes.originalLanguage : 'id';
      const flag = isKomiku ? '🇮🇩' : getLanguageFlag(origLang);
      const typeLabel = isKomiku 
        ? (manga.type ? manga.type.toUpperCase() : 'MANGA')
        : (origLang === 'ko' ? 'Manhwa' : (origLang === 'zh' || origLang === 'zh-hk' ? 'Manhua' : 'Manga'));
      const sourceName = isKomiku ? 'Komiku' : 'MangaDex';
      const sourceClass = isKomiku ? 'komiku' : 'mangadex';

      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', title);
      item.innerHTML = `
        <div class="search-result-thumb-wrap">
          <img class="search-result-thumb" src="${coverUrl}" alt="${title}" loading="lazy" onerror="this.src='https://placehold.co/100x140/1e2025/ffffff?text=Cover';">
        </div>
        <div class="search-result-info">
          <div class="search-result-title" title="${title}">${title}</div>
          <div class="search-result-meta">
            <span class="search-badge badge-source-${sourceClass}">${sourceName}</span>
            <span class="search-badge ${statusClass}">${status}</span>
            <span class="search-badge search-badge-type">${flag} ${typeLabel}</span>
            ${year ? `<span class="search-badge search-badge-year">${year}</span>` : ''}
          </div>
        </div>
        <div class="search-result-action">
          <i data-lucide="chevron-right" class="search-result-arrow"></i>
        </div>
      `;

      const handleSelect = () => {
        closeSearchModal();
        if (typeof onSelectManga === 'function') {
          onSelectManga(manga.id, manga);
        } else if (typeof window.openMangaDetail === 'function') {
          window.openMangaDetail(manga.id, manga);
        }
      };

      item.addEventListener('click', handleSelect);
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSelect();
        }
      });

      attachMangaCardHoverPrefetch(item, manga.id, manga);

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
