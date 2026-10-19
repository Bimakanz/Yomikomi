/**
 * MangaCard Component
 * Generates reusable manga cards with poster, title, status, and hover overlay
 */

import { getMangaTitle, getCoverUrl, getLanguageFlag } from '../state.js';
import { attachMangaCardHoverPrefetch } from '../services/mangaCache.js';

export function createMangaCard(manga, onCardClick) {
  const title = getMangaTitle(manga.attributes);
  const coverUrl = getCoverUrl(manga);
  const status = manga.attributes?.status ? manga.attributes.status.toUpperCase() : 'ONGOING';
  const year = manga.attributes?.year || '';
  const origLang = manga.attributes?.originalLanguage || 'ja';
  const flag = getLanguageFlag(origLang);

  const card = document.createElement('article');
  card.className = 'manga-card';
  card.tabIndex = 0;
  card.dataset.mangaId = manga.id;

  card.innerHTML = `
    <div class="manga-card-poster-wrap">
      <img 
        class="manga-card-poster" 
        src="${coverUrl}" 
        alt="${title}" 
        loading="lazy" 
        onerror="this.src='https://placehold.co/300x420/1e2025/ffffff?text=Cover';"
      >
      <span class="manga-card-flag" title="Bahasa Asli: ${origLang}">${flag}</span>
      <div class="manga-card-badge-wrap">
        <span class="manga-badge-status">${status}</span>
        ${year ? `<span class="manga-badge-year">${year}</span>` : ''}
      </div>
    </div>
    <div class="manga-card-info">
      <h3 class="manga-card-title" title="${title}">${title}</h3>
    </div>
  `;

  // Attach hover and viewport prefetch
  attachMangaCardHoverPrefetch(card, manga.id, manga);

  card.addEventListener('click', () => {
    if (typeof onCardClick === 'function') {
      onCardClick(manga.id, manga);
    } else if (typeof window.openMangaDetail === 'function') {
      window.openMangaDetail(manga.id, manga);
    }
  });

  return card;
}

export function createExploreCard(manga, onCardClick) {
  const title = getMangaTitle(manga.attributes);
  const coverUrl = getCoverUrl(manga);
  const status = manga.attributes?.status ? manga.attributes.status.toUpperCase() : 'ONGOING';
  const year = manga.attributes?.year || '';
  const origLang = manga.attributes?.originalLanguage || 'ja';
  const flag = getLanguageFlag(origLang);
  const synopsis = manga.attributes?.description?.id || manga.attributes?.description?.en || 'Sinopsis belum tersedia untuk seri manga ini.';

  const card = document.createElement('article');
  card.className = 'explore-card';
  card.tabIndex = 0;
  card.dataset.mangaId = manga.id;

  card.innerHTML = `
    <div class="explore-card-poster-wrap">
      <img class="explore-card-poster" src="${coverUrl}" alt="${title}" loading="lazy" onerror="this.src='https://placehold.co/300x420/1e2025/ffffff?text=Cover';">
      <span class="explore-card-flag" title="Bahasa Asli: ${origLang}">${flag}</span>
      <div class="explore-card-overlay">
        <div class="explore-overlay-header">
          <span class="explore-overlay-badge">${status}</span>
          ${year ? `<span class="explore-overlay-year">${year}</span>` : ''}
        </div>
        <p class="explore-overlay-synopsis">${synopsis}</p>
        <div class="explore-overlay-actions">
          <button class="btn-explore-card-read" type="button">
            <i data-lucide="book-open"></i>
            <span>Baca</span>
          </button>
          <button class="btn-explore-card-arrow" type="button" title="Detail Komik">
            <i data-lucide="arrow-right"></i>
          </button>
        </div>
      </div>
    </div>
    <h4 class="explore-card-title" title="${title}">${title}</h4>
  `;

  // Attach hover and viewport prefetch
  attachMangaCardHoverPrefetch(card, manga.id, manga);

  card.addEventListener('click', () => {
    if (typeof onCardClick === 'function') {
      onCardClick(manga.id, manga);
    } else if (typeof window.openMangaDetail === 'function') {
      window.openMangaDetail(manga.id, manga);
    }
  });

  return card;
}

