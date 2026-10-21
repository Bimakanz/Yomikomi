/**
 * OfflinePage
 * Offline Library & Storage Manager
 * Displays offline manga downloaded to browser IndexedDB, storage gauges, clean read chapters, and offline reader launcher
 */

import { state, initIcons, showToast, getStoredList, STORAGE_KEY_HISTORY } from '../state.js';
import { openReader, openExternalReader, openEnglishReader } from '../components/Reader.js';

export function renderOfflinePageMarkup() {
  return `
    <section class="view-section hidden" id="view-offline">
      <div class="offline-container">
        <div class="section-header">
          <div class="section-title-wrap">
            <h2 class="section-title">Offline Library & Storage Manager</h2>
            <span class="section-badge" id="offline-count-badge">0 Komik Tersimpan</span>
          </div>
          <div class="offline-actions">
            <button class="btn-clean-read" id="btn-clean-read-chapters" type="button">
              <i data-lucide="sparkles"></i>
              <span>Hapus Chapter Sudah Dibaca</span>
            </button>
          </div>
        </div>

        <!-- Storage Usage Card -->
        <div class="storage-usage-card">
          <div class="storage-info-top">
            <div class="storage-label">
              <i data-lucide="database"></i>
              <span>Pemakaian Memori Browser (IndexedDB)</span>
            </div>
            <div class="storage-numbers" id="storage-usage-text">0 MB / 0 MB (0%)</div>
          </div>
          <div class="storage-progress-track">
            <div class="storage-progress-fill" id="storage-progress-fill" style="width: 0%;"></div>
          </div>
          <p style="font-size: 0.78rem; color: var(--text-subtle); margin-top: 0.6rem;">
            100% Client-Side via IndexedDB & Cache API. Seluruh file gambar tersimpan lokal di browser tanpa bandwidth server.
          </p>
        </div>

        <!-- Offline Manga Grid -->
        <div class="offline-manga-grid" id="offline-manga-grid">
          <!-- Rendered dynamically -->
        </div>
      </div>
    </section>
  `;
}

export async function renderOfflineLibraryView() {
  if (!window.OfflineManager) return;

  try {
    const stats = await OfflineManager.getStorageEstimate();
    const usageEl = document.getElementById('storage-usage-text');
    const fillEl = document.getElementById('storage-progress-fill');
    if (usageEl) usageEl.textContent = `${stats.usageMb} MB / ${stats.quotaMb} MB (${stats.percent}%)`;
    if (fillEl) fillEl.style.width = `${Math.min(stats.percent, 100)}%`;
  } catch (e) { }

  const grid = document.getElementById('offline-manga-grid');
  const countBadge = document.getElementById('offline-count-badge');
  if (!grid) return;

  const mangas = await OfflineManager.getAllOfflineManga();
  if (countBadge) countBadge.textContent = `${mangas.length} Komik Tersimpan`;

  if (mangas.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i data-lucide="cloud-off"></i>
        <h3>Belum Ada Komik Offline</h3>
        <p>Anda belum mengunduh chapter komik apapun. Buka detail manga dan klik "Download Semua" atau download per chapter untuk membaca tanpa internet.</p>
        <button class="btn-explore" id="btn-explore-offline-empty">Jelajahi Manga Sekarang</button>
      </div>
    `;
    document.getElementById('btn-explore-offline-empty')?.addEventListener('click', () => {
      if (typeof window.switchView === 'function') window.switchView('home');
    });
    initIcons();
    return;
  }

  grid.innerHTML = '';
  mangas.forEach(m => {
    let coverSrc = 'https://placehold.co/300x420/1e2025/ffffff?text=No+Cover';
    if (m.coverBlob && m.coverBlob instanceof Blob && m.coverBlob.size > 100) {
      coverSrc = URL.createObjectURL(m.coverBlob);
      state.activeObjectUrls.push(coverSrc);
    } else if (m.coverUrl) {
      coverSrc = m.coverUrl;
    }

    const sourceLabel = m.source === 'english' ? 'English Mirror' : (m.source === 'bacakomik' ? 'Bacakomik Mirror' : 'Server Utama');
    const isCorruptedOldBatch = m.totalSizeMb === '0.0' || (parseFloat(m.totalSizeMb) === 0);

    const card = document.createElement('div');
    card.className = 'offline-manga-card';
    card.innerHTML = `
      <img src="${coverSrc}" class="offline-card-thumb" alt="${m.title}" onerror="this.src='https://placehold.co/300x420/1e2025/ffffff?text=Cover';">
      <div class="offline-card-info">
        <div>
          <div class="offline-card-title" title="${m.title}">${m.title}</div>
          <div class="offline-card-meta">
            <span><i data-lucide="hard-drive" style="width:13px; height:13px; vertical-align:middle; margin-right:3px;"></i>${m.chaptersCount} Chapter Terunduh (${m.totalSizeMb} MB) ${isCorruptedOldBatch ? '<span style="color:#f87171; font-weight:600; margin-left:0.3rem;"><i data-lucide="alert-triangle" style="width:12px; height:12px; vertical-align:middle; margin-right:2px;"></i>Perlu Unduh Ulang</span>' : ''}</span>
            <span><i data-lucide="globe" style="width:13px; height:13px; vertical-align:middle; margin-right:3px;"></i>Sumber: ${sourceLabel}</span>
          </div>
        </div>
        <div class="offline-card-actions">
          <button class="btn-read-offline" data-manga-id="${m.id}" data-source="${m.source || 'mangadex'}">
            <i data-lucide="play"></i> Lanjut Baca
          </button>
          <button class="btn-delete-download" title="Hapus seluruh data offline manga ini" data-del-id="${m.id}">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;

    card.querySelector('.btn-read-offline')?.addEventListener('click', async () => {
      const chs = await OfflineManager.db.chapters.where('mangaId').equals(m.id).toArray();
      if (chs.length > 0) {
        const sortedChs = chs.sort((a, b) => parseFloat(a.chapterNumber || '0') - parseFloat(b.chapterNumber || '0'));
        const historyList = getStoredList(STORAGE_KEY_HISTORY);
        const lastRead = historyList.find(h => h.mangaId === m.id);

        let targetCh = null;
        if (lastRead) {
          targetCh = sortedChs.find(c => c.id === lastRead.chapterId);
          if (!targetCh && lastRead.chapterNum) {
            const cleanNum = lastRead.chapterNum.replace(/[^\d.]/g, '');
            if (cleanNum) {
              targetCh = sortedChs.find(c => String(c.chapterNumber) === cleanNum);
            }
          }
        }
        if (!targetCh) {
          targetCh = sortedChs[0];
        }

        const targetIndex = sortedChs.findIndex(c => c.id === targetCh.id);
        const resolvedIndex = targetIndex !== -1 ? targetIndex : 0;

        const validPages = await OfflineManager.getOfflinePages(targetCh.id);
        if (!validPages || validPages.length === 0) {
          showToast('Unduhan chapter ini dari sesi sebelum perbaikan. Membuka detail komik untuk mengunduh ulang...');
          if (typeof window.openMangaDetail === 'function') {
            window.openMangaDetail(m.id);
          }
          return;
        }

        state.currentManga = {
          id: m.id,
          title: m.title,
          coverUrl: m.coverUrl || '',
          coverBlob: m.coverBlob || null,
          attributes: {
            title: { en: m.title },
            description: { id: m.synopsis || '' },
            coverUrl: m.coverUrl || ''
          }
        };

        state.allMangaDexChapters = [];
        state.currentSource = m.source || 'mangadex';

        if (m.source === 'english') {
          state.isExternal = true;
          const allExternal = sortedChs.map(c => ({
            url: c.id,
            title: c.title,
            num: parseFloat(c.chapterNumber || '1')
          }));
          state.englishChapters = allExternal;
          openEnglishReader(targetCh.id, targetCh.title, allExternal, resolvedIndex);
        } else if (m.source === 'bacakomik') {
          state.isExternal = true;
          const allExternal = sortedChs.map(c => ({
            url: c.id,
            title: c.title,
            num: parseFloat(c.chapterNumber || '1')
          }));
          state.externalChapters = allExternal;
          openExternalReader(targetCh.id, targetCh.title, allExternal, resolvedIndex);
        } else {
          state.isExternal = false;
          state.currentChapters = sortedChs.map(c => ({
            id: c.id,
            mangaId: m.id,
            attributes: {
              chapter: c.chapterNumber,
              title: c.title
            }
          }));
          state.allMangaDexChapters = state.currentChapters;
          openReader(targetCh.id, resolvedIndex);
        }
      } else {
        if (typeof window.openMangaDetail === 'function') {
          window.openMangaDetail(m.id);
        }
      }
    });

    const delBtn = card.querySelector('.btn-delete-download');
    let confirmTimer = null;

    delBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (delBtn.classList.contains('confirming')) {
        clearTimeout(confirmTimer);
        delBtn.innerHTML = `<span style="font-size:0.75rem;">Menghapus...</span>`;
        delBtn.disabled = true;
        await OfflineManager.deleteManga(m.id);
        renderOfflineLibraryView();
      } else {
        delBtn.classList.add('confirming', 'btn-confirm-delete');
        delBtn.innerHTML = `<i data-lucide="trash-2"></i> Yakin Hapus?`;
        initIcons();

        confirmTimer = setTimeout(() => {
          delBtn.classList.remove('confirming', 'btn-confirm-delete');
          delBtn.innerHTML = `<i data-lucide="trash-2"></i>`;
          initIcons();
        }, 4000);
      }
    });

    grid.appendChild(card);
  });

  initIcons();
}
window.renderOfflineLibraryView = renderOfflineLibraryView;

export function initOfflinePageEvents() {
  document.getElementById('btn-clean-read-chapters')?.addEventListener('click', async () => {
    if (!window.OfflineManager) return;
    const history = getStoredList(STORAGE_KEY_HISTORY);
    const readChapterIds = history.map(h => h.chapterId).filter(Boolean);

    if (readChapterIds.length === 0) {
      showToast('Belum ada riwayat chapter yang selesai dibaca.');
      return;
    }

    if (confirm(`Bersihkan semua file offline untuk ${readChapterIds.length} chapter yang sudah pernah Anda baca?`)) {
      await OfflineManager.deleteReadChapters(readChapterIds);
      renderOfflineLibraryView();
      showToast('Chapter yang sudah dibaca berhasil dibersihkan dari penyimpanan.');
    }
  });
}
