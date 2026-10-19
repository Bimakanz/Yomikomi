/**
 * MobileDrawer Component
 * Off-canvas mobile navigation drawer with touch gesture support
 */

import { state, initIcons } from '../state.js';
import { openSearchModal } from './SearchModal.js';

export function renderMobileDrawerMarkup() {
  return `
    <div class="mobile-drawer-backdrop" id="mobile-drawer-backdrop"></div>
    <aside class="mobile-drawer" id="mobile-drawer" aria-label="Menu Navigasi Mobile">
      <div class="drawer-header">
        <div class="drawer-brand" role="button" tabindex="0">
          <div class="brand-icon"><i data-lucide="book-open"></i></div>
          <div class="brand-text">
            <span class="brand-title">Yomi<span class="text-accent">komi</span></span>
          </div>
        </div>
        <button class="drawer-close-btn" id="btn-close-drawer" aria-label="Tutup Menu">
          <i data-lucide="x"></i>
        </button>
      </div>

      <div class="drawer-search-wrap">
        <button class="drawer-search-btn" id="drawer-search-trigger" type="button">
          <i data-lucide="search"></i>
          <span>Cari Komik Favorit...</span>
        </button>
      </div>

      <nav class="drawer-nav-list">
        <button class="drawer-nav-item" id="drawer-nav-explore">
          <i data-lucide="compass"></i>
          <span>Explore</span>
        </button>
        <button class="drawer-nav-item" id="drawer-nav-bookmarks">
          <i data-lucide="bookmark"></i>
          <div class="drawer-item-content">
            <span>Bookmark Saya</span>
            <span class="drawer-badge" id="drawer-badge-bookmarks">0</span>
          </div>
        </button>
        <button class="drawer-nav-item" id="drawer-nav-history">
          <i data-lucide="clock"></i>
          <div class="drawer-item-content">
            <span>Riwayat Baca</span>
            <span class="drawer-badge" id="drawer-badge-history">0</span>
          </div>
        </button>
        <button class="drawer-nav-item" id="drawer-nav-offline">
          <i data-lucide="hard-drive"></i>
          <div class="drawer-item-content">
            <span>Offline Library</span>
          </div>
        </button>
      </nav>

      <div class="drawer-install-wrap hidden" id="drawer-install-wrap">
        <button class="drawer-install-btn" id="drawer-btn-install" type="button">
          <div class="drawer-install-left">
            <div class="drawer-install-icon">
              <i data-lucide="download-cloud"></i>
            </div>
            <div class="drawer-install-text">
              <span class="drawer-install-title">📲 Install Aplikasi</span>
              <span class="drawer-install-desc">Pasang di Layar HP / Laptop (Offline Siap)</span>
            </div>
          </div>
          <span class="drawer-install-pill">GRATIS</span>
        </button>
      </div>
    </aside>
  `;
}

export function openMobileDrawer() {
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('mobile-drawer-backdrop');
  drawer?.classList.add('open');
  backdrop?.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

export function closeMobileDrawer() {
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('mobile-drawer-backdrop');
  drawer?.classList.remove('open');
  backdrop?.classList.remove('visible');
  document.body.style.overflow = '';
}

export function initMobileDrawerEvents({ onNavigate, onOpenSearch } = {}) {
  const navigate = onNavigate || ((view, sub) => {
    if (typeof window.switchView === 'function') window.switchView(view);
    if (view === 'history' && sub && typeof window.switchCollectionTab === 'function') {
      window.switchCollectionTab(sub);
    }
  });

  const openSearch = onOpenSearch || openSearchModal;

  const btnClose = document.getElementById('btn-close-drawer');
  const backdrop = document.getElementById('mobile-drawer-backdrop');

  btnClose?.addEventListener('click', closeMobileDrawer);
  backdrop?.addEventListener('click', closeMobileDrawer);

  document.querySelector('.drawer-brand')?.addEventListener('click', () => {
    closeMobileDrawer();
    navigate('home');
  });

  document.getElementById('drawer-search-trigger')?.addEventListener('click', () => {
    closeMobileDrawer();
    openSearch();
  });

  document.getElementById('drawer-nav-explore')?.addEventListener('click', () => {
    closeMobileDrawer();
    navigate('explore');
  });

  document.getElementById('drawer-nav-bookmarks')?.addEventListener('click', () => {
    closeMobileDrawer();
    navigate('history', 'bookmarks');
  });

  document.getElementById('drawer-nav-history')?.addEventListener('click', () => {
    closeMobileDrawer();
    navigate('history', 'history');
  });

  document.getElementById('drawer-nav-offline')?.addEventListener('click', () => {
    closeMobileDrawer();
    navigate('offline');
  });

  // Swipe edge gesture to open/close drawer on mobile touch screens
  let touchStartX = 0;
  let touchStartY = 0;

  document.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    if (state.currentView === 'reader') return;

    const diffX = e.changedTouches[0].clientX - touchStartX;
    const diffY = e.changedTouches[0].clientY - touchStartY;

    if (Math.abs(diffX) > 60 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      const windowWidth = window.innerWidth;
      const drawer = document.getElementById('mobile-drawer');
      const isOpen = drawer?.classList.contains('open');

      if (!isOpen && touchStartX > windowWidth - 40 && diffX < -50) {
        openMobileDrawer();
      } else if (isOpen && diffX > 50) {
        closeMobileDrawer();
      }
    }
  }, { passive: true });

  initIcons();
}
