/**
 * MangaCache Service
 * In-memory SWR-style caching layer for Manga Detail & Unified Chapters
 * High-performance hover & viewport prefetching engine
 */

import { state } from '../state.js';
import { fetchKomikuManga } from './api.js';

const TTL_MANGA_DETAIL = 15 * 60 * 1000;   // 15 minutes
const TTL_CHAPTERS = 15 * 60 * 1000;       // 15 minutes

export const mangaDetailCache = new Map();
export const mangaChaptersCache = new Map();
export const inFlightMangaPrefetches = new Map();

window.mangaDetailMemoryCache = mangaDetailCache;
window.mangaChaptersMemoryCache = mangaChaptersCache;

/**
 * Get cached manga detail if valid
 */
export function getMangaDetailCached(mangaId) {
  if (!mangaId) return null;
  const entry = mangaDetailCache.get(mangaId);
  if (entry && entry.exp > Date.now()) {
    return entry.data;
  }
  return null;
}

/**
 * Set manga detail in cache with 15-minute TTL
 */
export function setMangaDetailCached(mangaId, data) {
  if (!mangaId || !data) return;
  mangaDetailCache.set(mangaId, {
    data,
    exp: Date.now() + TTL_MANGA_DETAIL
  });
  // Cap cache size
  if (mangaDetailCache.size > 200) {
    const oldest = mangaDetailCache.keys().next().value;
    mangaDetailCache.delete(oldest);
  }
}

/**
 * Get cached unified chapters if valid
 */
export function getUnifiedChaptersCached(mangaId) {
  if (!mangaId) return null;
  const entry = mangaChaptersCache.get(mangaId);
  if (entry && entry.exp > Date.now()) {
    return entry;
  }
  return null;
}

/**
 * Set unified chapters in cache with 15-minute TTL
 */
export function setUnifiedChaptersCached(mangaId, unifiedChapters, allMangaDexChapters = []) {
  if (!mangaId || !unifiedChapters) return;
  mangaChaptersCache.set(mangaId, {
    data: unifiedChapters,
    allMangaDexChapters,
    exp: Date.now() + TTL_CHAPTERS
  });
  // Cap cache size
  if (mangaChaptersCache.size > 150) {
    const oldest = mangaChaptersCache.keys().next().value;
    mangaChaptersCache.delete(oldest);
  }
}

/**
 * Predictive background prefetch for a manga
 * Fetches manga detail + chapter list + pre-warms first chapter pages
 */
export async function prefetchManga(mangaId, maybeMangaData = null) {
  if (!mangaId) return;

  const key = `prefetch_${mangaId}`;
  if (inFlightMangaPrefetches.has(key)) {
    return inFlightMangaPrefetches.get(key);
  }

  const task = (async () => {
    try {
      // 1. Prefetch Manga Detail if not in cache
      let mangaObj = getMangaDetailCached(mangaId);
      if (!mangaObj) {
        const isKomiku = (typeof mangaId === 'string' && mangaId.startsWith('komiku-')) || maybeMangaData?.source === 'komiku';
        if (isKomiku) {
          const slug = (maybeMangaData?.slug || mangaId).replace(/^komiku-/, '');
          const kData = await fetchKomikuManga(slug);
          if (kData) {
            mangaObj = {
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
              },
              chapters: kData.chapters
            };
            setMangaDetailCached(mangaId, mangaObj);
          }
        } else {
          const res = await fetch(`/api/manga/${mangaId}`);
          if (res.ok) {
            const json = await res.json();
            if (json?.data) {
              mangaObj = json.data;
              setMangaDetailCached(mangaId, mangaObj);
            }
          }
        }
      }

      // 2. Prefetch Chapter List if not in cache
      let chEntry = getUnifiedChaptersCached(mangaId);
      if (!chEntry && window.fetchAndMergeUnifiedChapters) {
        chEntry = await window.fetchAndMergeUnifiedChapters(mangaId, mangaObj || maybeMangaData);
      }

      // 3. Eagerly pre-warm first visible chapter in preferred language
      const chapters = chEntry?.data || chEntry;
      if (chapters && window.prefetchChapter) {
        const targetList = chapters.id && chapters.id.length > 0 ? chapters.id : (chapters.en || []);
        if (targetList[0]) {
          window.prefetchChapter(targetList[0]);
        }
      }
    } catch (err) {
      // Background prefetch error silently ignored
    } finally {
      inFlightMangaPrefetches.delete(key);
    }
  })();

  inFlightMangaPrefetches.set(key, task);
  return task;
}

window.prefetchManga = prefetchManga;

// Viewport IntersectionObserver for lazy/idle prefetching of visible cards
let cardViewportObserver = null;
const observedCardIds = new Set();

function getCardViewportObserver() {
  if (!cardViewportObserver && typeof IntersectionObserver !== 'undefined') {
    cardViewportObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const card = entry.target;
          const mangaId = card.dataset.mangaId;
          observer.unobserve(card);

          if (mangaId && !observedCardIds.has(mangaId)) {
            observedCardIds.add(mangaId);
            // Idle prefetch: warm up when browser thread has spare time
            if (typeof window.requestIdleCallback === 'function') {
              window.requestIdleCallback(() => prefetchManga(mangaId), { timeout: 2000 });
            } else {
              setTimeout(() => prefetchManga(mangaId), 300);
            }
          }
        }
      });
    }, {
      rootMargin: '200px 0px 200px 0px',
      threshold: 0.1
    });
  }
  return cardViewportObserver;
}

/**
 * Attach hover, pointerover, touchstart, and viewport prefetching to a card element
 */
export function attachMangaCardHoverPrefetch(cardEl, mangaId, mangaData = null) {
  if (!cardEl || !mangaId) return;
  cardEl.dataset.mangaId = mangaId;

  const triggerPrefetch = () => {
    prefetchManga(mangaId, mangaData);
  };

  // High-priority user intent triggers
  cardEl.addEventListener('pointerenter', triggerPrefetch, { passive: true, once: true });
  cardEl.addEventListener('mouseenter', triggerPrefetch, { passive: true, once: true });
  cardEl.addEventListener('touchstart', triggerPrefetch, { passive: true, once: true });

  // Viewport idle observer (especially beneficial on mobile / touchscreens)
  const obs = getCardViewportObserver();
  if (obs) {
    obs.observe(cardEl);
  }
}
