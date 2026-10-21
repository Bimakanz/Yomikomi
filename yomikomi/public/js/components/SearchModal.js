/**
 * SearchModal Component
 * Full-screen / dialog search with live debounce, quick tag chips, and keyboard shortcuts (Ctrl+K, Esc)
 */

import { searchManga } from '../services/mangadex.js';
import { fetchKomikuSearch } from '../services/api.js';
import { getMangaTitle, getCoverUrl, getLanguageFlag, initIcons } from '../state.js';
import { attachMangaCardHoverPrefetch } from '../services/mangaCache.js';
import { calculateTitleSimilarity } from './ChapterList.js';

let searchDebounceTimeout = null;
let currentSearchMediaType = 'all'; // 'all', 'manga', 'anime'

export function renderSearchModalMarkup() {
  return `
    <div class="modal-overlay hidden" id="search-modal">
      <div class="search-modal-box">
        <div class="search-input-wrapper">
          <i data-lucide="search" class="search-icon"></i>
          <input type="text" id="modal-search-input" placeholder="Cari komik atau anime... (Ctrl+K)" autocomplete="off">
          <button class="search-clear-btn hidden" id="modal-search-clear" type="button" aria-label="Hapus kata kunci">
            <i data-lucide="x"></i>
          </button>
          <kbd class="search-esc-kbd" id="modal-close-esc" title="Tutup pencarian (Esc)">ESC</kbd>
        </div>

        <!-- Unified Media Type Switcher Tabs in Search Modal -->
        <div class="search-filters-bar">
          <div class="search-media-tabs" id="search-media-tabs">
            <button class="search-media-tab active" data-type="all" type="button">Semua</button>
            <button class="search-media-tab" data-type="manga" type="button">Komik</button>
            <button class="search-media-tab" data-type="anime" type="button">Anime</button>
          </div>
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
            <p>Ketik judul komik atau anime favorit Anda untuk mencari...</p>
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

  // Media Tab Switcher within Search Modal
  document.querySelectorAll('#search-media-tabs .search-media-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#search-media-tabs .search-media-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentSearchMediaType = tab.dataset.type || 'all';
      const q = input ? input.value.trim() : '';
      if (q) performSearch(q, selectManga);
    });
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
        <p>Ketik judul komik atau anime favorit Anda untuk mencari...</p>
      </div>
    `;
    initIcons();
    return;
  }

  container.innerHTML = `
    <div class="search-loading-state">
      <div class="spinner-small"></div>
      <span>Mencari "${query}"...</span>
    </div>
  `;

  try {
    const shouldSearchManga = currentSearchMediaType === 'all' || currentSearchMediaType === 'manga';
    const shouldSearchAnime = currentSearchMediaType === 'all' || currentSearchMediaType === 'anime';

    const promises = [];
    if (shouldSearchManga) {
      promises.push(searchManga(query).catch(() => ({ data: [] })));
      promises.push(fetchKomikuSearch(query).catch(() => []));
      promises.push(
        fetch(`/api/comick/search?q=${encodeURIComponent(query)}`)
          .then(r => r.json())
          .catch(() => ({ data: [] }))
      );
    }
    if (shouldSearchAnime) {
      promises.push(
        fetch(`/api/anime/search?q=${encodeURIComponent(query)}`)
          .then(r => r.json())
          .catch(() => ({ data: [] }))
      );
    }

    const settled = await Promise.allSettled(promises);

    let mangadexResults = [];
    let komikuResults = [];
    let comickResults = [];
    let animeResults = [];

    let pIdx = 0;
    if (shouldSearchManga) {
      const mdRes = settled[pIdx++];
      if (mdRes.status === 'fulfilled' && mdRes.value?.data) {
        mangadexResults = mdRes.value.data.map(m => ({ ...m, source: 'mangadex', mediaType: 'manga' }));
      }
      const kmRes = settled[pIdx++];
      if (kmRes.status === 'fulfilled' && Array.isArray(kmRes.value)) {
        komikuResults = kmRes.value.map(k => ({ ...k, source: 'komiku', mediaType: 'manga' }));
      }
      const ckRes = settled[pIdx++];
      if (ckRes.status === 'fulfilled' && ckRes.value?.data) {
        comickResults = ckRes.value.data.map(c => ({ ...c, source: 'comick', mediaType: 'manga' }));
      }
    }

    if (shouldSearchAnime) {
      const anRes = settled[pIdx++];
      if (anRes.status === 'fulfilled' && anRes.value?.data) {
        animeResults = anRes.value.data.map(a => ({ ...a, mediaType: 'anime' }));
      }
    }

    // Unify MangaDex, Komiku & ComicK manga into exactly 1 card per title ("1 komik 1 sumber")
    const unifiedMangaList = [];
    const matchedKomikuSlugs = new Set();
    const matchedComickSlugs = new Set();

    mangadexResults.forEach(mdItem => {
      const mdTitle = getMangaTitle(mdItem.attributes) || '';
      const allCheckTitles = [mdTitle];
      if (mdItem.attributes?.altTitles && Array.isArray(mdItem.attributes.altTitles)) {
        mdItem.attributes.altTitles.forEach(at => {
          Object.values(at).forEach(val => {
            if (val && typeof val === 'string' && !allCheckTitles.includes(val)) {
              allCheckTitles.push(val);
            }
          });
        });
      }

      // 1. Check match with Komiku
      let bestKomikuMatch = null;
      let highestKomikuSim = 0;
      komikuResults.forEach(kmItem => {
        if (matchedKomikuSlugs.has(kmItem.slug)) return;
        for (const titleCandidate of allCheckTitles) {
          const sim = calculateTitleSimilarity(titleCandidate, kmItem.title);
          if (sim > highestKomikuSim) {
            highestKomikuSim = sim;
            bestKomikuMatch = kmItem;
          }
        }
      });

      // 2. Check match with ComicK
      let bestComickMatch = null;
      let highestComickSim = 0;
      comickResults.forEach(ckItem => {
        if (matchedComickSlugs.has(ckItem.slug)) return;
        for (const titleCandidate of allCheckTitles) {
          const sim = calculateTitleSimilarity(titleCandidate, ckItem.title);
          if (sim > highestComickSim) {
            highestComickSim = sim;
            bestComickMatch = ckItem;
          }
        }
      });

      const hasKomiku = bestKomikuMatch && highestKomikuSim >= 0.5;
      const hasComick = bestComickMatch && highestComickSim >= 0.5;

      if (hasKomiku) matchedKomikuSlugs.add(bestKomikuMatch.slug);
      if (hasComick) matchedComickSlugs.add(bestComickMatch.slug);

      // Filter Out Check: If MangaDex has 0 readable chapters (latestUploadedChapter is null)
      // AND neither Komiku nor ComicK has readable chapters for it, omit from search results!
      const isMangaDexEmpty = mdItem.attributes?.latestUploadedChapter === null;
      if (isMangaDexEmpty && !hasKomiku && !hasComick) {
        return; // Skip ghost/unreadable comic with 0 chapters
      }

      unifiedMangaList.push({
        ...mdItem,
        ...(hasKomiku ? { komikuSlug: bestKomikuMatch.slug, komikuTitle: bestKomikuMatch.title, komikuData: bestKomikuMatch } : {}),
        ...(hasComick ? { comickSlug: bestComickMatch.slug, comickTitle: bestComickMatch.title, comickData: bestComickMatch } : {})
      });
    });

    // Append unmatched Komiku results (titles available only on Komiku)
    komikuResults.forEach(kmItem => {
      if (!matchedKomikuSlugs.has(kmItem.slug)) {
        unifiedMangaList.push(kmItem);
      }
    });

    // Append unmatched ComicK results (titles available on ComicK, e.g. One-Room TA if not in MangaDex)
    comickResults.forEach(ckItem => {
      if (!matchedComickSlugs.has(ckItem.slug)) {
        unifiedMangaList.push(ckItem);
      }
    });

    // Interleave unified manga results with anime results
    const results = [];
    const maxLen = Math.max(unifiedMangaList.length, animeResults.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < animeResults.length && shouldSearchAnime) results.push(animeResults[i]);
      if (i < unifiedMangaList.length && shouldSearchManga) results.push(unifiedMangaList[i]);
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
    results.forEach(item => {
      const isAnime = item.mediaType === 'anime';
      const isKomiku = item.source === 'komiku' || item.id?.toString().startsWith('komiku-');
      const isComicK = item.source === 'comick' || item.id?.toString().startsWith('comick-');
      const title = isAnime ? item.title : (isKomiku || isComicK ? item.title : getMangaTitle(item.attributes));
      const coverUrl = isAnime ? item.coverUrl : (isKomiku || isComicK ? item.coverUrl : getCoverUrl(item));
      const status = isAnime 
        ? (item.status || 'RELEASING').toUpperCase() 
        : (!isKomiku && !isComicK && item.attributes?.status ? item.attributes.status.toUpperCase() : 'ONGOING');
      const statusClass = 'status-' + status.toLowerCase();
      
      const rawRating = isAnime ? item.rating : item.attributes?.rating;
      let cleanRatingNum = '';
      if (rawRating) {
        const numMatch = String(rawRating).match(/[\d.]+/);
        if (numMatch) cleanRatingNum = numMatch[0];
      }
      const typeLabel = isAnime ? 'Anime' : 'Komik';

      const resultRow = document.createElement('div');
      resultRow.className = 'search-result-item';
      resultRow.tabIndex = 0;
      resultRow.setAttribute('role', 'button');
      resultRow.setAttribute('aria-label', title);
      resultRow.innerHTML = `
        <div class="search-result-thumb-wrap">
          <img class="search-result-thumb" src="${coverUrl}" alt="${title}" loading="lazy" onerror="this.src='https://placehold.co/100x140/1e2025/ffffff?text=Cover';">
        </div>
        <div class="search-result-info">
          <div class="search-result-title" title="${title}">${title}</div>
          <div class="search-result-meta">
            <span class="search-badge ${statusClass}">${status}</span>
            <span class="search-badge search-badge-type">${typeLabel}</span>
            ${cleanRatingNum ? `<span class="search-badge search-badge-rating"><i data-lucide="star"></i> ${cleanRatingNum}</span>` : ''}
            ${isAnime && item.latestEpisode ? `<span class="search-badge">${item.latestEpisode}</span>` : ''}
          </div>
        </div>
        <div class="search-result-action">
          <i data-lucide="chevron-right" class="search-result-arrow"></i>
        </div>
      `;

      const handleSelect = () => {
        closeSearchModal();
        if (isAnime) {
          if (typeof window.openAnimeWatch === 'function') {
            window.openAnimeWatch(item.id, 1, item);
          }
        } else {
          if (typeof onSelectManga === 'function') {
            onSelectManga(item.id, item);
          } else if (typeof window.openMangaDetail === 'function') {
            window.openMangaDetail(item.id, item);
          }
        }
      };

      resultRow.addEventListener('click', handleSelect);
      resultRow.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSelect();
        }
      });

      if (!isAnime) {
        attachMangaCardHoverPrefetch(resultRow, item.id, item);
      }

      container.appendChild(resultRow);
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
