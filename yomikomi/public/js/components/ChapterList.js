/**
 * ChapterList Component
 * Unified Language Tabs (🇮🇩 Indonesia & 🇬🇧 English)
 * Smart Chapter Merger: parallel multi-provider fetching (MangaDex, Komiku, Mirror),
 * deduplication, chronological sorting, and single/batch offline download
 */

import {
  state,
  initIcons,
  showToast,
  getMangaTitle,
  getCoverUrl,
  normalizeTitle,
  getStoredList,
  STORAGE_KEY_HISTORY
} from '../state.js';
import { openReader, openExternalReader, openEnglishReader } from './Reader.js';
import { fetchKomikuSearch, fetchKomikuManga } from '../services/api.js';

/**
 * Update sort button visual state and label
 */
export function updateSortButtonLabel(order) {
  const btn = document.getElementById('chapter-sort-btn');
  const label = document.getElementById('chapter-sort-label');
  if (btn) btn.dataset.order = order;
  if (label) label.textContent = order === 'asc' ? 'Chapter 1 → Akhir' : 'Terbaru → Lama';
}

/**
 * Toggle sorting order between 'asc' and 'desc'
 */
export function toggleChapterSort() {
  const nextOrder = state.activeDetailSort === 'asc' ? 'desc' : 'asc';
  state.activeDetailSort = nextOrder;
  state.currentSort = nextOrder;
  updateSortButtonLabel(nextOrder);

  if (state.unifiedChapters) {
    if (Array.isArray(state.unifiedChapters.id)) {
      state.unifiedChapters.id.sort((a, b) => nextOrder === 'asc' ? a.number - b.number : b.number - a.number);
    }
    if (Array.isArray(state.unifiedChapters.en)) {
      state.unifiedChapters.en.sort((a, b) => nextOrder === 'asc' ? a.number - b.number : b.number - a.number);
    }
    renderUnifiedChaptersList();
  }
}

/**
 * Initialize Language Filter Tabs (🇮🇩 Indonesia & 🇬🇧 English)
 */
export function initLanguageFilterTabs() {
  const tabs = document.querySelectorAll('#chapter-lang-tabs .lang-filter-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetLang = tab.dataset.lang;
      if (targetLang === state.activeDetailLang) return;

      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      state.activeDetailLang = targetLang;
      renderUnifiedChaptersList();
    });
  });
}

/**
 * Title string similarity calculator using Jaccard & substring metrics
 */
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

/**
 * Filter & rank comic match candidates
 */
export function filterAndSortMatchingComics(targetTitles, candidateComics) {
  if (!candidateComics || !Array.isArray(candidateComics) || candidateComics.length === 0) return [];

  const scored = [];
  for (const comic of candidateComics) {
    let maxScore = 0;
    for (const target of targetTitles) {
      const score = calculateTitleSimilarity(target, comic.title);
      if (score > maxScore) maxScore = score;
    }
    if (maxScore >= 0.5) {
      scored.push({ comic, score: maxScore });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.comic);
}

/**
 * Extract comprehensive search candidate keywords from current manga
 */
function extractTitleCandidates(manga) {
  const primaryTitle = getMangaTitle(manga?.attributes) || manga?.title || '';
  const candidates = [primaryTitle];

  if (manga?.attributes?.altTitles && Array.isArray(manga.attributes.altTitles)) {
    manga.attributes.altTitles.forEach(at => {
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
    if (s1 && !candidates.includes(s1)) variants.push(s1);
    const s2 = c.replace(/[-_:]/g, '').replace(/\s+/g, ' ').trim();
    if (s2 && !candidates.includes(s2)) variants.push(s2);
  });

  return [...candidates, ...variants];
}

/**
 * SMART CHAPTER MERGER
 * Parallel fetches from MangaDex, Komiku, and mirrors, deduplicates by chapter number,
 * and partitions cleanly into { id: [...], en: [...] }
 */
export async function loadUnifiedChapters(mangaId, mangaData = null, prefetchedKomikuChapters = null) {
  const chaptersContainer = document.getElementById('chapters-list');
  const countBadge = document.getElementById('chapters-total-badge');
  const countIdEl = document.getElementById('lang-count-id');
  const countEnEl = document.getElementById('lang-count-en');

  if (chaptersContainer) {
    chaptersContainer.innerHTML = `
      <div class="chapters-loader-box" style="padding: 3rem 1rem; text-align: center;">
        <div class="spinner" style="margin: 0 auto 1rem auto;"></div>
        <p style="color: var(--text-muted); font-size: 0.9rem;">Menghubungkan MangaDex & Komiku...</p>
      </div>
    `;
  }
  if (countBadge) countBadge.textContent = 'Memuat chapter...';
  if (countIdEl) countIdEl.textContent = '...';
  if (countEnEl) countEnEl.textContent = '...';

  updateSortButtonLabel(state.activeDetailSort || 'asc');

  const currentManga = mangaData || state.currentManga;
  const isKomikuManga = (typeof mangaId === 'string' && mangaId.startsWith('komiku-')) || currentManga?.source === 'komiku';
  const cleanSlug = isKomikuManga ? (currentManga?.slug || mangaId).replace(/^komiku-/, '') : null;

  const titleCandidates = extractTitleCandidates(currentManga);
  const primaryTitle = titleCandidates[0] || '';

  // -------------------------------------------------------------
  // Task 1: Fetch MangaDex Chapters
  // -------------------------------------------------------------
  const fetchMangaDexTask = async () => {
    if (!isKomikuManga) {
      try {
        const res = await fetch(`/api/manga/${mangaId}/chapters?lang=all&order=asc&limit=500`);
        const data = await res.json();
        return data.data || [];
      } catch (err) {
        console.warn('[SmartMerger] Failed fetching MangaDex chapters by ID:', err.message);
        return [];
      }
    } else {
      // Manga is currently opened from Komiku -> Search MangaDex to find matching MangaDex manga!
      for (const query of titleCandidates.slice(0, 3)) {
        try {
          const sRes = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=5`);
          const sData = await sRes.json();
          const list = sData.data || [];
          if (list.length > 0) {
            let best = null;
            let maxSc = 0;
            for (const item of list) {
              const itemTitle = getMangaTitle(item.attributes);
              const sc = calculateTitleSimilarity(primaryTitle, itemTitle);
              if (sc > maxSc) {
                maxSc = sc;
                best = item;
              }
            }
            if (best && maxSc >= 0.5) {
              const chRes = await fetch(`/api/manga/${best.id}/chapters?lang=all&order=asc&limit=500`);
              const chData = await chRes.json();
              return chData.data || [];
            }
          }
        } catch (e) { }
      }
      return [];
    }
  };

  // -------------------------------------------------------------
  // Task 2: Fetch Komiku Chapters
  // -------------------------------------------------------------
  const fetchKomikuTask = async () => {
    if (prefetchedKomikuChapters && prefetchedKomikuChapters.length > 0) {
      return prefetchedKomikuChapters;
    }

    if (isKomikuManga && cleanSlug) {
      try {
        const kDetail = await fetchKomikuManga(cleanSlug);
        return kDetail?.chapters || [];
      } catch (err) {
        console.warn('[SmartMerger] Failed fetching Komiku chapters by slug:', err.message);
        return [];
      }
    } else {
      // Manga is from MangaDex -> Search Komiku to find Indo chapters!
      for (const query of titleCandidates.slice(0, 4)) {
        try {
          const kResults = await fetchKomikuSearch(query);
          if (kResults && kResults.length > 0) {
            const matches = filterAndSortMatchingComics(titleCandidates, kResults);
            if (matches.length > 0) {
              const matchedComic = matches[0];
              const kDetail = await fetchKomikuManga(matchedComic.slug);
              if (kDetail?.chapters && kDetail.chapters.length > 0) {
                return kDetail.chapters;
              }
            }
          }
        } catch (e) { }
      }

      // Secondary fallback: Indo mirror (Bacakomik / Komikindo)
      for (const query of titleCandidates.slice(0, 2)) {
        try {
          const bRes = await fetch(`/api/external/search?q=${encodeURIComponent(query)}`);
          const bData = await bRes.json();
          if (bData.data && bData.data.length > 0) {
            const matches = filterAndSortMatchingComics(titleCandidates, bData.data);
            if (matches.length > 0) {
              const chRes = await fetch(`/api/external/chapters?url=${encodeURIComponent(matches[0].url)}`);
              const chData = await chRes.json();
              if (chData.chapters && chData.chapters.length > 0) {
                return chData.chapters.map(c => ({
                  ...c,
                  source: 'bacakomik',
                  language: 'id'
                }));
              }
            }
          }
        } catch (e) { }
      }

      return [];
    }
  };

  // Run primary tasks in parallel
  const [mdResult, komikuResult] = await Promise.allSettled([
    fetchMangaDexTask(),
    fetchKomikuTask()
  ]);

  const mdChapters = mdResult.status === 'fulfilled' ? mdResult.value : [];
  const komikuChapters = komikuResult.status === 'fulfilled' ? komikuResult.value : [];

  // -------------------------------------------------------------
  // Task 3: English Mirror Fallback (if MangaDex returned 0 English chapters)
  // -------------------------------------------------------------
  let englishMirrorChapters = [];
  const mdHasEn = mdChapters.some(c => c.attributes?.translatedLanguage === 'en');
  if (!mdHasEn) {
    for (const query of titleCandidates.slice(0, 2)) {
      try {
        const enRes = await fetch(`/api/external/en/search?q=${encodeURIComponent(query)}`);
        const enData = await enRes.json();
        if (enData.data && enData.data.length > 0) {
          const matches = filterAndSortMatchingComics(titleCandidates, enData.data);
          if (matches.length > 0) {
            const chRes = await fetch(`/api/external/en/chapters?url=${encodeURIComponent(matches[0].url)}`);
            const chData = await chRes.json();
            if (chData.chapters && chData.chapters.length > 0) {
              englishMirrorChapters = chData.chapters;
              break;
            }
          }
        }
      } catch (e) { }
    }
  }

  // -------------------------------------------------------------
  // Normalization to UnifiedChapter Schema
  // -------------------------------------------------------------
  const rawIdList = [];
  const rawEnList = [];

  // Normalize MangaDex chapters
  mdChapters.forEach((ch, idx) => {
    const rawNum = ch.attributes?.chapter;
    const num = rawNum ? parseFloat(rawNum) : (idx + 1);
    const lang = ch.attributes?.translatedLanguage === 'id' ? 'id' : 'en';
    const groupRel = ch.relationships?.find(r => r.type === 'scanlation_group');
    const groupName = ch.attributes?.scanlationGroup || groupRel?.attributes?.name || 'MangaDex';

    const item = {
      id: ch.id,
      number: isNaN(num) ? 0 : num,
      chapterNumStr: rawNum || String(idx + 1),
      title: rawNum ? `Chapter ${rawNum}` : (ch.attributes?.title || 'Chapter'),
      subTitle: ch.attributes?.title || '',
      language: lang,
      source: 'mangadex',
      scanlationGroup: groupName,
      raw: ch
    };

    if (lang === 'id') rawIdList.push(item);
    else if (lang === 'en') rawEnList.push(item);
  });

  // Normalize Komiku chapters
  komikuChapters.forEach((kc, idx) => {
    const numMatch = (kc.title || '').match(/chapter\s*([\d.]+)/i) ||
      (kc.url || '').match(/chapter-([\d.]+)/i) ||
      (kc.number ? String(kc.number).match(/([\d.]+)/) : null);
    const num = numMatch ? parseFloat(numMatch[1]) : (komikuChapters.length - idx);
    const cleanTitle = (kc.title || `Chapter ${num}`).replace(/\s+/g, ' ').trim();

    rawIdList.push({
      id: kc.url || kc.id || `komiku-ch-${num}`,
      url: kc.url,
      number: isNaN(num) ? 0 : num,
      chapterNumStr: String(num),
      title: cleanTitle.toLowerCase().startsWith('chapter') ? cleanTitle : `Chapter ${cleanTitle}`,
      subTitle: '',
      language: 'id',
      source: kc.source === 'bacakomik' ? 'bacakomik' : 'komiku',
      scanlationGroup: kc.source === 'bacakomik' ? 'Indo Mirror' : 'Komiku Indo Scan',
      releaseDate: kc.releaseDate || '',
      raw: kc
    });
  });

  // Normalize English Mirror chapters
  englishMirrorChapters.forEach((ec, idx) => {
    const numMatch = (ec.title || '').match(/chapter\s*([\d.]+)/i) || (ec.url || '').match(/chapter-([\d.]+)/i);
    const num = numMatch ? parseFloat(numMatch[1]) : (englishMirrorChapters.length - idx);
    const cleanTitle = (ec.title || `Chapter ${num}`).replace(/\s+/g, ' ').trim();

    rawEnList.push({
      id: ec.url,
      url: ec.url,
      number: isNaN(num) ? 0 : num,
      chapterNumStr: String(num),
      title: cleanTitle.toLowerCase().startsWith('chapter') ? cleanTitle : `Chapter ${cleanTitle}`,
      subTitle: '',
      language: 'en',
      source: 'mangapill',
      scanlationGroup: 'English Mirror',
      raw: ec
    });
  });

  // -------------------------------------------------------------
  // Deduplikasi Cerdas (Smart Chapter Deduplication)
  // Rule: If identical chapter number exists across providers,
  // prioritize MangaDex for image stability and CDN speed!
  // -------------------------------------------------------------
  function deduplicateChapters(chapters) {
    const map = new Map();
    for (const ch of chapters) {
      const key = ch.number;
      if (!map.has(key)) {
        map.set(key, ch);
      } else {
        const existing = map.get(key);
        if (existing.source !== 'mangadex' && ch.source === 'mangadex') {
          map.set(key, ch);
        }
      }
    }
    return Array.from(map.values());
  }

  const dedupedId = deduplicateChapters(rawIdList);
  const dedupedEn = deduplicateChapters(rawEnList);

  // Sorting
  const order = state.activeDetailSort || 'asc';
  dedupedId.sort((a, b) => order === 'asc' ? a.number - b.number : b.number - a.number);
  dedupedEn.sort((a, b) => order === 'asc' ? a.number - b.number : b.number - a.number);

  // Store into unified state
  state.unifiedChapters = {
    id: dedupedId,
    en: dedupedEn
  };
  state.allMangaDexChapters = mdChapters;

  // Update language counter badges
  if (countIdEl) countIdEl.textContent = dedupedId.length;
  if (countEnEl) countEnEl.textContent = dedupedEn.length;

  // -------------------------------------------------------------
  // Seamless Auto-Fallback: Never show "0 Chapter" if the other provider has data!
  // -------------------------------------------------------------
  if (dedupedId.length === 0 && dedupedEn.length > 0) {
    state.activeDetailLang = 'en';
  } else if (dedupedEn.length === 0 && dedupedId.length > 0) {
    state.activeDetailLang = 'id';
  } else if (!state.activeDetailLang) {
    state.activeDetailLang = 'id';
  }

  document.querySelectorAll('#chapter-lang-tabs .lang-filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.lang === state.activeDetailLang);
  });

  renderUnifiedChaptersList();
}

/**
 * Render the unified chapter list based on state.activeDetailLang
 */
export async function renderUnifiedChaptersList() {
  const container = document.getElementById('chapters-list');
  const countBadge = document.getElementById('chapters-total-badge');
  if (!container) return;

  const activeLang = state.activeDetailLang || 'id';
  const chapters = state.unifiedChapters?.[activeLang] || [];

  if (countBadge) {
    countBadge.textContent = `${chapters.length} Chapter (${activeLang === 'id' ? 'Indonesia' : 'English'})`;
  }

  // Synchronize active collections for Reader and external handlers
  state.activeChapters = chapters;
  state.currentChapters = chapters;
  state.externalChapters = chapters.filter(c => c.source === 'komiku' || c.source === 'bacakomik').map(c => c.raw);
  state.englishChapters = chapters.filter(c => c.source === 'mangapill').map(c => c.raw);

  if (chapters.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="book-x"></i>
        <h4>Belum Ada Chapter ${activeLang === 'id' ? 'Bahasa Indonesia' : 'English'}</h4>
        <p>Tidak ada rilis chapter untuk bahasa ini. Coba pilih tab ${activeLang === 'id' ? '🇬🇧 English' : '🇮🇩 Indonesia'}.</p>
      </div>
    `;
    initIcons();
    return;
  }

  const mangaId = state.currentManga?.id || 'manga';
  const downloadedSet = window.OfflineManager
    ? await OfflineManager.getDownloadedChapterIds(mangaId)
    : new Set();

  let html = '';
  chapters.forEach((ch, idx) => {
    const isDownloaded = downloadedSet.has(ch.id) || (ch.url && downloadedSet.has(ch.url));

    let sourcePillHtml = '';
    if (ch.source === 'mangadex') {
      sourcePillHtml = `<span class="chapter-source-pill source-mangadex" title="Grup Scanlation: ${ch.scanlationGroup}">MangaDex • ${ch.scanlationGroup}</span>`;
    } else if (ch.source === 'komiku') {
      sourcePillHtml = `<span class="chapter-source-pill source-komiku" title="Komiku Indo Scan">Komiku Indo Scan</span>`;
    } else if (ch.source === 'bacakomik') {
      sourcePillHtml = `<span class="chapter-source-pill source-komiku" title="Indo Mirror">Indo Mirror</span>`;
    } else {
      sourcePillHtml = `<span class="chapter-source-pill source-mangapill" title="English Mirror">EN Mirror</span>`;
    }

    html += `
      <div class="chapter-item" data-ch-idx="${idx}">
        <div class="chapter-item-left">
          <span class="chapter-number-pill">${ch.title}</span>
          ${sourcePillHtml}
          ${ch.subTitle ? `<span class="chapter-title-text">: ${ch.subTitle}</span>` : ''}
          ${ch.releaseDate ? `<span class="chapter-date">${ch.releaseDate}</span>` : ''}
        </div>
        <div class="chapter-item-right">
          ${isDownloaded ? `
            <span class="badge-downloaded-success" title="Chapter tersimpan di penyimpanan offline browser">
              <i data-lucide="check-circle-2"></i> Tersimpan
            </span>
            <button class="btn-delete-download" title="Hapus dari penyimpanan offline" data-ch-idx="${idx}">
              <i data-lucide="trash-2"></i>
            </button>
          ` : `
            <button class="btn-ch-download" title="Download chapter ini untuk dibaca offline" data-ch-idx="${idx}">
              <i data-lucide="download"></i>
            </button>
          `}
          <span class="chapter-action-text">Baca</span>
          <i data-lucide="chevron-right"></i>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  initIcons();

  // Attach click events
  container.querySelectorAll('.chapter-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-ch-download') || e.target.closest('.btn-delete-download')) return;
      const idx = parseInt(item.dataset.chIdx, 10);
      const ch = chapters[idx];
      openUnifiedChapter(ch, idx);
    });

    item.querySelector('.btn-ch-download')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(item.dataset.chIdx, 10);
      const ch = chapters[idx];
      downloadSingleChapter(ch);
    });

    item.querySelector('.btn-delete-download')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(item.dataset.chIdx, 10);
      const ch = chapters[idx];
      if (window.OfflineManager) {
        await OfflineManager.deleteChapter(ch.id || ch.url);
        renderUnifiedChaptersList();
      }
    });
  });
}

/**
 * Dispatcher to open reader according to chapter source
 */
export function openUnifiedChapter(ch, index) {
  if (!ch) return;
  state.currentUnifiedChapter = ch;
  state.currentChapterIndex = index;

  if (ch.source === 'mangadex') {
    state.isExternal = false;
    openReader(ch.id, index);
  } else if (ch.source === 'komiku' || ch.source === 'bacakomik') {
    state.isExternal = true;
    state.currentSource = 'komiku';
    openExternalReader(ch.url || ch.id, ch.title, state.activeChapters || [ch], index);
  } else {
    state.isExternal = true;
    state.currentSource = 'english';
    openEnglishReader(ch.url || ch.id, ch.title, state.activeChapters || [ch], index);
  }
}
window.openUnifiedChapter = openUnifiedChapter;

/**
 * Download a single chapter
 */
export function downloadSingleChapter(ch) {
  if (!window.OfflineManager || !state.currentManga) return;

  const mangaObj = {
    id: state.currentManga.id,
    title: getMangaTitle(state.currentManga.attributes) || state.currentManga.title || 'Manga',
    coverUrl: getCoverUrl(state.currentManga),
    synopsis: state.currentManga.attributes?.description?.id || state.currentManga.attributes?.description?.en || ''
  };

  OfflineManager.enqueueChapter(
    mangaObj,
    {
      id: ch.id,
      url: ch.url || ch.id,
      number: ch.number,
      title: ch.title
    },
    ch.source
  );
}

/**
 * Custom Chapter Dropdown in Reader
 */
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

/**
 * Batch & Quick Download Controls
 * Operates seamlessly on whichever language tab is currently active!
 */
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

  const getTargetChapters = () => {
    const activeLang = state.activeDetailLang || 'id';
    return state.unifiedChapters?.[activeLang] || [];
  };

  const getMangaObj = () => ({
    id: state.currentManga?.id || 'manga',
    title: state.currentManga ? (getMangaTitle(state.currentManga.attributes) || state.currentManga.title) : 'Manga',
    coverUrl: state.currentManga ? getCoverUrl(state.currentManga) : '',
    synopsis: state.currentManga?.attributes?.description?.id || state.currentManga?.attributes?.description?.en || ''
  });

  btnDownloadAll?.addEventListener('click', async () => {
    if (!window.OfflineManager || !state.currentManga) return;
    const targetList = getTargetChapters();
    if (targetList.length === 0) {
      showToast('Tidak ada chapter yang tersedia untuk diunduh pada tab ini.');
      return;
    }

    const mangaObj = getMangaObj();
    const downloadedSet = await OfflineManager.getDownloadedChapterIds(mangaObj.id);
    const toDownload = targetList.filter(c => !downloadedSet.has(c.id) && !downloadedSet.has(c.url));

    if (toDownload.length === 0) {
      showToast('Semua chapter pada tab ini sudah terunduh!');
      return;
    }

    for (const ch of toDownload) {
      await OfflineManager.enqueueChapter(mangaObj, {
        id: ch.id,
        url: ch.url || ch.id,
        number: ch.number,
        title: ch.title
      }, ch.source);
    }
  });

  optNext5?.addEventListener('click', async () => {
    if (!window.OfflineManager || !state.currentManga) return;
    menuOptions?.classList.add('hidden');

    const targetList = getTargetChapters();
    if (targetList.length === 0) {
      showToast('Tidak ada chapter yang tersedia.');
      return;
    }

    const mangaObj = getMangaObj();
    const downloadedSet = await OfflineManager.getDownloadedChapterIds(mangaObj.id);
    const toDownload = targetList.filter(c => !downloadedSet.has(c.id) && !downloadedSet.has(c.url)).slice(0, 5);

    if (toDownload.length === 0) {
      showToast('Semua chapter sudah terunduh!');
      return;
    }

    for (const ch of toDownload) {
      await OfflineManager.enqueueChapter(mangaObj, {
        id: ch.id,
        url: ch.url || ch.id,
        number: ch.number,
        title: ch.title
      }, ch.source);
    }
  });

  optUnread10?.addEventListener('click', async () => {
    if (!window.OfflineManager || !state.currentManga) return;
    menuOptions?.classList.add('hidden');

    const history = getStoredList(STORAGE_KEY_HISTORY);
    const readIds = new Set(history.map(h => h.chapterId).filter(Boolean));

    const targetList = getTargetChapters();
    if (targetList.length === 0) {
      showToast('Tidak ada chapter yang tersedia.');
      return;
    }

    const mangaObj = getMangaObj();
    const downloadedSet = await OfflineManager.getDownloadedChapterIds(mangaObj.id);
    const unreadUnDownloaded = targetList.filter(c => {
      const isRead = readIds.has(c.id) || (c.url && readIds.has(c.url));
      const isDownloaded = downloadedSet.has(c.id) || (c.url && downloadedSet.has(c.url));
      return !isRead && !isDownloaded;
    }).slice(0, 10);

    if (unreadUnDownloaded.length === 0) {
      showToast('Semua chapter yang belum dibaca sudah terunduh atau tidak ada chapter baru.');
      return;
    }

    for (const ch of unreadUnDownloaded) {
      await OfflineManager.enqueueChapter(mangaObj, {
        id: ch.id,
        url: ch.url || ch.id,
        number: ch.number,
        title: ch.title
      }, ch.source);
    }
  });
}

// ---------------------------------------------------------------------------
// Backward-Compatibility Stub Exports (prevents breaking legacy imports)
// ---------------------------------------------------------------------------
export async function loadChaptersFeed(mangaId) {
  return loadUnifiedChapters(mangaId);
}
export async function renderChaptersList(chapters) {
  return renderUnifiedChaptersList();
}
export async function renderKomikuChaptersList(chapters, comicInfo) {
  return loadUnifiedChapters(comicInfo?.id || 'komiku', comicInfo, chapters);
}
export async function renderBacakomikChaptersList(chapters, activeComic, allMatchedComics = []) {
  return renderUnifiedChaptersList();
}
export async function renderEnglishChaptersList(chapters, activeComic, allMatchedComics = []) {
  return renderUnifiedChaptersList();
}
export async function loadBacakomikChaptersFeed() {
  return loadUnifiedChapters(state.currentManga?.id);
}
export async function loadEnglishChaptersFeed() {
  return loadUnifiedChapters(state.currentManga?.id);
}
export function initSourceTabs() {
  // No-op: Replaced by initLanguageFilterTabs
}
export function initLanguagePills() {
  // No-op: Replaced by initLanguageFilterTabs
}
export function filterAndRenderMangaDexChapters() {
  return renderUnifiedChaptersList();
}
