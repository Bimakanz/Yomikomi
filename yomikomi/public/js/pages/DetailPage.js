/**
 * DetailPage
 * Manga Detail view: backdrop, poster, synopsis, tags, bookmarking, and multi-source chapter list
 */

import {
  state,
  initIcons,
  showToast,
  getMangaTitle,
  getCoverUrl,
  CoverCache,
  getStoredList,
  STORAGE_KEY_HISTORY
} from '../state.js';
import { isBookmarked, toggleBookmark } from '../services/storage.js';
import {
  initSourceTabs,
  initLanguagePills,
  initOfflineDownloadControls,
  loadChaptersFeed,
  updateSortButtonLabel
} from '../components/ChapterList.js';
import { openReader } from '../components/Reader.js';

export function renderDetailPageMarkup() {
  return `
    <section class="view-section hidden" id="view-detail">
      <div class="detail-backdrop" id="detail-backdrop"></div>
      <div class="detail-container">
        <button class="btn-back" id="btn-back-home">
          <i data-lucide="arrow-left"></i>
          <span>Kembali ke Katalog</span>
        </button>

        <div class="detail-hero" id="detail-hero-content">
          <!-- Populated by JS -->
        </div>

        <!-- Chapters Section -->
        <div class="chapters-wrapper">
          <div class="chapters-header">
            <div class="chapters-title-wrap">
              <h3 class="chapters-title">Daftar Chapter</h3>
              <span class="chapters-count-badge" id="chapters-total-badge">0 Chapter</span>
            </div>

            <!-- Multi-Source Switcher (MangaDex, Indo Mirror, English Mirror) -->
            <div class="source-tabs" id="source-tabs">
              <button class="source-tab active" id="source-tab-mangadex" data-source="mangadex">
                <i data-lucide="shield-check"></i>
                <span>Server Utama</span>
              </button>
              <button class="source-tab" id="source-tab-bacakomik" data-source="bacakomik">
                <i data-lucide="globe"></i>
                <span>🇮🇩 Indo Mirror</span>
              </button>
              <button class="source-tab" id="source-tab-english" data-source="english">
                <i data-lucide="book-open"></i>
                <span>🇬🇧 English Mirror</span>
              </button>
            </div>

            <div class="chapters-filter-controls" id="mangadex-filters">
              <div class="lang-pills-wrap" id="mangadex-lang-pills">
                <button class="lang-pill active" data-lang="all" type="button" title="Tampilkan seluruh chapter ID & EN">
                  <span>Semua</span>
                  <span class="pill-count" id="count-lang-all">0</span>
                </button>
                <button class="lang-pill" data-lang="id" type="button" title="Hanya Bahasa Indonesia">
                  <span>🇮🇩 ID</span>
                  <span class="pill-count" id="count-lang-id">0</span>
                </button>
                <button class="lang-pill" data-lang="en" type="button" title="Hanya English">
                  <span>🇬🇧 EN</span>
                  <span class="pill-count" id="count-lang-en">0</span>
                </button>
              </div>

              <!-- Sort Order Toggle -->
              <button class="btn-sort" id="chapter-sort-btn" data-order="asc" title="Ubah urutan chapter">
                <i data-lucide="arrow-down-up"></i>
                <span id="chapter-sort-label">Chapter 1 → Akhir</span>
              </button>
            </div>
          </div>

          <!-- Offline Download Bar -->
          <div class="chapters-download-bar" id="chapters-download-bar">
            <button class="btn-download-all" id="btn-download-all" type="button">
              <i data-lucide="download"></i>
              <span>Download Semua</span>
            </button>
            <div class="download-dropdown-wrap">
              <button class="btn-download-options" id="btn-download-options" type="button">
                <span>Opsi Cepat</span>
                <i data-lucide="chevron-down"></i>
              </button>
              <div class="download-dropdown-menu hidden" id="download-dropdown-menu">
                <button class="dropdown-item" id="opt-download-next-5" type="button">
                  <i data-lucide="layers"></i>
                  <span>5 Chapter Berikutnya</span>
                </button>
                <button class="dropdown-item" id="opt-download-unread-10" type="button">
                  <i data-lucide="book-open-check"></i>
                  <span>10 Chapter Belum Dibaca</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Chapters List Container -->
          <div class="chapters-list" id="chapters-list">
            <!-- Chapter cards populated by JS -->
          </div>
        </div>
      </div>
    </section>
  `;
}

export function getAuthorName(manga) {
  const authorRel = manga.relationships?.find(r => r.type === 'author');
  return authorRel?.attributes?.name || 'Scanlation Community';
}

export function renderMangaDetailHero(manga) {
  const title = getMangaTitle(manga.attributes);
  const coverUrl = getCoverUrl(manga);
  const author = getAuthorName(manga);
  const status = manga.attributes.status ? manga.attributes.status.toUpperCase() : 'UNKNOWN';
  const year = manga.attributes.year || 'N/A';
  const desc = manga.attributes.description?.en || manga.attributes.description?.id || 'Tidak ada deskripsi tersedia.';
  const tags = manga.attributes.tags?.map(t => t.attributes.name.en) || [];

  const backdrop = document.getElementById('detail-backdrop');
  if (backdrop) backdrop.style.backgroundImage = `url('${coverUrl}')`;

  const hero = document.getElementById('detail-hero-content');
  if (!hero) return;

  const isBooked = isBookmarked(manga.id);

  hero.innerHTML = `
    <div class="detail-poster-col">
      <img src="${coverUrl}" class="detail-poster" alt="${title}">
    </div>
    <div class="detail-info-col">
      <h1 class="detail-title">${title}</h1>
      <div class="detail-meta-row">
        <div class="detail-meta-item">Penulis: <strong>${author}</strong></div>
        <div class="detail-meta-item">Status: <strong class="text-accent">${status}</strong></div>
        <div class="detail-meta-item">Tahun: <strong>${year}</strong></div>
      </div>
      <div class="detail-tags">
        ${tags.map(t => `<span class="detail-tag">${t}</span>`).join('')}
      </div>
      <div class="detail-synopsis">
        <p>${desc}</p>
      </div>
      <div class="detail-actions">
        <button class="btn-primary" id="btn-read-first-chapter">
          <i data-lucide="play"></i>
          <span>${(() => {
            const hList = getStoredList(STORAGE_KEY_HISTORY);
            const last = hList.find(item => item.mangaId === manga.id);
            return last ? `Lanjut Baca (${last.chapterNum})` : 'Mulai Baca (Chapter 1)';
          })()}</span>
        </button>
        <button class="btn-secondary ${isBooked ? 'bookmarked active' : ''}" id="btn-bookmark-manga">
          <i data-lucide="${isBooked ? 'bookmark-check' : 'bookmark'}"></i>
          <span>${isBooked ? 'Tersimpan di Bookmark' : '+ Bookmark'}</span>
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-bookmark-manga')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const nowBookmarked = toggleBookmark(manga);
    if (nowBookmarked) {
      btn.classList.add('bookmarked', 'active');
      btn.innerHTML = `<i data-lucide="bookmark-check"></i><span>Tersimpan di Bookmark</span>`;
      showToast(`"${title}" berhasil ditambahkan ke Bookmark!`);
    } else {
      btn.classList.remove('bookmarked', 'active');
      btn.innerHTML = `<i data-lucide="bookmark"></i><span>+ Bookmark</span>`;
      showToast(`"${title}" dihapus dari Bookmark.`);
    }
    initIcons();
  });

  document.getElementById('btn-read-first-chapter')?.addEventListener('click', () => {
    const hList = getStoredList(STORAGE_KEY_HISTORY);
    const last = hList.find(item => item.mangaId === manga.id);
    if (last && last.chapterId && window.resumeReadingChapter) {
      window.resumeReadingChapter(manga.id, last.chapterId, last.chapterNum);
      return;
    }
    if (state.currentChapters.length > 0) {
      openReader(state.currentChapters[0].id, 0);
    } else {
      showToast('Tidak ada chapter yang tersedia untuk dibaca.');
    }
  });

  initIcons();
}

export async function openMangaDetail(mangaId) {
  if (typeof window.switchView === 'function') {
    window.switchView('detail');
  }

  const heroContent = document.getElementById('detail-hero-content');
  const chaptersList = document.getElementById('chapters-list');

  const existing = state.mangaList?.find(m => m.id === mangaId);
  if (existing) {
    state.currentManga = existing;
    renderMangaDetailHero(existing);
  } else if (heroContent) {
    heroContent.innerHTML = `<div class="spinner" style="margin: 3rem auto;"></div>`;
  }

  if (chaptersList) {
    chaptersList.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
  }

  try {
    const res = await fetch(`/api/manga/${mangaId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.currentManga = data.data;

    CoverCache.set(data.data.id, getMangaTitle(data.data.attributes), getCoverUrl(data.data));

    renderMangaDetailHero(state.currentManga);
    loadChaptersFeed(mangaId);
  } catch (error) {
    console.error('Failed to load manga detail:', error);
    if (typeof OfflineManager !== 'undefined' && OfflineManager.db?.manga) {
      try {
        const offM = await OfflineManager.db.manga.get(mangaId);
        if (offM) {
          state.currentManga = {
            id: offM.id,
            title: offM.title,
            coverUrl: offM.coverUrl,
            coverBlob: offM.coverBlob,
            attributes: {
              title: { en: offM.title },
              description: { id: offM.synopsis || '' }
            }
          };
          renderMangaDetailHero(state.currentManga);
          return;
        }
      } catch (e) { }
    }
    showToast('Gagal memuat detail manga');
  }
}

export function initDetailPageEvents() {
  document.getElementById('btn-back-home')?.addEventListener('click', () => {
    if (typeof window.switchView === 'function') {
      window.switchView(state.previousView || 'home');
    }
  });

  // Chapter sorting button toggle
  const sortBtn = document.getElementById('chapter-sort-btn');
  sortBtn?.addEventListener('click', () => {
    const currentOrder = sortBtn.dataset.order || 'asc';
    const nextOrder = currentOrder === 'asc' ? 'desc' : 'asc';
    sortBtn.dataset.order = nextOrder;

    if (state.currentSource === 'mangadex') {
      state.currentSort = nextOrder;
      updateSortButtonLabel(nextOrder);
      if (state.currentManga) loadChaptersFeed(state.currentManga.id);
    } else if (state.currentSource === 'bacakomik') {
      state.mirrorOrder = nextOrder;
      updateSortButtonLabel(nextOrder);
      if (state.rawMirrorChapters && state.activeMirrorComic) {
        import('../components/ChapterList.js').then(mod => {
          mod.renderBacakomikChaptersList(state.rawMirrorChapters, state.activeMirrorComic, state.matchedMirrorComics);
        });
      }
    } else if (state.currentSource === 'english') {
      state.englishOrder = nextOrder;
      updateSortButtonLabel(nextOrder);
      if (state.rawEnglishChapters && state.activeEnglishComic) {
        import('../components/ChapterList.js').then(mod => {
          mod.renderEnglishChaptersList(state.rawEnglishChapters, state.activeEnglishComic, state.matchedEnglishComics);
        });
      }
    }
  });

  initSourceTabs();
  initLanguagePills();
  initOfflineDownloadControls();
}
