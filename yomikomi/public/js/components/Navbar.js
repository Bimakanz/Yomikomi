/**
 * Navbar Component
 * Desktop & Tablet navigation bar with search triggers, brand logo, and menu buttons
 */

import { state, initIcons } from '../state.js';

export function renderNavbarMarkup() {
  return `
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
          <span>Jelajah</span>
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
        <button class="btn-install-app hidden" id="btn-install-app" title="📲 Install Aplikasi Yomikomi" type="button">
          <i data-lucide="download-cloud"></i>
          <span class="btn-install-label">Install App</span>
        </button>
        <button class="mobile-search-btn" id="mobile-search-trigger" title="Cari Komik" aria-label="Cari Komik">
          <i data-lucide="search"></i>
        </button>
        <button class="mobile-menu-btn" id="btn-mobile-menu" aria-label="Buka Menu Navigasi" title="Menu Navigasi">
          <i data-lucide="menu"></i>
        </button>
      </div>
    </div>
  `;
}

export function initNavbarEvents({ onNavigate, onOpenSearch, onOpenDrawer }) {
  document.getElementById('brand-logo')?.addEventListener('click', () => {
    onNavigate('home');
  });

  document.getElementById('nav-btn-explore')?.addEventListener('click', () => {
    onNavigate('explore');
  });

  document.getElementById('nav-btn-bookmarks')?.addEventListener('click', () => {
    onNavigate('history', 'bookmarks');
  });

  document.getElementById('nav-btn-history')?.addEventListener('click', () => {
    onNavigate('history', 'history');
  });

  document.getElementById('nav-btn-offline')?.addEventListener('click', () => {
    onNavigate('offline');
  });

  document.getElementById('search-trigger')?.addEventListener('click', onOpenSearch);
  document.getElementById('mobile-search-trigger')?.addEventListener('click', onOpenSearch);
  document.getElementById('btn-mobile-menu')?.addEventListener('click', onOpenDrawer);

  initIcons();
}
