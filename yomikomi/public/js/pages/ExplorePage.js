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
          <h1 class="explore-hero-title">Jelajah Manga & Manhwa</h1>
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
    renderExploreFeed(data);
  } catch (err) {
    console.error('Failed to load explore feed:', err);
    if (!state.exploreData) {
      container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="alert-circle"></i>
          <h4>Gagal Memuat Katalog Jelajah</h4>
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

export function renderExploreFeed(data) {
  const container = document.getElementById('explore-feed');
  if (!container) return;
  container.innerHTML = '';

  const sections = [
    {
      id: 'recommended',
      title: 'Recommended',
      icon: 'sparkles',
      items: data.recommended || [],
      seeAllFilter: 'popular'
    },
    {
      id: 'recentlyAdded',
      title: 'Recently Added',
      icon: 'compass',
      items: data.recentlyAdded || [],
      seeAllFilter: 'latest'
    },
    {
      id: 'latestUpdates',
      title: 'Latest Updates',
      icon: 'clock',
      items: data.latestUpdates || [],
      seeAllFilter: 'latest'
    },
    {
      id: 'selfPublished',
      title: 'Self-Published & Web Comic',
      icon: 'feather',
      items: data.selfPublished || [],
      tagId: '891cf039-b895-47f0-9229-bef4c96eccd4',
      tagName: 'Self-Published'
    },
    {
      id: 'romance',
      title: 'Romance & Drama',
      icon: 'heart',
      items: data.romance || [],
      tagId: '423e2eae-a7a2-4a8b-ac03-a8351462d71d',
      tagName: 'Romance'
    },
    {
      id: 'action',
      title: 'Action & Adventure',
      icon: 'zap',
      items: data.action || [],
      tagId: '391b0423-d847-456f-aff0-8b0cfc03066b',
      tagName: 'Action'
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
          <div class="explore-section-icon"><i data-lucide="${sec.icon}"></i></div>
          <h2 class="explore-section-title">${sec.title}</h2>
          <span class="explore-section-count">${sec.items.length} Judul</span>
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
      if (sec.tagId && sec.tagName) {
        if (typeof window.resetGenreSelection === 'function') {
          const allChips = document.querySelectorAll('.genre-chip');
          allChips.forEach(c => {
            if (c.dataset.genreId === sec.tagId) c.click();
          });
        }
      } else {
        const filterTab = document.querySelector(`.filter-tab[data-filter="${sec.seeAllFilter}"]`);
        filterTab?.click();
      }
    });

    container.appendChild(secEl);
  });

  initIcons();
}
