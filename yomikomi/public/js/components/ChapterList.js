/**
 * ChapterList Component
 * Multi-source chapter feed (MangaDex, Indo Mirror, English Mirror)
 * Chapter sorting, language filter pills, and single/batch offline download
 */

import { state, initIcons, showToast, getMangaTitle, getCoverUrl, normalizeTitle, getStoredList, STORAGE_KEY_HISTORY } from '../state.js';
import { openReader, openExternalReader, openEnglishReader } from './Reader.js';

export function updateSortButtonLabel(order) {
  const btn = document.getElementById('chapter-sort-btn');
  const label = document.getElementById('chapter-sort-label');
  if (btn) btn.dataset.order = order;
  if (label) label.textContent = order === 'asc' ? 'Chapter 1 → Akhir' : 'Terbaru → Awal';
}

export function initSourceTabs() {
  const tabMd = document.getElementById('source-tab-mangadex');
  const tabBk = document.getElementById('source-tab-bacakomik');
  const tabEn = document.getElementById('source-tab-english');
  const langPills = document.getElementById('mangadex-lang-pills');

  tabMd?.addEventListener('click', () => {
    tabMd.classList.add('active');
    tabBk?.classList.remove('active');
    tabEn?.classList.remove('active');
    if (langPills) langPills.style.display = 'flex';
    updateSortButtonLabel(state.currentSort || 'asc');
    state.currentSource = 'mangadex';
    if (state.currentManga) loadChaptersFeed(state.currentManga.id);
  });

  tabBk?.addEventListener('click', () => {
    tabBk.classList.add('active');
    tabMd?.classList.remove('active');
    tabEn?.classList.remove('active');
    if (langPills) langPills.style.display = 'none';
    updateSortButtonLabel(state.mirrorOrder || 'asc');
    state.currentSource = 'bacakomik';
    if (state.currentManga) loadBacakomikChaptersFeed();
  });

  tabEn?.addEventListener('click', () => {
    tabEn.classList.add('active');
    tabMd?.classList.remove('active');
    tabBk?.classList.remove('active');
    if (langPills) langPills.style.display = 'none';
    updateSortButtonLabel(state.englishOrder || 'asc');
    state.currentSource = 'english';
    if (state.currentManga) loadEnglishChaptersFeed();
  });
}

export function initLanguagePills() {
  const pills = document.querySelectorAll('#mangadex-lang-pills .lang-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.currentLang = pill.dataset.lang || 'all';
      filterAndRenderMangaDexChapters();
    });
  });
}

export function filterAndRenderMangaDexChapters() {
  const lang = state.currentLang;
  let filtered = state.allMangaDexChapters || [];
  if (lang === 'id') {
    filtered = state.allMangaDexChapters.filter(c => c.attributes?.translatedLanguage === 'id');
  } else if (lang === 'en') {
    filtered = state.allMangaDexChapters.filter(c => c.attributes?.translatedLanguage === 'en');
  }
  state.currentChapters = filtered;
  renderChaptersList(filtered);
}

export async function loadChaptersFeed(mangaId) {
  document.getElementById('source-tab-mangadex')?.classList.add('active');
  document.getElementById('source-tab-bacakomik')?.classList.remove('active');
  document.getElementById('source-tab-english')?.classList.remove('active');
  const langPills = document.getElementById('mangadex-lang-pills');
  if (langPills) langPills.style.display = 'flex';
  updateSortButtonLabel(state.currentSort || 'asc');
  state.currentSource = 'mangadex';

  const sortBtn = document.getElementById('chapter-sort-btn');
  const sort = sortBtn?.dataset.order || 'asc';

  const chaptersContainer = document.getElementById('chapters-list');
  if (chaptersContainer) {
    chaptersContainer.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
  }

  try {
    const res = await fetch(`/api/manga/${mangaId}/chapters?lang=all&order=${sort}&limit=500`);
    const data = await res.json();
    state.allMangaDexChapters = data.data || [];

    const totalAll = state.allMangaDexChapters.length;
    const totalId = state.allMangaDexChapters.filter(c => c.attributes?.translatedLanguage === 'id').length;
    const totalEn = state.allMangaDexChapters.filter(c => c.attributes?.translatedLanguage === 'en').length;

    const countAllEl = document.getElementById('count-lang-all');
    const countIdEl = document.getElementById('count-lang-id');
    const countEnEl = document.getElementById('count-lang-en');
    if (countAllEl) countAllEl.textContent = totalAll;
    if (countIdEl) countIdEl.textContent = totalId;
    if (countEnEl) countEnEl.textContent = totalEn;

    filterAndRenderMangaDexChapters();
  } catch (error) {
    console.error('Failed to load chapters:', error);
    if (chaptersContainer) {
      chaptersContainer.innerHTML = `<p class="empty-state">Gagal memuat daftar chapter dari server.</p>`;
    }
  }
}

export function calculateTitleSimilarity(titleA, titleB) {
  const normA = normalizeTitle(titleA);
  const normB = normalizeTitle(titleB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const compactA = normA.replace(/\s+/g, '');
  const compactB = normB.replace(/\s+/g, '');
  if (compactA === compactB) return 1.0;

  if (compactA.includes(compactB) || compactB.includes(compactA)) {
    const minLen = Math.min(compactA.length, compactB.length);
    const maxLen = Math.max(compactA.length, compactB.length);
    if (minLen >= 4 && (minLen / maxLen) >= 0.5) {
      return 0.85;
    }
  }

  const wordsA = new Set(normA.split(' ').filter(w => w.length > 1));
  const wordsB = new Set(normB.split(' ').filter(w => w.length > 1));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = intersection / union;
  const overlapA = intersection / wordsA.size;
  const overlapB = intersection / wordsB.size;

  return Math.max(jaccard, Math.min(overlapA, overlapB));
}

export function filterAndSortMatchingComics(targetTitles, candidateComics) {
  if (!candidateComics || !Array.isArray(candidateComics) || candidateComics.length === 0) return [];

  const scored = [];
  for (const comic of candidateComics) {
    let maxScore = 0;
    for (const target of targetTitles) {
      const score = calculateTitleSimilarity(target, comic.title);
      if (score > maxScore) maxScore = score;
    }
    if (maxScore >= 0.55) {
      scored.push({ comic, score: maxScore });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.comic);
}

export async function loadBacakomikChaptersFeed() {
  const chaptersContainer = document.getElementById('chapters-list');
  if (chaptersContainer) {
    chaptersContainer.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
  }
  const badge = document.getElementById('chapters-total-badge');
  if (badge) badge.textContent = 'Mencari Indo mirror...';

  const attrs = state.currentManga?.attributes;
  const primaryTitle = getMangaTitle(attrs);

  const candidates = [primaryTitle];
  if (attrs?.altTitles && Array.isArray(attrs.altTitles)) {
    attrs.altTitles.forEach(at => {
      Object.values(at).forEach(val => {
        if (val && typeof val === 'string' && !candidates.includes(val)) {
          candidates.push(val);
        }
      });
    });
  }

  const variants = [];
  candidates.forEach(c => {
    const s1 = c.replace(/[-_:]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!candidates.includes(s1)) variants.push(s1);
    const s2 = c.replace(/[-_:]/g, '').replace(/\s+/g, ' ').trim();
    if (!candidates.includes(s2)) variants.push(s2);
  });
  const allQueries = [...candidates, ...variants];

  let matchedComics = [];

  for (const q of allQueries) {
    try {
      const res = await fetch(`/api/external/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.data && data.data.length > 0) {
        const matches = filterAndSortMatchingComics(candidates, data.data);
        if (matches.length > 0) {
          matchedComics = matches;
          break;
        }
      }
    } catch (e) { }
  }

  if (matchedComics.length === 0) {
    if (chaptersContainer) {
      chaptersContainer.innerHTML = `
        <div class="empty-state">
          <i data-lucide="book-x"></i>
          <h4>Komik Ini Tidak Tersedia di Indo Mirror</h4>
          <p>Komik "<strong>${primaryTitle}</strong>" belum ditemukan di server Indo Mirror. Silakan gunakan Server Utama.</p>
        </div>
      `;
    }
    if (badge) badge.textContent = '0 Chapter (Indo Mirror)';
    initIcons();
    return;
  }

  const comic = matchedComics[0];
  state.activeMirrorComic = comic;
  state.matchedMirrorComics = matchedComics;

  try {
    const chRes = await fetch(`/api/external/chapters?url=${encodeURIComponent(comic.url)}`);
    const chData = await chRes.json();
    const chapters = chData.chapters || [];
    state.rawMirrorChapters = chapters;
    if (badge) badge.textContent = `${chapters.length} Chapter (Indo Mirror)`;

    renderBacakomikChaptersList(chapters, comic, matchedComics);
  } catch (err) {
    console.error('Failed to load bacakomik chapters:', err);
    if (chaptersContainer) {
      chaptersContainer.innerHTML = `<p class="empty-state">Gagal memuat chapter dari mirror Indo.</p>`;
    }
    if (badge) badge.textContent = 'Error';
    initIcons();
  }
}

export async function renderBacakomikChaptersList(chapters, activeComic, allMatchedComics = []) {
  const container = document.getElementById('chapters-list');
  const badge = document.getElementById('chapters-total-badge');
  if (badge && chapters) {
    badge.textContent = `${chapters.length} Chapter (Indo Mirror)`;
  }

  if (!container) return;

  if (chapters.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="folder-x"></i>
        <h4>Tidak Ada Chapter Tersedia di Indo Mirror</h4>
        <p>Belum ada rilis chapter untuk komik ini di mirror.</p>
      </div>
    `;
    initIcons();
    return;
  }

  const parsed = chapters.map((c, i) => {
    const numMatch = c.title.match(/chapter\s*([\d.]+)/i) || c.url.match(/chapter-([\d.]+)/i);
    const num = numMatch ? parseFloat(numMatch[1]) : (chapters.length - i);
    return { ...c, num };
  });

  parsed.sort((a, b) => {
    return state.mirrorOrder === 'asc' ? a.num - b.num : b.num - a.num;
  });

  state.externalChapters = parsed;

  const mangaId = state.currentManga?.id || activeComic.url;
  const downloadedSet = window.OfflineManager
    ? await OfflineManager.getDownloadedChapterIds(mangaId)
    : new Set();

  let html = '';

  if (allMatchedComics.length > 1) {
    html += `
      <div class="mirror-matches-row">
        <span class="quick-tag-label">Pilih Judul Cocok:</span>
        ${allMatchedComics.map((c) => {
      const t = c.title.replace(/\s+/g, ' ').replace(/^Warna\s*/, '').trim();
      const isAct = c.url === activeComic.url;
      return `<button class="quick-tag-chip ${isAct ? 'active' : ''}" data-url="${c.url}">${t}</button>`;
    }).join('')}
      </div>
    `;
  }

  html += `<div class="mirror-chapters-grid">`;
  parsed.forEach((ch, idx) => {
    const cleanChTitle = ch.title.replace(/\s+/g, ' ').trim();
    const isDownloaded = downloadedSet.has(ch.url);
    html += `
      <div class="chapter-item" data-ch-idx="${idx}">
        <div class="chapter-item-left">
          <span class="chapter-number-pill">${cleanChTitle}</span>
          <span class="chapter-group-badge" style="color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">🇮🇩 Indo Mirror</span>
        </div>
        <div class="chapter-item-right">
          ${isDownloaded ? `
            <span class="badge-downloaded-success" title="Chapter tersimpan di penyimpanan offline browser">
              <i data-lucide="check-circle-2"></i> Tersimpan
            </span>
            <button class="btn-delete-download" title="Hapus dari penyimpanan offline" data-ch-url="${ch.url}">
              <i data-lucide="trash-2"></i>
            </button>
          ` : `
            <button class="btn-ch-download" title="Download Chapter ini ke memori offline" data-ch-idx="${idx}">
              <i data-lucide="download"></i>
            </button>
          `}
          <span>Baca Chapter</span>
          <i data-lucide="chevron-right"></i>
        </div>
      </div>
    `;
  });
  html += `</div>`;

  container.innerHTML = html;

  container.querySelectorAll('.mirror-matches-row .quick-tag-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const u = chip.dataset.url;
      container.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
      try {
        const res = await fetch(`/api/external/chapters?url=${encodeURIComponent(u)}`);
        const data = await res.json();
        const chs = data.chapters || [];
        const matchC = allMatchedComics.find(x => x.url === u) || { url: u, title: chip.textContent };
        state.activeMirrorComic = matchC;
        state.rawMirrorChapters = chs;
        renderBacakomikChaptersList(chs, matchC, allMatchedComics);
      } catch (e) {
        showToast('Gagal memuat chapter untuk judul ini');
      }
    });
  });

  container.querySelectorAll('.mirror-chapters-grid .chapter-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-ch-download') || e.target.closest('.btn-delete-download')) return;
      const idx = parseInt(item.dataset.chIdx);
      const ch = parsed[idx];
      openExternalReader(ch.url, ch.title.replace(/\s+/g, ' ').trim(), parsed, idx);
    });

    item.querySelector('.btn-ch-download')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(item.dataset.chIdx);
      const ch = parsed[idx];
      if (!window.OfflineManager) return;

      const mangaObj = {
        id: mangaId,
        title: state.currentManga ? getMangaTitle(state.currentManga.attributes) : activeComic.title,
        coverUrl: state.currentManga ? getCoverUrl(state.currentManga) : (activeComic.thumb || ''),
        synopsis: state.currentManga?.attributes?.description?.id || state.currentManga?.attributes?.description?.en || ''
      };

      OfflineManager.enqueueChapter(
        mangaObj,
        {
          id: ch.url,
          url: ch.url,
          number: ch.num,
          title: ch.title.replace(/\s+/g, ' ').trim()
        },
        'bacakomik'
      );
    });

    item.querySelector('.btn-delete-download')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const chUrl = e.currentTarget.dataset.chUrl;
      if (!window.OfflineManager || !chUrl) return;
      await OfflineManager.deleteChapter(chUrl);
      renderBacakomikChaptersList(chapters, activeComic, allMatchedComics);
    });
  });

  initIcons();
}

export async function loadEnglishChaptersFeed() {
  const chaptersContainer = document.getElementById('chapters-list');
  if (chaptersContainer) {
    chaptersContainer.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
  }
  const badge = document.getElementById('chapters-total-badge');
  if (badge) badge.textContent = 'Mencari mirror EN...';

  const attrs = state.currentManga?.attributes;
  const primaryTitle = getMangaTitle(attrs);

  const candidates = [primaryTitle];
  if (attrs?.altTitles && Array.isArray(attrs.altTitles)) {
    attrs.altTitles.forEach(at => {
      Object.values(at).forEach(val => {
        if (val && typeof val === 'string' && !candidates.includes(val)) {
          candidates.push(val);
        }
      });
    });
  }

  const variants = [];
  candidates.forEach(c => {
    const s1 = c.replace(/[-_:]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!candidates.includes(s1)) variants.push(s1);
    const s2 = c.replace(/[-_:]/g, '').replace(/\s+/g, ' ').trim();
    if (!candidates.includes(s2)) variants.push(s2);
  });
  const allQueries = [...candidates, ...variants];

  let matchedComics = [];

  for (const q of allQueries) {
    try {
      const res = await fetch(`/api/external/en/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.data && data.data.length > 0) {
        const matches = filterAndSortMatchingComics(candidates, data.data);
        if (matches.length > 0) {
          matchedComics = matches;
          break;
        }
      }
    } catch (e) { }
  }

  if (matchedComics.length === 0) {
    if (chaptersContainer) {
      chaptersContainer.innerHTML = `
        <div class="empty-state">
          <i data-lucide="book-x"></i>
          <h4>Komik Ini Tidak Tersedia di English Mirror</h4>
          <p>Komik "<strong>${primaryTitle}</strong>" belum ditemukan di server English Mirror. Silakan gunakan Server Utama.</p>
        </div>
      `;
    }
    if (badge) badge.textContent = '0 Chapter (EN Mirror)';
    initIcons();
    return;
  }

  const comic = matchedComics[0];
  state.activeEnglishComic = comic;
  state.matchedEnglishComics = matchedComics;

  try {
    const chRes = await fetch(`/api/external/en/chapters?url=${encodeURIComponent(comic.url)}`);
    const chData = await chRes.json();
    const chapters = chData.chapters || [];
    state.rawEnglishChapters = chapters;
    if (badge) badge.textContent = `${chapters.length} Chapter (EN Mirror)`;

    renderEnglishChaptersList(chapters, comic, matchedComics);
  } catch (err) {
    console.error('Failed to load English mirror chapters:', err);
    if (chaptersContainer) {
      chaptersContainer.innerHTML = `<p class="empty-state">Gagal memuat chapter dari English mirror.</p>`;
    }
    if (badge) badge.textContent = 'Error';
    initIcons();
  }
}

export async function renderEnglishChaptersList(chapters, activeComic, allMatchedComics = []) {
  const container = document.getElementById('chapters-list');
  const badge = document.getElementById('chapters-total-badge');
  if (badge && chapters) {
    badge.textContent = `${chapters.length} Chapter (EN Mirror)`;
  }

  if (!container) return;

  if (chapters.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="folder-x"></i>
        <h4>Tidak Ada Chapter Tersedia di English Mirror</h4>
        <p>Belum ada rilis chapter untuk komik ini di mirror.</p>
      </div>
    `;
    initIcons();
    return;
  }

  const parsed = chapters.map((c, i) => {
    const numMatch = c.title.match(/chapter\s*([\d.]+)/i) || c.url.match(/chapter-([\d.]+)/i);
    const num = numMatch ? parseFloat(numMatch[1]) : (chapters.length - i);
    return { ...c, num };
  });

  parsed.sort((a, b) => {
    return state.englishOrder === 'asc' ? a.num - b.num : b.num - a.num;
  });

  state.englishChapters = parsed;

  const mangaId = state.currentManga?.id || activeComic.url;
  const downloadedSet = window.OfflineManager
    ? await OfflineManager.getDownloadedChapterIds(mangaId)
    : new Set();

  let html = '';

  if (allMatchedComics.length > 1) {
    html += `
      <div class="mirror-matches-row">
        <span class="quick-tag-label">Pilih Judul Cocok:</span>
        ${allMatchedComics.map(c => {
      const t = c.title.replace(/\s+/g, ' ').trim();
      const isAct = c.url === activeComic.url;
      return `<button class="quick-tag-chip ${isAct ? 'active' : ''}" data-url="${c.url}">${t}</button>`;
    }).join('')}
      </div>
    `;
  }

  html += `<div class="mirror-chapters-grid">`;
  parsed.forEach((ch, idx) => {
    const cleanChTitle = ch.title.replace(/\s+/g, ' ').trim();
    const isDownloaded = downloadedSet.has(ch.url);
    html += `
      <div class="chapter-item" data-ch-idx="${idx}">
        <div class="chapter-item-left">
          <span class="chapter-number-pill">${cleanChTitle}</span>
          <span class="chapter-lang-badge badge-lang-en">🇬🇧 EN Mirror</span>
        </div>
        <div class="chapter-item-right">
          ${isDownloaded ? `
            <span class="badge-downloaded-success" title="Chapter tersimpan di penyimpanan offline browser">
              <i data-lucide="check-circle-2"></i> Tersimpan
            </span>
            <button class="btn-delete-download" title="Hapus dari penyimpanan offline" data-ch-url="${ch.url}">
              <i data-lucide="trash-2"></i>
            </button>
          ` : `
            <button class="btn-ch-download" title="Download Chapter ini ke memori offline" data-ch-idx="${idx}">
              <i data-lucide="download"></i>
            </button>
          `}
          <span>Baca Chapter</span>
          <i data-lucide="chevron-right"></i>
        </div>
      </div>
    `;
  });
  html += `</div>`;

  container.innerHTML = html;

  container.querySelectorAll('.mirror-matches-row .quick-tag-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const u = chip.dataset.url;
      container.innerHTML = `<div class="spinner" style="margin: 2rem auto;"></div>`;
      try {
        const res = await fetch(`/api/external/en/chapters?url=${encodeURIComponent(u)}`);
        const data = await res.json();
        const chs = data.chapters || [];
        const matchC = allMatchedComics.find(x => x.url === u) || { url: u, title: chip.textContent };
        state.activeEnglishComic = matchC;
        state.rawEnglishChapters = chs;
        renderEnglishChaptersList(chs, matchC, allMatchedComics);
      } catch (e) {
        showToast('Gagal memuat chapter untuk judul ini');
      }
    });
  });

  container.querySelectorAll('.mirror-chapters-grid .chapter-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-ch-download') || e.target.closest('.btn-delete-download')) return;
      const idx = parseInt(item.dataset.chIdx);
      const ch = parsed[idx];
      openEnglishReader(ch.url, ch.title.replace(/\s+/g, ' ').trim(), parsed, idx);
    });

    item.querySelector('.btn-ch-download')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(item.dataset.chIdx);
      const ch = parsed[idx];
      if (!window.OfflineManager) return;

      const mangaObj = {
        id: mangaId,
        title: state.currentManga ? getMangaTitle(state.currentManga.attributes) : activeComic.title,
        coverUrl: state.currentManga ? getCoverUrl(state.currentManga) : (activeComic.thumb || ''),
        synopsis: state.currentManga?.attributes?.description?.en || state.currentManga?.attributes?.description?.id || ''
      };

      OfflineManager.enqueueChapter(
        mangaObj,
        {
          id: ch.url,
          url: ch.url,
          number: ch.num,
          title: ch.title.replace(/\s+/g, ' ').trim()
        },
        'english'
      );
    });

    item.querySelector('.btn-delete-download')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const chUrl = e.currentTarget.dataset.chUrl;
      if (!window.OfflineManager || !chUrl) return;
      await OfflineManager.deleteChapter(chUrl);
      renderEnglishChaptersList(chapters, activeComic, allMatchedComics);
    });
  });

  initIcons();
}

export async function renderChaptersList(chapters) {
  const container = document.getElementById('chapters-list');
  const countBadge = document.getElementById('chapters-total-badge');
  if (countBadge) countBadge.textContent = `${chapters.length} Chapter`;

  if (!container) return;

  if (chapters.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="folder-x"></i>
        <h4>Belum Ada Chapter untuk Filter Ini</h4>
        <p>Coba pilih tab filter bahasa "Semua", "🇮🇩 ID", atau "🇬🇧 EN".</p>
      </div>
    `;
    initIcons();
    return;
  }

  const downloadedSet = window.OfflineManager
    ? await OfflineManager.getDownloadedChapterIds(state.currentManga?.id)
    : new Set();

  container.innerHTML = '';
  chapters.forEach((ch, idx) => {
    const chNum = ch.attributes?.chapter ? `Chapter ${ch.attributes.chapter}` : 'Oneshot / Extra';
    const chTitle = ch.attributes?.title ? `: ${ch.attributes.title}` : '';
    const lang = ch.attributes?.translatedLanguage || 'en';
    const isId = lang === 'id';
    const langFlag = isId ? '🇮🇩 ID' : '🇬🇧 EN';
    const langClass = isId ? 'badge-lang-id' : 'badge-lang-en';

    const groupRel = ch.relationships?.find(r => r.type === 'scanlation_group');
    const groupName = ch.attributes?.scanlationGroup || groupRel?.attributes?.name || 'MangaDex';

    const isDownloaded = downloadedSet.has(ch.id);

    const item = document.createElement('div');
    item.className = 'chapter-item';
    item.innerHTML = `
      <div class="chapter-item-left">
        <span class="chapter-number-pill">${chNum}</span>
        <span class="chapter-lang-badge ${langClass}">${langFlag}</span>
        <span class="chapter-title-text">${chTitle}</span>
        <span class="chapter-group-badge" title="Grup Scanlation">${groupName}</span>
      </div>
      <div class="chapter-item-right">
        ${isDownloaded ? `
          <span class="badge-downloaded-success" title="Chapter tersimpan di penyimpanan offline browser">
            <i data-lucide="check-circle-2"></i> Tersimpan
          </span>
          <button class="btn-delete-download" title="Hapus dari penyimpanan offline" data-ch-id="${ch.id}">
            <i data-lucide="trash-2"></i>
          </button>
        ` : `
          <button class="btn-ch-download" title="Download Chapter ini ke memori offline" data-ch-idx="${idx}">
            <i data-lucide="download"></i>
          </button>
        `}
        <i data-lucide="chevron-right"></i>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-ch-download') || e.target.closest('.btn-delete-download')) return;
      state.currentReadingLang = lang;
      openReader(ch.id, idx);
    });

    item.querySelector('.btn-ch-download')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!window.OfflineManager || !state.currentManga) return;
      OfflineManager.enqueueChapter(
        {
          id: state.currentManga.id,
          title: getMangaTitle(state.currentManga.attributes),
          coverUrl: getCoverUrl(state.currentManga),
          synopsis: state.currentManga.attributes?.description?.id || state.currentManga.attributes?.description?.en || ''
        },
        {
          id: ch.id,
          number: ch.attributes?.chapter || (idx + 1),
          title: `${chNum}${chTitle}`
        },
        'mangadex'
      );
    });

    item.querySelector('.btn-delete-download')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const chId = e.currentTarget.dataset.chId;
      if (!window.OfflineManager || !chId) return;
      await OfflineManager.deleteChapter(chId);
      renderChaptersList(state.currentChapters);
    });

    container.appendChild(item);
  });

  initIcons();
}

export function updateCustomChapterDropdown(items, currentVal, onSelect) {
  const triggerLabel = document.getElementById('custom-chapter-label');
  const listEl = document.getElementById('custom-chapter-list');
  const panel = document.getElementById('custom-chapter-panel');
  const searchInput = document.getElementById('dropdown-chapter-search');
  const selectFallback = document.getElementById('reader-chapter-select');

  if (selectFallback) {
    selectFallback.innerHTML = '';
    items.forEach(it => {
      const opt = document.createElement('option');
      opt.value = it.value;
      opt.textContent = it.label;
      if (it.value === currentVal) opt.selected = true;
      selectFallback.appendChild(opt);
    });
  }

  const currentItem = items.find(it => it.value === currentVal) || items[0];
  if (triggerLabel) {
    triggerLabel.textContent = currentItem ? currentItem.label : 'Pilih Chapter...';
  }

  const renderDropdownList = (filterQuery = '') => {
    if (!listEl) return;
    listEl.innerHTML = '';
    const q = filterQuery.toLowerCase().trim();
    const filtered = items.filter(it => it.label.toLowerCase().includes(q));

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.8rem;">Chapter tidak ditemukan</div>`;
      return;
    }

    filtered.forEach(it => {
      const el = document.createElement('div');
      const isActive = it.value === currentVal;
      el.className = `custom-dropdown-item ${isActive ? 'active' : ''}`;
      const langTag = it.lang ? `<span class="custom-item-tag ${it.lang}">${it.lang.toUpperCase()}</span>` : '';
      el.innerHTML = `
        <div class="custom-item-left">
          <i data-lucide="${isActive ? 'check' : 'book-open'}" style="width: 14px; height: 14px;"></i>
          <span class="custom-item-title">${it.label}</span>
        </div>
        ${langTag}
      `;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        panel?.classList.add('hidden');
        document.getElementById('custom-chapter-dropdown')?.classList.remove('open');
        onSelect(it.value);
      });
      listEl.appendChild(el);
    });
    initIcons();
  };

  renderDropdownList();

  if (searchInput) {
    searchInput.value = '';
    searchInput.oninput = (e) => {
      renderDropdownList(e.target.value);
    };
  }
}

export function initOfflineDownloadControls() {
  const btnDownloadAll = document.getElementById('btn-download-all');
  const btnOptions = document.getElementById('btn-download-options');
  const menuOptions = document.getElementById('download-dropdown-menu');
  const optNext5 = document.getElementById('opt-download-next-5');
  const optUnread10 = document.getElementById('opt-download-unread-10');

  btnOptions?.addEventListener('click', (e) => {
    e.stopPropagation();
    menuOptions?.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    menuOptions?.classList.add('hidden');
  });

  btnDownloadAll?.addEventListener('click', async () => {
    if (!window.OfflineManager || !state.currentManga) return;

    const mangaObj = {
      id: state.currentManga.id,
      title: getMangaTitle(state.currentManga.attributes),
      coverUrl: getCoverUrl(state.currentManga),
      synopsis: state.currentManga.attributes?.description?.id || state.currentManga.attributes?.description?.en || ''
    };

    if (state.currentSource === 'bacakomik') {
      if (!state.externalChapters || state.externalChapters.length === 0) {
        showToast('Tidak ada chapter yang tersedia di mirror.');
        return;
      }
      const chs = state.externalChapters.map(c => ({
        id: c.url,
        url: c.url,
        number: c.num,
        title: c.title.replace(/\s+/g, ' ').trim()
      }));
      await OfflineManager.enqueueMultipleChapters(mangaObj, chs, 'bacakomik');
    } else if (state.currentSource === 'english') {
      if (!state.englishChapters || state.englishChapters.length === 0) {
        showToast('Tidak ada chapter yang tersedia di English mirror.');
        return;
      }
      const chs = state.englishChapters.map(c => ({
        id: c.url,
        url: c.url,
        number: c.num,
        title: c.title.replace(/\s+/g, ' ').trim()
      }));
      await OfflineManager.enqueueMultipleChapters(mangaObj, chs, 'english');
    } else {
      if (!state.currentChapters || state.currentChapters.length === 0) {
        showToast('Tidak ada chapter yang tersedia untuk diunduh.');
        return;
      }
      const chs = state.currentChapters.map(c => ({
        id: c.id,
        number: c.attributes?.chapter || '',
        title: `Chapter ${c.attributes?.chapter || ''} ${c.attributes?.title || ''}`.trim()
      }));
      await OfflineManager.enqueueMultipleChapters(mangaObj, chs, 'mangadex');
    }
  });

  optNext5?.addEventListener('click', async () => {
    if (!window.OfflineManager || !state.currentManga) return;
    menuOptions?.classList.add('hidden');

    const mangaObj = {
      id: state.currentManga.id,
      title: getMangaTitle(state.currentManga.attributes),
      coverUrl: getCoverUrl(state.currentManga),
      synopsis: state.currentManga.attributes?.description?.id || state.currentManga.attributes?.description?.en || ''
    };

    let targetList = [];
    if (state.currentSource === 'bacakomik') {
      targetList = state.externalChapters.map(c => ({ id: c.url, url: c.url, number: c.num, title: c.title.replace(/\s+/g, ' ').trim() }));
    } else if (state.currentSource === 'english') {
      targetList = state.englishChapters.map(c => ({ id: c.url, url: c.url, number: c.num, title: c.title.replace(/\s+/g, ' ').trim() }));
    } else {
      targetList = state.currentChapters.map(c => ({ id: c.id, number: c.attributes?.chapter || '', title: `Chapter ${c.attributes?.chapter || ''}`.trim() }));
    }

    if (targetList.length === 0) {
      showToast('Tidak ada chapter yang tersedia.');
      return;
    }

    const downloadedSet = await OfflineManager.getDownloadedChapterIds(mangaObj.id);
    const toDownload = targetList.filter(c => !downloadedSet.has(c.id)).slice(0, 5);

    if (toDownload.length === 0) {
      showToast('Semua chapter sudah terunduh!');
      return;
    }

    await OfflineManager.enqueueMultipleChapters(mangaObj, toDownload, state.currentSource);
  });

  optUnread10?.addEventListener('click', async () => {
    if (!window.OfflineManager || !state.currentManga) return;
    menuOptions?.classList.add('hidden');

    const history = getStoredList(STORAGE_KEY_HISTORY);
    const readIds = new Set(history.map(h => h.chapterId).filter(Boolean));

    const mangaObj = {
      id: state.currentManga.id,
      title: getMangaTitle(state.currentManga.attributes),
      coverUrl: getCoverUrl(state.currentManga),
      synopsis: state.currentManga.attributes?.description?.id || state.currentManga.attributes?.description?.en || ''
    };

    let targetList = [];
    if (state.currentSource === 'bacakomik') {
      targetList = state.externalChapters.map(c => ({ id: c.url, url: c.url, number: c.num, title: c.title.replace(/\s+/g, ' ').trim() }));
    } else if (state.currentSource === 'english') {
      targetList = state.englishChapters.map(c => ({ id: c.url, url: c.url, number: c.num, title: c.title.replace(/\s+/g, ' ').trim() }));
    } else {
      targetList = state.currentChapters.map(c => ({ id: c.id, number: c.attributes?.chapter || '', title: `Chapter ${c.attributes?.chapter || ''}`.trim() }));
    }

    const downloadedSet = await OfflineManager.getDownloadedChapterIds(mangaObj.id);
    const unreadUnDownloaded = targetList.filter(c => !readIds.has(c.id) && !downloadedSet.has(c.id)).slice(0, 10);

    if (unreadUnDownloaded.length === 0) {
      showToast('Semua chapter yang belum dibaca sudah terunduh atau tidak ada chapter baru.');
      return;
    }

    await OfflineManager.enqueueMultipleChapters(mangaObj, unreadUnDownloaded, state.currentSource);
  });
}

export async function renderKomikuChaptersList(chapters, comicInfo) {
  const container = document.getElementById('chapters-list');
  if (!container) return;

  state.currentSource = 'komiku';
  state.rawKomikuChapters = chapters || [];

  const langPills = document.getElementById('mangadex-lang-pills');
  if (langPills) langPills.style.display = 'none';

  const badge = document.getElementById('chapters-total-badge');
  if (badge) badge.textContent = `${chapters.length} Chapter (Komiku)`;

  if (!chapters || chapters.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="book-x"></i>
        <h3>Tidak Ada Chapter Ditemukan</h3>
        <p>Belum ada rilis chapter dari Komiku untuk judul ini.</p>
      </div>
    `;
    initIcons();
    return;
  }

  // Parse and sort chapters
  const parsed = chapters.map(c => {
    const numMatch = (c.title || '').match(/chapter\s*([\d.]+)/i) || (c.url || '').match(/chapter-([\d.]+)/i);
    const num = numMatch ? parseFloat(numMatch[1]) : 0;
    return { ...c, num };
  });

  const order = state.komikuOrder || 'asc';
  parsed.sort((a, b) => order === 'asc' ? a.num - b.num : b.num - a.num);

  state.externalChapters = parsed;

  const mangaId = state.currentManga?.id || comicInfo?.id || 'komiku';
  const downloadedSet = window.OfflineManager
    ? await OfflineManager.getDownloadedChapterIds(mangaId)
    : new Set();

  let html = `<div class="mirror-chapters-grid">`;
  parsed.forEach((ch, idx) => {
    const cleanChTitle = ch.title.replace(/\s+/g, ' ').trim();
    const isDownloaded = downloadedSet.has(ch.url);
    html += `
      <div class="chapter-item" data-ch-idx="${idx}">
        <div class="chapter-item-left">
          <span class="chapter-number-pill">${cleanChTitle}</span>
          <span class="chapter-group-badge" style="color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">🇮🇩 Komiku Indo Scan</span>
          ${ch.releaseDate ? `<span class="chapter-date" style="font-size: 0.75rem; color: var(--color-text-muted); margin-left: 0.5rem;">${ch.releaseDate}</span>` : ''}
        </div>
        <div class="chapter-item-right">
          ${isDownloaded ? `
            <span class="badge-downloaded-success" title="Chapter tersimpan di penyimpanan offline browser">
              <i data-lucide="check-circle-2"></i> Tersimpan
            </span>
            <button class="btn-delete-download" title="Hapus dari penyimpanan offline" data-ch-url="${ch.url}">
              <i data-lucide="trash-2"></i>
            </button>
          ` : `
            <button class="btn-ch-download" title="Download Chapter ini ke memori offline" data-ch-idx="${idx}">
              <i data-lucide="download"></i>
            </button>
          `}
          <span>Baca Chapter</span>
          <i data-lucide="chevron-right"></i>
        </div>
      </div>
    `;
  });
  html += `</div>`;

  container.innerHTML = html;

  container.querySelectorAll('.mirror-chapters-grid .chapter-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-ch-download') || e.target.closest('.btn-delete-download')) return;
      const idx = parseInt(item.dataset.chIdx);
      const ch = parsed[idx];
      openExternalReader(ch.url, ch.title.replace(/\s+/g, ' ').trim(), parsed, idx);
    });

    item.querySelector('.btn-ch-download')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(item.dataset.chIdx);
      const ch = parsed[idx];
      if (!window.OfflineManager) return;

      const mangaObj = {
        id: mangaId,
        title: state.currentManga ? getMangaTitle(state.currentManga.attributes) : (comicInfo?.title || 'Komik'),
        coverUrl: state.currentManga ? getCoverUrl(state.currentManga) : (comicInfo?.coverUrl || ''),
        synopsis: state.currentManga?.attributes?.description?.id || state.currentManga?.attributes?.description?.en || ''
      };

      OfflineManager.enqueueChapter(
        mangaObj,
        {
          id: ch.url,
          url: ch.url,
          number: ch.num,
          title: ch.title.replace(/\s+/g, ' ').trim()
        },
        'komiku'
      );
    });

    item.querySelector('.btn-delete-download')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const chUrl = e.currentTarget.dataset.chUrl;
      if (!window.OfflineManager || !chUrl) return;
      await OfflineManager.deleteChapter(chUrl);
      renderKomikuChaptersList(chapters, comicInfo);
    });
  });

  initIcons();
}

