/**
 * HeroBanner Component
 * Netflix-style auto-sliding featured manga carousel
 */

import { state, getMangaTitle, getCoverUrl, initIcons } from '../state.js';
import { fetchAniListBanner } from '../services/api.js';

export function renderHeroBanner(container, items, onReadClick, onDetailClick) {
  if (!container || !items || items.length === 0) return;

  state.heroSlides = items.slice(0, 5);
  state.heroIndex = 0;

  if (state.heroTimer) {
    clearInterval(state.heroTimer);
    state.heroTimer = null;
  }

  container.innerHTML = `
    <div class="hero-slides-wrapper" id="hero-slides-wrapper"></div>
    <button class="hero-nav-btn hero-prev" id="hero-prev" aria-label="Sebelumnya">
      <i data-lucide="chevron-left"></i>
    </button>
    <button class="hero-nav-btn hero-next" id="hero-next" aria-label="Berikutnya">
      <i data-lucide="chevron-right"></i>
    </button>
    <div class="hero-indicators" id="hero-indicators"></div>
  `;

  const wrapper = container.querySelector('#hero-slides-wrapper');
  const indicators = container.querySelector('#hero-indicators');

  state.heroSlides.forEach((manga, idx) => {
    const title = getMangaTitle(manga.attributes);
    const coverUrl = getCoverUrl(manga);
    const synopsis = manga.attributes.description?.id || manga.attributes.description?.en || 'Manga terpopuler pilihan pembaca dengan cerita seru dan visual memukau.';
    const status = manga.attributes.status ? manga.attributes.status.toUpperCase() : 'ONGOING';
    const year = manga.attributes.year || '';

    const slide = document.createElement('div');
    slide.className = `hero-slide ${idx === 0 ? 'active' : ''}`;
    slide.dataset.index = idx;
    slide.innerHTML = `
      <div class="hero-backdrop-img" style="background-image: url('${coverUrl}');"></div>
      <div class="hero-gradient-overlay"></div>
      <div class="hero-content">
        <div class="hero-badges">
          <span class="hero-badge-featured"><i data-lucide="sparkles"></i> Pilihan Utama</span>
          <span class="hero-badge-status">${status}</span>
          ${year ? `<span class="hero-badge-year">${year}</span>` : ''}
        </div>
        <h1 class="hero-title">${title}</h1>
        <p class="hero-synopsis">${synopsis}</p>
        <div class="hero-actions">
          <button class="btn-hero-primary" data-manga-id="${manga.id}" type="button">
            <i data-lucide="book-open"></i>
            <span>Mulai Baca</span>
          </button>
          <button class="btn-hero-secondary" data-manga-id="${manga.id}" type="button">
            <i data-lucide="info"></i>
            <span>Detail Komik</span>
          </button>
        </div>
      </div>
    `;

    // Attempt HD banner from AniList in the background
    fetchAniListBanner(title).then(hdBanner => {
      if (hdBanner) {
        const bg = slide.querySelector('.hero-backdrop-img');
        if (bg) bg.style.backgroundImage = `url('${hdBanner}')`;
      }
    });

    slide.querySelector('.btn-hero-primary')?.addEventListener('click', () => {
      if (typeof onReadClick === 'function') onReadClick(manga.id);
    });

    slide.querySelector('.btn-hero-secondary')?.addEventListener('click', () => {
      if (typeof onDetailClick === 'function') onDetailClick(manga.id);
    });

    wrapper.appendChild(slide);

    const dot = document.createElement('button');
    dot.className = `hero-dot ${idx === 0 ? 'active' : ''}`;
    dot.setAttribute('aria-label', `Slide ${idx + 1}`);
    dot.addEventListener('click', () => goToHeroSlide(idx));
    indicators.appendChild(dot);
  });

  container.querySelector('#hero-prev')?.addEventListener('click', prevHeroSlide);
  container.querySelector('#hero-next')?.addEventListener('click', nextHeroSlide);

  initIcons();
  startHeroTimer();
  initHeroSwipe(container);
}

function updateHeroSlide(index) {
  state.heroIndex = index;
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-dot');

  slides.forEach((slide, idx) => {
    slide.classList.toggle('active', idx === index);
  });

  dots.forEach((dot, idx) => {
    dot.classList.toggle('active', idx === index);
  });
}

export function nextHeroSlide() {
  if (state.heroSlides.length === 0) return;
  const next = (state.heroIndex + 1) % state.heroSlides.length;
  updateHeroSlide(next);
}

export function prevHeroSlide() {
  if (state.heroSlides.length === 0) return;
  const prev = (state.heroIndex - 1 + state.heroSlides.length) % state.heroSlides.length;
  updateHeroSlide(prev);
}

export function goToHeroSlide(index) {
  updateHeroSlide(index);
  startHeroTimer();
}

function startHeroTimer() {
  if (state.heroTimer) clearInterval(state.heroTimer);
  state.heroTimer = setInterval(() => {
    nextHeroSlide();
  }, 6000);
}

function initHeroSwipe(container) {
  let touchStartX = 0;
  let touchEndX = 0;

  container.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX - touchEndX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) nextHeroSlide();
      else prevHeroSlide();
      startHeroTimer();
    }
  }, { passive: true });
}
