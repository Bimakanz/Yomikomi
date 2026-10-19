/**
 * Yomikomi State Management & Global Constants
 * Centralized reactive store and utility helpers
 */

// Global Reactive State
export const state = {
  currentView: 'home',
  previousView: 'home',
  currentMangaId: null,
  currentManga: null,
  currentChapters: [],
  currentChapterId: null,
  currentChapterIndex: 0,
  currentChapterData: null,
  currentPageIndex: 0,
  readerMode: 'auto', // 'auto', 'long-strip', 'single', 'double'
  readerQuality: localStorage.getItem('yomikomi_reader_quality') || 'data-saver', // 'data-saver' or 'original'
  popularManga: [],
  filteredManga: [],
  mangaList: [],
  heroManga: [],
  exploreData: null,
  currentFilter: 'all',
  currentGenre: 'all',
  searchQuery: '',
  heroIndex: 0,
  heroTimer: null,
  heroSlides: [],
  activeHeroIndex: 0,
  heroSlideInterval: null,
  isExternal: false,
  externalSource: null, // 'bacakomik' or 'english'
  externalChapters: [],
  currentExternalManga: null,
  currentCollectionTab: 'bookmarks', // 'bookmarks' or 'history'
  activeObjectUrls: [],
  bookmarkSet: new Set(),
  activeDetailSource: 'mangadex',
  activeDetailLang: 'all',
  activeDetailSort: 'asc'
};

// Storage Constants
export const STORAGE_KEY_BOOKMARKS = 'mangadex_reader_bookmarks';
export const STORAGE_KEY_HISTORY = 'mangadex_reader_history';
export const STORAGE_KEY_COVER_CACHE = 'yomikomi_cover_cache';
export const STORAGE_KEY_QUALITY = 'yomikomi_reader_quality';

// Genres Catalog
export const MANGADEX_GENRES = [
  { id: '391b0423-d847-456f-aff0-8b0cfc03066b', name: 'Action', desc: 'Aksi, pertarungan seru, dan adrenalin tinggi', icon: 'zap' },
  { id: '87cc87cd-a395-47af-b27a-93258283bbc6', name: 'Adventure', desc: 'Petualangan melintasi dunia baru', icon: 'compass' },
  { id: '4d32cc48-9f00-4cca-9b5a-a839f0764984', name: 'Comedy', desc: 'Kocak, lucu, dan penuh gelak tawa', icon: 'smile' },
  { id: 'b9af3a63-f058-46de-a9a0-e0c13906197a', name: 'Drama', desc: 'Cerita emosional yang menyentuh hati', icon: 'film' },
  { id: 'cdc58593-87dd-415e-bbc0-2ec27bf404cc', name: 'Fantasy', desc: 'Dunia sihir, monster, dan misteri magis', icon: 'wand' },
  { id: '423e2eae-a7a2-4a8b-ac03-a8351462d71d', name: 'Romance', desc: 'Kisah cinta manis dan penuh perasaan', icon: 'heart' },
  { id: 'ee9634b1-638e-4a35-ba42-382d561a45fb', name: 'Mystery', desc: 'Teka-teki, detektif, dan kasus rumit', icon: 'search' },
  { id: '3b60b75c-a2d7-4860-ab56-05f391bb889c', name: 'Psychological', desc: 'Permainan pikiran dan konflik batin', icon: 'brain' },
  { id: 'cdad7e68-dd9c-48b0-a548-c30c88be2ef4', name: 'Sci-Fi', desc: 'Fiksi ilmiah masa depan dan teknologi maju', icon: 'cpu' },
  { id: 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9', name: 'Slice of Life', desc: 'Kisah kehidupan sehari-hari yang santai', icon: 'coffee' },
  { id: '69964a6f-2ee0-472a-ab93-bb9eb5c48c48', name: 'Sports', desc: 'Kompetisi olahraga penuh semangat juang', icon: 'trophy' },
  { id: 'e64febcc-a9a1-4d03-816c-1b6330071a88', name: 'Superhero', desc: 'Pahlawan super pembela kebenaran', icon: 'shield' },
  { id: '07064557-a429-4ab2-9f69-72c0f3215a74', name: 'Thriller', desc: 'Ketegangan yang memacu detak jantung', icon: 'flame' },
  { id: '81c836c9-d2d4-477a-a3b4-253ae7e03d6d', name: 'Post-Apocalyptic', desc: 'Bertahan hidup setelah kehancuran dunia', icon: 'skull' },
  { id: 'ace04997-f6bd-436e-b261-779182193d3d', name: 'Isekai', desc: 'Terlempar dan terlahir kembali di dunia lain', icon: 'sparkles' },
  { id: '891cf039-b895-47f0-9229-bef4c96eccd4', name: 'Self-Published', desc: 'Komik web dan rilisan independen', icon: 'feather' }
];

export const MANGADEX_POPULAR_THEMES = [
  { id: 'eabc5b4c-6aff-42f3-b657-3e90cbd00b75', name: 'Supernatural', icon: 'flame' },
  { id: '799c202e-7daa-44eb-9cf7-8a3c0441531e', name: 'Martial Arts', icon: 'swords' },
  { id: 'caaa44eb-cd40-4177-b930-79d3ef2afe87', name: 'School Life', icon: 'graduation-cap' },
  { id: '0bc90acb-ccc1-44ca-a34a-b9f3a73259d0', name: 'Reincarnation', icon: 'refresh-ccw' },
  { id: 'aafb99c1-7f60-43fa-b75f-fc9502ce29c7', name: 'Harem', icon: 'users' },
  { id: '5fff9cde-849c-4d78-aab0-0d52b2ee1d25', name: 'Survival', icon: 'life-buoy' },
  { id: '292e862b-2d17-4062-90a2-0356caa4ae27', name: 'Time Travel', icon: 'clock' },
  { id: '36fd93ea-e8b8-445e-b836-358f02b3d33d', name: 'Monsters', icon: 'target' },
  { id: '39730448-9a5f-48a2-85b0-a70db87b1233', name: 'Demons', icon: 'skull' },
  { id: '9438db5a-7e2a-4ac0-b39e-e0d95a34b8a8', name: 'Video Games', icon: 'gamepad-2' },
  { id: '9467335a-1b83-4497-9231-765337a00b96', name: 'Post-Apocalyptic', icon: 'radioactive' },
  { id: 'a1f53773-c69a-4ce5-8cab-fffcd90b1565', name: 'Magic', icon: 'sparkles' },
  { id: 'ac72833b-c4e9-4878-b9db-6c8a4a99444a', name: 'Military', icon: 'crosshair' },
  { id: 'd14322ac-4d6f-4e9b-afd9-629d5f4d8a41', name: 'Villainess', icon: 'crown' },
  { id: 'd7d1730f-6eb0-4ba6-9437-602cac38664c', name: 'Vampires', icon: 'moon' },
  { id: 'e64f6742-c834-471d-8d72-dd51fc02b835', name: 'Aliens', icon: 'radar' },
  { id: 'ea2bc92d-1c26-4930-9b7c-d5c0dc1b6869', name: 'Cooking', icon: 'utensils' },
  { id: 'f42fbf9e-188a-447b-9fdc-f19dc1e4d685', name: 'Music', icon: 'music' },
  { id: 'da2d50ca-3018-4cc0-ac7a-6b7d472a29ea', name: 'Delinquents', icon: 'frown' },
  { id: '631ef465-9aba-4afb-b0fc-ea10efe274a8', name: 'Zombies', icon: 'biohazard' }
];


// Persistent Cover Cache
export const CoverCache = {
  get(mangaId) {
    if (!mangaId) return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_COVER_CACHE);
      if (!raw) return null;
      const map = JSON.parse(raw);
      return map[mangaId] || null;
    } catch (e) {
      return null;
    }
  },
  set(mangaId, title, coverUrl) {
    if (!mangaId || !coverUrl) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_COVER_CACHE);
      const map = raw ? JSON.parse(raw) : {};
      map[mangaId] = {
        title: title || 'Manga',
        coverUrl,
        updatedAt: Date.now()
      };
      // Keep map size bounded to last 300 entries
      const keys = Object.keys(map);
      if (keys.length > 300) {
        keys.slice(0, keys.length - 300).forEach(k => delete map[k]);
      }
      localStorage.setItem(STORAGE_KEY_COVER_CACHE, JSON.stringify(map));
    } catch (e) {}
  }
};

// UI Icon Initializer Helper
export function initIcons() {
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}

// Global Toast Notification
export function showToast(message, duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Memory Cleanup for Object URLs
export function revokeActiveObjectUrls() {
  if (state.activeObjectUrls && state.activeObjectUrls.length > 0) {
    state.activeObjectUrls.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (e) {}
    });
    state.activeObjectUrls = [];
  }
}

// Helper: Extract Title from attributes
export function getMangaTitle(attributes) {
  if (!attributes || !attributes.title) return 'Judul Tidak Tersedia';
  const t = attributes.title;
  if (t.en) return t.en;
  if (t.id) return t.id;
  if (t['ja-ro']) return t['ja-ro'];
  if (t.ja) return t.ja;
  const values = Object.values(t);
  if (values.length > 0 && values[0]) return values[0];
  if (attributes.altTitles && Array.isArray(attributes.altTitles)) {
    for (const alt of attributes.altTitles) {
      if (alt.en) return alt.en;
      if (alt.id) return alt.id;
      const altVals = Object.values(alt);
      if (altVals.length > 0 && altVals[0]) return altVals[0];
    }
  }
  return 'Judul Tidak Tersedia';
}

// Helper: Extract Cover Art URL with Disk Cache & Proxy fallback
export function getCoverUrl(manga) {
  if (!manga) return 'https://placehold.co/300x420/1e2025/ffffff?text=No+Cover';
  if (manga.coverUrl) return manga.coverUrl;
  const coverRel = manga.relationships?.find(r => r.type === 'cover_art');
  if (coverRel?.attributes?.fileName) {
    return `/api/cover/${manga.id}/${coverRel.attributes.fileName}`;
  }
  const cached = CoverCache.get(manga.id);
  if (cached?.coverUrl) return cached.coverUrl;
  return 'https://placehold.co/300x420/1e2025/ffffff?text=No+Cover';
}

// Language Flag Helper
export function getLanguageFlag(langCode) {
  if (!langCode) return '🇯🇵';
  const flags = {
    ja: '🇯🇵',
    ko: '🇰🇷',
    zh: '🇨🇳',
    'zh-hk': '🇭🇰',
    en: '🇬🇧',
    id: '🇮🇩',
    fr: '🇫🇷',
    es: '🇪🇸'
  };
  return flags[langCode.toLowerCase()] || '🌐';
}

// Title normalization for fuzzy matching
export function normalizeTitle(t) {
  if (!t || typeof t !== 'string') return '';
  return t
    .toLowerCase()
    .replace(/[\[\(][^\]\)]*[\]\)]/g, ' ')
    .replace(/chapter|bahasa indonesia|komikindo|komiku|bacakomik|mangadex|season \d+|ch\.?\s*\d+/gi, ' ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// LocalStorage List Helpers
export function getStoredList(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveStoredList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (e) {}
}

// Export to window for backward compatibility with templates
if (typeof window !== 'undefined') {
  window.YomikomiState = state;
  window.showToast = showToast;
  window.initIcons = initIcons;
  window.CoverCache = CoverCache;
}
