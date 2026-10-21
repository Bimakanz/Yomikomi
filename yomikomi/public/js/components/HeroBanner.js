/**
 * HeroBanner Component
 * Featured hero carousel matching Yomikomi design & style.css
 */

import { state, getMangaTitle, getCoverUrl, initIcons } from '../state.js';
import { fetchAniList } from '../services/api.js';
import { attachMangaCardHoverPrefetch } from '../services/mangaCache.js';

export function renderHeroBanner(containerOrItems, maybeItems, onReadClick, onDetailClick) {
  let container, items;
  if (Array.isArray(containerOrItems)) {
    items = containerOrItems;
    container = document.getElementById('hero-carousel');
  } else {
    container = containerOrItems;
    items = maybeItems;
  }

  if (!container || !items || items.length === 0) return;

  container.innerHTML = '';
  state.heroManga = items.slice(0, 5);
  state.activeHeroIndex = 0;

  state.heroManga.forEach((item, idx) => {
    const isAnime = item.mediaType === 'anime' || state.activeMediaMode === 'anime';
    const title = isAnime ? item.title : getMangaTitle(item.attributes);
    const coverUrl = isAnime ? (item.coverUrl || item.bannerUrl) : getCoverUrl(item);
    const rawDesc = isAnime ? item.description : (item.attributes?.description?.id || item.attributes?.description?.en);
    const cleanDesc = (rawDesc || 'Jelajahi petualangan menakjubkan ini secara gratis di Yomikomi.')
      .replace(/<[^>]*>/g, ' ')
      .slice(0, 160) + '...';
    const status = isAnime ? (item.status || 'RELEASING') : (item.attributes?.status?.toUpperCase() || 'ONGOING');
    const tags = isAnime ? (item.genres?.slice(0, 2) || ['Anime']) : (item.attributes?.tags?.slice(0, 2).map(t => t.attributes.name.en) || ['Manga']);
    const rawScore = isAnime ? (item.rating || (item.averageScore ? (item.averageScore / 10).toFixed(1) : '')) : '';

    const slide = document.createElement('div');
    slide.className = `hero-slide ${idx === 0 ? 'active' : ''}`;
    slide.style.backgroundImage = `url('${coverUrl}')`;
    slide.innerHTML = `
      <div class="hero-content">
        <div class="hero-badge-row">
          <span class="badge-tag accent">
            <span>${isAnime ? 'Anime Populer' : 'Manga Populer'}</span>
          </span>
          <span class="badge-tag">${status}</span>
          ${tags.map(t => `<span class="badge-tag">${t}</span>`).join('')}
          <span class="badge-tag rating-badge ${rawScore ? '' : 'hidden'}" id="hero-rating-${idx}"><i data-lucide="star" style="width:12px; height:12px; fill:#eab308; stroke:#eab308; vertical-align:middle; margin-right:3px;"></i><span class="hero-score-val">${rawScore}</span></span>
        </div>
        <h1 class="hero-title">${title}</h1>
        <p class="hero-desc">${cleanDesc}</p>
        <div class="hero-actions">
          <button class="btn-primary btn-hero-read" type="button">
            <i data-lucide="${isAnime ? 'play' : 'book-open'}"></i>
            <span>${isAnime ? 'Tonton' : 'Baca'}</span>
          </button>
          <button class="btn-secondary btn-hero-info" type="button">
            <i data-lucide="info"></i>
            <span>Info</span>
          </button>
        </div>
      </div>
    `;

    // Enrich with AniList GraphQL (HD landscape banner & rating badge)
    fetchAniList(title).then(meta => {
      if (meta) {
        if (meta.bannerImage) {
          slide.style.backgroundImage = `url('${meta.bannerImage}')`;
        }
        if (meta.ratingFormatted || meta.rating) {
          const ratingEl = slide.querySelector(`#hero-rating-${idx}`);
          if (ratingEl) {
            const valEl = ratingEl.querySelector('.hero-score-val');
            const val = meta.rating ? meta.rating.toFixed(1) : (meta.ratingFormatted || '').replace(/[^\d.]/g, '').trim();
            if (valEl) valEl.textContent = val;
            ratingEl.classList.remove('hidden');
          }
        }
      }
    });

    slide.querySelector('.btn-hero-read')?.addEventListener('click', () => {
      if (isAnime) {
        if (typeof window.openAnimeWatch === 'function') {
          window.openAnimeWatch(item.id, 1, item);
        }
      } else {
        if (typeof onReadClick === 'function') {
          onReadClick(item.id);
        } else if (typeof window.openMangaDetail === 'function') {
          window.openMangaDetail(item.id);
        }
      }
    });

    slide.querySelector('.btn-hero-info')?.addEventListener('click', () => {
      if (isAnime) {
        if (typeof window.openAnimeWatch === 'function') {
          window.openAnimeWatch(item.id, 1, item);
        }
      } else {
        if (typeof onDetailClick === 'function') {
          onDetailClick(item.id);
        } else if (typeof window.openMangaDetail === 'function') {
          window.openMangaDetail(item.id);
        }
      }
    });

    if (!isAnime) {
      attachMangaCardHoverPrefetch(slide, item.id, item);
    }

    container.appendChild(slide);
  });

  // Dots navigation
  const dotsContainer = document.createElement('div');
  dotsContainer.className = 'hero-nav-dots';
  state.heroManga.forEach((_, idx) => {
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
    const nextIdx = (state.activeHeroIndex + 1) % state.heroManga.length;
    goToHeroSlide(nextIdx);
  }, 6000);
}

export function goToHeroSlide(idx) {
  state.activeHeroIndex = idx;
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-nav-dots .dot');

  slides.forEach((s, i) => s.classList.toggle('active', i === idx));
  dots.forEach((d, i) => d.classList.toggle('active', i === idx));
}

export function nextHeroSlide() {
  if (!state.heroManga || state.heroManga.length === 0) return;
  const next = (state.activeHeroIndex + 1) % state.heroManga.length;
  goToHeroSlide(next);
}

export function prevHeroSlide() {
  if (!state.heroManga || state.heroManga.length === 0) return;
  const prev = (state.activeHeroIndex - 1 + state.heroManga.length) % state.heroManga.length;
  goToHeroSlide(prev);
}
