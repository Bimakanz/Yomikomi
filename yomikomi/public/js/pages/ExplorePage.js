/**
 * ExplorePage
 * Browse manga categories (Recommended, Recently Added, Latest Updates, Self-Published, Romance, Action)
 * Horizontal carousels with mousewheel scroll, synopsis hover overlay, and quick navigation
 */

import { state, initIcons, getMangaTitle, getCoverUrl, getLanguageFlag, CoverCache } from '../state.js';
import { createExploreCard } from '../components/MangaCard.js';

export function renderExplorePageMarkup() {
  return `
    <section class="view-section hidden" id="view-explore">
      <div class="explore-hero-bar">
        <div class="explore-hero-left">
          <h1 class="explore-hero-title">Explore Manga & Manhwa</h1>
          <p class="explore-hero-desc">Temukan ribuan karya pilihan dari rekomendasi teratas, rilis chapter terbaru, hingga rilisan self-published orisinal.</p>
        </div>
      </div>

      <!-- Explore Feeds Container -->
      <div class="explore-feed" id="explore-feed">
        <div class="explore-loading-state" id="explore-loading-state">
          <div class="spinner" style="margin: 3.5rem auto;"></div>
        </div>
      </div>
    </section>
  `;
}

export async function loadExploreFeed() {
  const container = document.getElementById('explore-feed');
  if (!container) return;

  // Instant 0ms render from memory or sessionStorage cache
  if (!state.exploreData) {
    try {
      const cached = sessionStorage.getItem('yomikomi_explore_cache');
      if (cached) {
        state.exploreData = JSON.parse(cached);
        renderExploreFeed(state.exploreData);
      }
    } catch (e) {}
  } else {
    renderExploreFeed(state.exploreData);
  }

  if (!state.exploreData) {
    container.innerHTML = `
      <div class="explore-loading-state">
        <div class="spinner" style="margin: 3.5rem auto;"></div>
      </div>
    `;
  }

  try {
    const res = await fetch('/api/explore');
    const data = await res.json();
    state.exploreData = data;
    try {
      sessionStorage.setItem('yomikomi_explore_cache', JSON.stringify(data));
    } catch (e) {}
    renderExploreFeed(data);
  } catch (err) {
    console.error('Failed to load explore feed:', err);
    if (!state.exploreData) {
      container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="alert-circle"></i>
          <h4>Gagal Memuat Katalog Explore</h4>
          <p>Terjadi kendala saat menghubungkan ke server katalog. Silakan coba lagi.</p>
          <button class="btn-primary" id="btn-retry-explore" style="margin-top: 1rem;">
            <i data-lucide="refresh-cw"></i> Coba Lagi
          </button>
        </div>
      `;
      document.getElementById('btn-retry-explore')?.addEventListener('click', loadExploreFeed);
      initIcons();
    }
  }
}
window.loadExploreFeed = loadExploreFeed;

export function renderExploreFeed(data) {
  const container = document.getElementById('explore-feed');
  if (!container) return;
  container.innerHTML = '';

  const sections = [
    {
      id: 'recommended',
      title: 'Recommended',
      seeAllTitle: 'Rekomendasi Pilihan (Recommended)',
      fetchUrl: '/api/search?order=followedCount&limit=40',
      icon: 'sparkles',
      items: data.recommended || []
    },
    {
      id: 'recentlyAdded',
      title: 'Recently Added',
      seeAllTitle: 'Komik Baru Ditambahkan (Recently Added)',
      fetchUrl: '/api/search?order=createdAt&limit=40',
      icon: 'compass',
      items: data.recentlyAdded || []
    },
    {
      id: 'latestUpdates',
      title: 'Latest Updates',
      seeAllTitle: 'Rilis Chapter Terbaru (Latest Updates)',
      fetchUrl: '/api/search?order=latest&limit=40',
      icon: 'clock',
      items: data.latestUpdates || []
    },
    {
      id: 'selfPublished',
      title: 'Self-Published & Web Comic',
      seeAllTitle: 'Koleksi: Self-Published & Web Comic',
      fetchUrl: '/api/search?tag=891cf039-b895-47f0-9229-bef4c96eccd4&order=followedCount&limit=40',
      icon: 'feather',
      items: data.selfPublished || []
    },
    {
      id: 'romance',
      title: 'Romance & Drama',
      seeAllTitle: 'Koleksi Genre: Romance & Drama',
      fetchUrl: '/api/search?tag=423e2eae-a7a2-4a8b-ac03-a8351462d71d&order=followedCount&limit=40',
      icon: 'heart',
      items: data.romance || []
    },
    {
      id: 'action',
      title: 'Action & Adventure',
      seeAllTitle: 'Koleksi Genre: Action & Adventure',
      fetchUrl: '/api/search?tag=391b0423-d847-456f-aff0-8b0cfc03066b&order=followedCount&limit=40',
      icon: 'zap',
      items: data.action || []
    }
  ];

  sections.forEach(sec => {
    if (!sec.items || sec.items.length === 0) return;

    sec.items.forEach(m => {
      CoverCache.set(m.id, getMangaTitle(m.attributes), getCoverUrl(m));
    });

    const secEl = document.createElement('section');
    secEl.className = 'explore-section';
    secEl.innerHTML = `
      <div class="explore-section-header">
        <div class="explore-section-title-wrap">
          <h2 class="explore-section-title">${sec.title}</h2>
        </div>
        <div class="explore-section-nav">
          <button class="explore-nav-btn prev" type="button" aria-label="Sebelumnya" title="Geser ke kiri">
            <i data-lucide="chevron-left"></i>
          </button>
          <button class="explore-nav-btn next" type="button" aria-label="Berikutnya" title="Geser ke kanan">
            <i data-lucide="chevron-right"></i>
          </button>
          <button class="explore-see-all-btn" type="button" title="Lihat Selengkapnya">
            <span>Lihat Semua</span>
            <i data-lucide="arrow-right"></i>
          </button>
        </div>
      </div>
      <div class="explore-carousel-wrap">
        <div class="explore-carousel-track" id="track-${sec.id}"></div>
      </div>
    `;

    const track = secEl.querySelector(`#track-${sec.id}`);

    sec.items.forEach(manga => {
      const card = createExploreCard(manga, (mangaId) => {
        if (typeof window.openMangaDetail === 'function') {
          window.openMangaDetail(mangaId);
        }
      });
      track.appendChild(card);
    });

    // MOUSE WHEEL SCROLL LISTENER (Scroll up/down moves left/right smoothly)
    track.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        track.scrollBy({
          left: e.deltaY * 1.8,
          behavior: 'auto'
        });
      }
    }, { passive: false });

    // Prev / Next button actions
    const prevBtn = secEl.querySelector('.explore-nav-btn.prev');
    const nextBtn = secEl.querySelector('.explore-nav-btn.next');
    prevBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      track.scrollBy({ left: -track.clientWidth * 0.75, behavior: 'smooth' });
    });
    nextBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      track.scrollBy({ left: track.clientWidth * 0.75, behavior: 'smooth' });
    });

    // "Lihat Semua" button action
    const seeAllBtn = secEl.querySelector('.explore-see-all-btn');
    seeAllBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window.switchView === 'function') {
        window.switchView('home');
      }
      if (typeof window.loadExploreCategory === 'function') {
        window.loadExploreCategory(sec.seeAllTitle || sec.title, sec.fetchUrl);
      }
    });

    container.appendChild(secEl);
  });

  initIcons();
}
