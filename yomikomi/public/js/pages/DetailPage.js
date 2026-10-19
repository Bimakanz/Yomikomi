/**
 * DetailPage
 * Manga Detail view: backdrop, poster, synopsis, tags, bookmarking,
 * clean Unified Language Tabs (🇮🇩 Indonesia & 🇬🇧 English), and Smart Chapter Merger
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
  initLanguageFilterTabs,
  initOfflineDownloadControls,
  loadUnifiedChapters,
  toggleChapterSort,
  openUnifiedChapter
} from '../components/ChapterList.js';
import { fetchKomikuManga } from '../services/api.js';
import { prefetchChapter } from '../components/Reader.js';
import { getMangaDetailCached, setMangaDetailCached } from '../services/mangaCache.js';

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
              <span class="chapters-count-badge" id="chapters-total-badge">Memuat chapter...</span>
            </div>

            <!-- Clean Unified Language Filter Tabs & Sort Toggle -->
            <div class="chapters-header-controls">
              <div class="lang-filter-tabs" id="chapter-lang-tabs">
                <button class="lang-filter-tab active" data-lang="id" id="tab-lang-id" type="button" title="Chapter Bahasa Indonesia (Gabungan MangaDex & Komiku)">
                  <span class="lang-tab-label">🇮🇩 Indonesia</span>
                  <span class="lang-count-badge" id="lang-count-id">0</span>
                </button>
                <button class="lang-filter-tab" data-lang="en" id="tab-lang-en" type="button" title="Chapter English (MangaDex & Mirror)">
                  <span class="lang-tab-label">🇬🇧 English</span>
                  <span class="lang-count-badge" id="lang-count-en">0</span>
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
  const desc = manga.attributes.description?.id || manga.attributes.description?.en || 'Tidak ada deskripsi tersedia.';
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

  const readBtn = document.getElementById('btn-read-first-chapter');
  const triggerPrefetchHeroChapter = () => {
    const hList = getStoredList(STORAGE_KEY_HISTORY);
    const last = hList.find(item => item.mangaId === manga.id);
    if (last && last.chapterId) {
      prefetchChapter({ id: last.chapterId, source: 'mangadex', number: last.chapterNum });
      return;
    }
    const currentList = state.unifiedChapters?.[state.activeDetailLang] || state.currentChapters || [];
    if (currentList.length > 0) {
      prefetchChapter(currentList[0]);
    }
  };

  readBtn?.addEventListener('mouseenter', triggerPrefetchHeroChapter, { passive: true });
  readBtn?.addEventListener('touchstart', triggerPrefetchHeroChapter, { passive: true });

  readBtn?.addEventListener('click', () => {
    const hList = getStoredList(STORAGE_KEY_HISTORY);
    const last = hList.find(item => item.mangaId === manga.id);
    if (last && last.chapterId && window.resumeReadingChapter) {
      window.resumeReadingChapter(manga.id, last.chapterId, last.chapterNum, last);
      return;
    }

    const currentList = state.unifiedChapters?.[state.activeDetailLang] || state.currentChapters || [];
    if (currentList.length > 0) {
      const firstCh = currentList[0];
      openUnifiedChapter(firstCh, 0);
    } else {
      showToast('Tidak ada chapter yang tersedia untuk dibaca.');
    }
  });

  initIcons();
}

export async function openMangaDetail(mangaId, maybeMangaData = null) {
  if (typeof window.switchView === 'function') {
    window.switchView('detail');
  }

  // 15-Minute SWR Cache Check: Zero-wait instant render from memory
  const cachedManga = getMangaDetailCached(mangaId);
  if (cachedManga) {
    state.currentManga = cachedManga;
    renderMangaDetailHero(cachedManga);
    loadUnifiedChapters(mangaId, cachedManga, cachedManga.chapters || null);
    return;
  }

  const heroContent = document.getElementById('detail-hero-content');
  const chaptersList = document.getElementById('chapters-list');

  const isKomiku = (typeof mangaId === 'string' && mangaId.startsWith('komiku-')) || maybeMangaData?.source === 'komiku';

  if (isKomiku) {
    const slug = (maybeMangaData?.slug || mangaId).replace(/^komiku-/, '');
    state.currentSource = 'komiku';

    // Optimistic render if partial data already available
    if (maybeMangaData) {
      state.currentManga = {
        id: `komiku-${slug}`,
        slug,
        source: 'komiku',
        title: maybeMangaData.title,
        coverUrl: maybeMangaData.coverUrl,
        attributes: {
          title: { en: maybeMangaData.title, id: maybeMangaData.title },
          description: { id: maybeMangaData.synopsis || 'Memuat sinopsis komik...', en: maybeMangaData.synopsis || '' },
          status: maybeMangaData.status || 'ONGOING',
          tags: (maybeMangaData.genres || []).map(g => ({ attributes: { name: { en: g } } }))
        }
      };
      renderMangaDetailHero(state.currentManga);
    } else if (heroContent) {
      heroContent.innerHTML = `<div class="spinner" style="margin: 3rem auto;"></div>`;
    }

    if (chaptersList) {
      chaptersList.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
    }

    // Trigger Smart Chapter Merger immediately
    loadUnifiedChapters(mangaId, state.currentManga);

    try {
      const kData = await fetchKomikuManga(slug);
      if (kData) {
        state.currentManga = {
          id: `komiku-${slug}`,
          slug,
          source: 'komiku',
          title: kData.title,
          coverUrl: kData.coverUrl,
          attributes: {
            title: { en: kData.title, id: kData.title },
            description: { id: kData.synopsis, en: kData.synopsis },
            status: kData.status,
            tags: (kData.genres || []).map(g => ({ attributes: { name: { en: g } } }))
          }
        };
        CoverCache.set(`komiku-${slug}`, kData.title, kData.coverUrl);
        setMangaDetailCached(mangaId, state.currentManga);
        renderMangaDetailHero(state.currentManga);
        // Refresh with detailed Komiku chapters
        loadUnifiedChapters(mangaId, state.currentManga, kData.chapters);
        return;
      }
    } catch (kErr) {
      console.error('Failed to load Komiku details:', kErr);
      showToast('Gagal memuat detail komik dari server Komiku');
      return;
    }
  }

  // MangaDex or standard manga
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

  // Parallel fetch: immediately trigger smart chapter merger simultaneously with manga detail
  loadUnifiedChapters(mangaId, state.currentManga);

  try {
    const res = await fetch(`/api/manga/${mangaId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.currentManga = data.data;

    CoverCache.set(data.data.id, getMangaTitle(data.data.attributes), getCoverUrl(data.data));
    setMangaDetailCached(mangaId, state.currentManga);
    renderMangaDetailHero(state.currentManga);
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
window.openMangaDetail = openMangaDetail;

export function initDetailPageEvents() {
  document.getElementById('btn-back-home')?.addEventListener('click', () => {
    if (typeof window.switchView === 'function') {
      window.switchView(state.previousView || 'home');
    }
  });

  // Chapter sorting button toggle
  const sortBtn = document.getElementById('chapter-sort-btn');
  sortBtn?.addEventListener('click', () => {
    toggleChapterSort();
  });

  initLanguageFilterTabs();
  initOfflineDownloadControls();
}
