/**
 * Navbar Component
 * Desktop & Tablet navigation bar with search triggers, brand logo, and menu buttons
 */

import { state, initIcons } from '../state.js';
import { openSearchModal } from './SearchModal.js';
import { openMobileDrawer } from './MobileDrawer.js';

export function renderNavbarMarkup() {
  return `
    <header class="navbar" id="main-navbar">
      <div class="nav-container">
        <div class="nav-brand" id="brand-logo" role="button" tabindex="0">
          <div class="brand-icon">
            <i data-lucide="book-open"></i>
          </div>
          <div class="brand-text">
            <span class="brand-title">Yomi<span class="text-accent">komi</span></span>
          </div>
        </div>

        <nav class="nav-links">
          <button class="nav-link" id="nav-btn-explore">
            <i data-lucide="compass"></i>
            <span>Explore</span>
          </button>
          <button class="nav-link" id="nav-btn-bookmarks">
            <i data-lucide="bookmark"></i>
            <span>Bookmark</span>
            <span class="nav-count-badge hidden" id="badge-nav-bookmarks">0</span>
          </button>
          <button class="nav-link" id="nav-btn-history">
            <i data-lucide="clock"></i>
            <span>Riwayat Baca</span>
          </button>
          <button class="nav-link" id="nav-btn-offline">
            <i data-lucide="hard-drive"></i>
            <span>Offline Library</span>
          </button>
        </nav>

        <div class="nav-actions">
          <button class="search-trigger-btn" id="search-trigger" title="Cari Manga (Ctrl + K)">
            <i data-lucide="search"></i>
            <span class="search-trigger-text">Cari komik...</span>
            <kbd class="search-kbd">Ctrl K</kbd>
          </button>
          <button class="btn-install-app hidden" id="btn-install-app" title="Install Aplikasi Yomikomi" aria-label="Install Aplikasi Yomikomi" type="button">
            <i data-lucide="download-cloud"></i>
          </button>
          <button class="mobile-search-btn" id="mobile-search-trigger" title="Cari Komik" aria-label="Cari Komik">
            <i data-lucide="search"></i>
          </button>
          <button class="mobile-menu-btn" id="btn-mobile-menu" aria-label="Buka Menu Navigasi" title="Menu Navigasi">
            <i data-lucide="menu"></i>
          </button>
        </div>
      </div>
    </header>
  `;
}

export function initNavbarEvents({ onNavigate, onOpenSearch, onOpenDrawer } = {}) {
  const navigate = onNavigate || ((view, sub) => {
    if (typeof window.switchView === 'function') window.switchView(view);
    if (view === 'history' && sub && typeof window.switchCollectionTab === 'function') {
      window.switchCollectionTab(sub);
    }
  });

  const openSearch = onOpenSearch || openSearchModal;
  const openDrawer = onOpenDrawer || openMobileDrawer;

  document.getElementById('brand-logo')?.addEventListener('click', () => {
    navigate('home');
  });

  document.getElementById('nav-btn-explore')?.addEventListener('click', () => {
    navigate('explore');
  });

  document.getElementById('nav-btn-bookmarks')?.addEventListener('click', () => {
    navigate('history', 'bookmarks');
  });

  document.getElementById('nav-btn-history')?.addEventListener('click', () => {
    navigate('history', 'history');
  });

  document.getElementById('nav-btn-offline')?.addEventListener('click', () => {
    navigate('offline');
  });

  document.getElementById('search-trigger')?.addEventListener('click', openSearch);
  document.getElementById('mobile-search-trigger')?.addEventListener('click', openSearch);
  document.getElementById('btn-mobile-menu')?.addEventListener('click', openDrawer);

  initIcons();
}
