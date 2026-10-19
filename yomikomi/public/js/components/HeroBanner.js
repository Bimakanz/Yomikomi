/**
 * HeroBanner Component
 * Featured hero carousel matching Yomikomi design & style.css
 */

import { state, getMangaTitle, getCoverUrl, initIcons } from '../state.js';
import { fetchAniList } from '../services/api.js';

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

  state.heroManga.forEach((manga, idx) => {
    const title = getMangaTitle(manga.attributes);
    const coverUrl = getCoverUrl(manga);
    const desc = manga.attributes.description?.id || manga.attributes.description?.en || 'Jelajahi petualangan manga menakjubkan ini secara gratis di Yomikomi.';
    const status = manga.attributes.status?.toUpperCase() || 'ONGOING';
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
          <span class="badge-tag rating-badge hidden" id="hero-rating-${idx}"></span>
        </div>
        <h1 class="hero-title">${title}</h1>
        <p class="hero-desc">${desc}</p>
        <div class="hero-actions">
          <button class="btn-primary btn-hero-read" type="button">
            <i data-lucide="book-open"></i>
            <span>Baca</span>
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
        if (meta.ratingFormatted) {
          const ratingEl = slide.querySelector(`#hero-rating-${idx}`);
          if (ratingEl) {
            ratingEl.textContent = meta.ratingFormatted;
            ratingEl.classList.remove('hidden');
          }
        }
      }
    });

    slide.querySelector('.btn-hero-read')?.addEventListener('click', () => {
      if (typeof onReadClick === 'function') {
        onReadClick(manga.id);
      } else if (typeof window.openMangaDetail === 'function') {
        window.openMangaDetail(manga.id);
      }
    });

    slide.querySelector('.btn-hero-info')?.addEventListener('click', () => {
      if (typeof onDetailClick === 'function') {
        onDetailClick(manga.id);
      } else if (typeof window.openMangaDetail === 'function') {
        window.openMangaDetail(manga.id);
      }
    });

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
