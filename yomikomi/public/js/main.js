/**
 * Yomikomi - Main Application Entry Point
 * Mounts modular architecture, SPA routing, state initialization, and PWA offline handlers
 */

import { state, initIcons, showToast, revokeActiveObjectUrls } from './state.js';
import { renderNavbarMarkup, initNavbarEvents } from './components/Navbar.js';
import { renderMobileDrawerMarkup, initMobileDrawerEvents, openMobileDrawer, closeMobileDrawer } from './components/MobileDrawer.js';
import { renderSearchModalMarkup, initSearchModalEvents, openSearchModal, closeSearchModal } from './components/SearchModal.js';
import { renderDownloadQueueMarkup, initDownloadQueueEvents } from './components/DownloadQueue.js';
import { renderHomePageMarkup, initHomePage, loadPopularManga } from './pages/HomePage.js';
import { renderExplorePageMarkup, loadExploreFeed } from './pages/ExplorePage.js';
import { renderDetailPageMarkup, initDetailPageEvents, openMangaDetail } from './pages/DetailPage.js';
import { renderBookmarkPageMarkup, initBookmarkPageEvents, switchCollectionTab, resumeReadingChapter, renderBookmarksList, renderHistoryList } from './pages/BookmarkPage.js';
import { renderOfflinePageMarkup, initOfflinePageEvents, renderOfflineLibraryView } from './pages/OfflinePage.js';
import { openReader, initReaderControls, openExternalReader, openEnglishReader } from './components/Reader.js';
import { toggleBookmark, refreshBookmarkSet, updateAllCollectionBadges } from './services/storage.js';


let deferredPWAInstallPrompt = null;

// Capture beforeinstallprompt immediately
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPWAInstallPrompt = e;
  console.log('[Yomikomi PWA] beforeinstallprompt event captured');

  const btnNav = document.getElementById('btn-install-app');
  const wrapDrawer = document.getElementById('drawer-install-wrap');
  if (btnNav && !isPWARunningStandalone()) btnNav.classList.remove('hidden');
  if (wrapDrawer && !isPWARunningStandalone()) wrapDrawer.classList.remove('hidden');
  initIcons();
});

export function isPWARunningStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://')
  );
}

export function isDeviceIOS() {
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) && !window.MSStream;
}

export function registerAppServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('[Yomikomi PWA] Service Worker aktif! Scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('[Yomikomi PWA] Registrasi Service Worker gagal:', err);
        });
    });
  }
}

export function initPWA() {
  registerAppServiceWorker();

  const installBtnNav = document.getElementById('btn-install-app');
  const installWrapDrawer = document.getElementById('drawer-install-wrap');
  const installBtnDrawer = document.getElementById('drawer-btn-install');
  const iosModal = document.getElementById('ios-install-modal');
  const btnCloseIosModal = document.getElementById('btn-close-ios-modal');
  const btnIosUnderstand = document.getElementById('btn-ios-understand');

  const hideAllInstallButtons = () => {
    if (installBtnNav) installBtnNav.classList.add('hidden');
    if (installWrapDrawer) installWrapDrawer.classList.add('hidden');
  };

  const showAllInstallButtons = () => {
    if (installBtnNav) installBtnNav.classList.remove('hidden');
    if (installWrapDrawer) installWrapDrawer.classList.remove('hidden');
    initIcons();
  };

  if (isPWARunningStandalone()) {
    hideAllInstallButtons();
    return;
  }

  if (deferredPWAInstallPrompt || isDeviceIOS()) {
    showAllInstallButtons();
  }

  const handleInstallClick = async () => {
    if (deferredPWAInstallPrompt) {
      try {
        deferredPWAInstallPrompt.prompt();
        const choice = await deferredPWAInstallPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          showToast('Terima kasih telah memasang aplikasi Yomikomi! 🎉');
          hideAllInstallButtons();
        }
      } catch (err) {
        console.warn('[Yomikomi PWA] Gagal memanggil prompt:', err);
      }
      deferredPWAInstallPrompt = null;
    } else if (isDeviceIOS()) {
      if (iosModal) {
        iosModal.classList.remove('hidden');
        initIcons();
      }
    } else {
      showToast('Aplikasi siap di-install! Buka menu browser (titik 3 di kanan atas) lalu pilih "Install Aplikasi" atau "Tambahkan ke Layar Utama".');
    }
  };

  installBtnNav?.addEventListener('click', handleInstallClick);
  installBtnDrawer?.addEventListener('click', () => {
    closeMobileDrawer();
    handleInstallClick();
  });

  btnCloseIosModal?.addEventListener('click', () => {
    iosModal?.classList.add('hidden');
  });
  btnIosUnderstand?.addEventListener('click', () => {
    iosModal?.classList.add('hidden');
  });
  iosModal?.addEventListener('click', (e) => {
    if (e.target === iosModal) {
      iosModal.classList.add('hidden');
    }
  });

  try {
    const displayModeQuery = window.matchMedia('(display-mode: standalone)');
    displayModeQuery.addEventListener('change', (e) => {
      if (e.matches) {
        hideAllInstallButtons();
      }
    });
  } catch (e) { }

  window.addEventListener('appinstalled', () => {
    showToast('Yomikomi berhasil terpasang di perangkat Anda! 📲');
    deferredPWAInstallPrompt = null;
    hideAllInstallButtons();
  });

  window.addEventListener('offline', () => {
    showToast('⚠️ Koneksi terputus. Anda dapat tetap membaca manga dari Offline Library!');
  });
  window.addEventListener('online', () => {
    showToast('✅ Koneksi internet kembali aktif.');
  });
}

export function switchView(viewName) {
  if (state.currentView !== viewName && state.currentView !== 'reader') {
    state.previousView = state.currentView;
  }
  state.currentView = viewName;

  if (viewName !== 'reader') {
    revokeActiveObjectUrls();
  }

  const views = ['home', 'explore', 'detail', 'reader', 'history', 'offline'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) {
      if (v === viewName) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  });

  const navbar = document.getElementById('main-navbar');
  if (viewName === 'reader') {
    navbar?.classList.add('hidden');
    document.body.style.overflow = 'hidden';
    const readerEl = document.getElementById('view-reader');
    if (readerEl) readerEl.scrollTop = 0;
    window.scrollTo(0, 0);
  } else {
    navbar?.classList.remove('hidden');
    document.body.style.overflow = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.drawer-nav-item').forEach(btn => btn.classList.remove('active'));

  if (viewName === 'explore') {
    document.getElementById('nav-btn-explore')?.classList.add('active');
    document.getElementById('drawer-nav-explore')?.classList.add('active');
    loadExploreFeed();
  }
  if (viewName === 'history') {
    if (state.currentCollectionTab === 'history') {
      document.getElementById('nav-btn-history')?.classList.add('active');
      document.getElementById('drawer-nav-history')?.classList.add('active');
      switchCollectionTab('history');
    } else {
      document.getElementById('nav-btn-bookmarks')?.classList.add('active');
      document.getElementById('drawer-nav-bookmarks')?.classList.add('active');
      switchCollectionTab('bookmarks');
    }
  }
  if (viewName === 'offline') {
    document.getElementById('nav-btn-offline')?.classList.add('active');
    document.getElementById('drawer-nav-offline')?.classList.add('active');
    renderOfflineLibraryView();
  }

  updateAllCollectionBadges();
  initIcons();
}

function renderReaderViewMarkup() {
  return `
    <section class="view-section hidden" id="view-reader">
      <header class="reader-toolbar" id="reader-toolbar">
        <div class="reader-toolbar-left">
          <button class="reader-btn" id="reader-btn-back" title="Kembali ke Info Komik">
            <i data-lucide="chevron-left"></i>
            <span>Kembali</span>
          </button>
          <div class="reader-title-info">
            <h4 class="reader-manga-title" id="reader-manga-title">Memuat Manga...</h4>
            <span class="reader-chapter-title" id="reader-chapter-title">Chapter ...</span>
          </div>
        </div>

        <div class="reader-toolbar-center">
          <div class="custom-chapter-dropdown" id="custom-chapter-dropdown">
            <button class="custom-dropdown-trigger" id="custom-chapter-trigger" type="button" title="Pindah Chapter Cepat">
              <i data-lucide="book-open"></i>
              <span class="trigger-label" id="custom-chapter-label">Pilih Chapter...</span>
              <i data-lucide="chevron-down" class="trigger-arrow"></i>
            </button>
            <div class="custom-dropdown-panel hidden" id="custom-chapter-panel">
              <div class="dropdown-search-wrap">
                <i data-lucide="search"></i>
                <input type="text" id="dropdown-chapter-search" placeholder="Cari chapter..." autocomplete="off">
              </div>
              <div class="custom-dropdown-list" id="custom-chapter-list"></div>
            </div>
            <select id="reader-chapter-select" class="reader-select hidden">
              <option value="">Pilih Chapter...</option>
            </select>
          </div>
          <div class="reader-page-counter" id="reader-page-counter">
            <i data-lucide="file-text"></i>
            <span id="page-counter-text">0 / 0</span>
          </div>
        </div>

        <div class="reader-toolbar-right">
          <div class="reader-more-dropdown-wrap" id="reader-more-dropdown-wrap">
            <button class="reader-btn-icon" id="reader-more-btn" title="Mode Baca & Pengaturan" aria-label="Mode Baca & Pengaturan" type="button">
              <i data-lucide="more-vertical"></i>
            </button>
            <div class="reader-more-menu hidden" id="reader-more-menu">
              <div class="reader-menu-header">
                <i data-lucide="sliders-horizontal"></i>
                <span>Pengaturan Membaca</span>
              </div>
              <div class="reader-menu-section">
                <span class="reader-menu-section-label">Pilih Mode Tampilan</span>
                <button class="reader-mode-opt active" data-mode="auto" type="button">
                  <i data-lucide="sparkles"></i>
                  <div class="opt-text">
                    <span class="opt-name">Mode Pintar (Auto) ⚡</span>
                    <span class="opt-sub" id="mode-auto-status">Otomatis Webtoon / Single</span>
                  </div>
                  <i data-lucide="check" class="opt-check"></i>
                </button>
                <button class="reader-mode-opt" data-mode="long-strip" type="button">
                  <i data-lucide="scroll"></i>
                  <div class="opt-text">
                    <span class="opt-name">Mode Webtoon</span>
                    <span class="opt-sub">Scroll vertikal bersambung</span>
                  </div>
                  <i data-lucide="check" class="opt-check"></i>
                </button>
                <button class="reader-mode-opt" data-mode="single" type="button">
                  <i data-lucide="file"></i>
                  <div class="opt-text">
                    <span class="opt-name">Mode Single Page</span>
                    <span class="opt-sub">Satu halaman per layar</span>
                  </div>
                  <i data-lucide="check" class="opt-check"></i>
                </button>
                <button class="reader-mode-opt" data-mode="double" type="button">
                  <i data-lucide="book-open"></i>
                  <div class="opt-text">
                    <span class="opt-name">Mode Double Page</span>
                    <span class="opt-sub">Dua halaman berdampingan</span>
                  </div>
                  <i data-lucide="check" class="opt-check"></i>
                </button>
              </div>
              <div class="reader-menu-divider"></div>
              <div class="reader-menu-section">
                <span class="reader-menu-section-label">Opsi Tampilan & Kuota</span>
                <button class="reader-menu-action" id="menu-quality-toggle" type="button">
                  <i data-lucide="zap"></i>
                  <div class="opt-text">
                    <span class="opt-name">Kualitas Gambar</span>
                    <span class="opt-sub" id="menu-quality-status">Data Saver (Hemat)</span>
                  </div>
                </button>
                <button class="reader-menu-action" id="menu-fullscreen-toggle" type="button">
                  <i data-lucide="maximize"></i>
                  <div class="opt-text">
                    <span class="opt-name">Layar Penuh (Fullscreen)</span>
                    <span class="opt-sub">Membaca lebih leluasa</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div class="reader-viewport long-strip-mode" id="reader-viewport">
        <div class="reader-loading" id="reader-loading">
          <div class="spinner"></div>
          <p>Memuat halaman komik...</p>
        </div>
      </div>

      <footer class="reader-footer" id="reader-footer">
        <button class="reader-nav-btn" id="btn-prev-chapter" title="Sebelumnya" type="button">
          <i data-lucide="chevron-left"></i>
          <span class="btn-text" id="btn-prev-text">Sebelumnya</span>
        </button>
        <div class="reader-footer-info" id="reader-footer-info">
          <span id="footer-chapter-pill">Chapter ...</span>
        </div>
        <button class="reader-nav-btn primary" id="btn-next-chapter" title="Selanjutnya" type="button">
          <span class="btn-text" id="btn-next-text">Selanjutnya</span>
          <i data-lucide="chevron-right"></i>
        </button>
      </footer>
    </section>
  `;
}

function renderIOSModalMarkup() {
  return `
    <div class="modal-overlay hidden" id="ios-install-modal">
      <div class="ios-install-box">
        <button class="ios-modal-close" id="btn-close-ios-modal" aria-label="Tutup"><i data-lucide="x"></i></button>
        <div class="ios-install-header">
          <img src="/icons/icon-192.png" alt="Yomikomi App" class="ios-install-app-icon">
          <div class="ios-install-header-text">
            <h3 class="ios-install-title">Install Yomikomi di iPhone / iPad</h3>
            <p class="ios-install-subtitle">Aplikasi Web Mandiri • Hemat Kuota & Siap Offline</p>
          </div>
        </div>
        <div class="ios-steps-container">
          <div class="ios-step-card">
            <div class="ios-step-badge">1</div>
            <div class="ios-step-content">
              <p>Ketuk tombol <strong>Share / Bagikan</strong> (<i data-lucide="share" class="inline-ios-icon"></i>) pada bilah bawah browser Safari Anda.</p>
            </div>
          </div>
          <div class="ios-step-card">
            <div class="ios-step-badge">2</div>
            <div class="ios-step-content">
              <p>Gulir menu dan pilih opsi <strong>"Add to Home Screen"</strong> / <strong>"Tambahkan ke Layar Utama"</strong> (<i data-lucide="plus-square" class="inline-ios-icon"></i>).</p>
            </div>
          </div>
          <div class="ios-step-card">
            <div class="ios-step-badge">3</div>
            <div class="ios-step-content">
              <p>Ketuk tombol <strong>Add / Tambah</strong> di pojok kanan atas. Ikon Yomikomi langsung siap diakses dari Home Screen Anda!</p>
            </div>
          </div>
        </div>
        <button class="btn-primary btn-block ios-confirm-btn" id="btn-ios-understand">Saya Mengerti</button>
      </div>
    </div>
  `;
}

function renderSiteFooterMarkup() {
  return `
    <footer class="site-footer">
      <div class="footer-container">
        <div class="footer-info">
          <p><strong>Yomikomi</strong> — Platform pembaca manga & manhwa pribadi.</p>
          <p class="footer-subtext">Data komik, sinopsis, dan gambar didukung oleh server katalog komik. Hak cipta milik pembuat komik dan scanlation group terkait.</p>
        </div>
        <div class="footer-badges">
          <span class="footer-badge">Yomikomi Engine</span>
          <span class="footer-badge">Fast CDN</span>
          <span class="footer-badge">No Ads / Free</span>
        </div>
      </div>
    </footer>
  `;
}

function renderAppShell() {
  const appRoot = document.getElementById('app');
  if (!appRoot) return;

  appRoot.innerHTML = `
    ${renderNavbarMarkup()}
    ${renderMobileDrawerMarkup()}
    ${renderIOSModalMarkup()}
    ${renderSearchModalMarkup()}
    <div class="toast-container" id="toast-container"></div>
    <main class="main-content" id="app-container">
      ${renderHomePageMarkup()}
      ${renderExplorePageMarkup()}
      ${renderDetailPageMarkup()}
      ${renderReaderViewMarkup()}
      ${renderBookmarkPageMarkup()}
      ${renderOfflinePageMarkup()}
    </main>
    ${renderDownloadQueueMarkup()}
    ${renderSiteFooterMarkup()}
  `;
}

// Global window bindings for compatibility
window.switchView = switchView;
window.openMangaDetail = openMangaDetail;
window.openReader = openReader;
window.openExternalReader = openExternalReader;
window.openEnglishReader = openEnglishReader;
window.resumeReadingChapter = resumeReadingChapter;
window.toggleBookmark = toggleBookmark;
window.showToast = showToast;
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
window.openMobileDrawer = openMobileDrawer;
window.closeMobileDrawer = closeMobileDrawer;
window.switchCollectionTab = switchCollectionTab;
window.loadPopularManga = loadPopularManga;
window.loadExploreFeed = loadExploreFeed;
window.renderBookmarksList = renderBookmarksList;
window.renderHistoryList = renderHistoryList;
window.renderOfflineLibraryView = renderOfflineLibraryView;


function initApp() {
  try {
    renderAppShell();
    refreshBookmarkSet();
    initIcons();

    initNavbarEvents();
    initMobileDrawerEvents();
    initSearchModalEvents();
    initDownloadQueueEvents();

    initHomePage();
    initDetailPageEvents();
    initReaderControls();
    initBookmarkPageEvents();
    initOfflinePageEvents();

    initPWA();
  } catch (err) {
    console.error('[Yomikomi] App initialization error:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  // DOM is already parsed / interactive / complete
  initApp();
}
