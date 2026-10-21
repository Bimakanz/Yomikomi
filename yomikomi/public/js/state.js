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
  readerModePreference: localStorage.getItem('yomikomi_reader_mode_pref') || 'auto', // 'auto', 'long-strip', 'single', 'double'
  readerMode: 'long-strip', // active effective mode ('long-strip', 'single', 'double')
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
  activeDetailLang: 'id', // 'id' or 'en'
  activeDetailSort: 'asc', // 'asc' or 'desc'
  unifiedChapters: { id: [], en: [] },
  activeChapters: [],
  // Dual-Mode Media State (Manga / Anime)
  activeMediaMode: localStorage.getItem('yomikomi_active_media_mode') || 'manga', // 'manga' or 'anime'
  popularAnime: [],
  seasonalAnime: [],
  latestAnime: [],
  movieAnime: [],
  animeList: [],
  currentAnime: null,
  currentAnimeEpisode: 1,
  currentAnimeServer: 1,
  animeHistory: []
};

// Storage Constants
export const STORAGE_KEY_BOOKMARKS = 'mangadex_reader_bookmarks';
export const STORAGE_KEY_HISTORY = 'mangadex_reader_history';
export const STORAGE_KEY_COVER_CACHE = 'yomikomi_cover_cache';
export const STORAGE_KEY_QUALITY = 'yomikomi_reader_quality';
export const STORAGE_KEY_ACTIVE_MEDIA_MODE = 'yomikomi_active_media_mode';
export const STORAGE_KEY_ANIME_HISTORY = 'yomikomi_anime_history';

// Genres Catalog
export const MANGADEX_GENRES = [
  {
    "id": "391b0423-d847-456f-aff0-8b0cfc03066b",
    "name": "Action",
    "icon": "zap"
  },
  {
    "id": "87cc87cd-a395-47af-b27a-93258283bbc6",
    "name": "Adventure",
    "icon": "compass"
  },
  {
    "id": "5920b825-4181-4a17-beeb-9918b0ff7a30",
    "name": "Boys' Love",
    "icon": "heart-handshake"
  },
  {
    "id": "4d32cc48-9f00-4cca-9b5a-a839f0764984",
    "name": "Comedy",
    "icon": "smile"
  },
  {
    "id": "5ca48985-9a9d-4bd8-be29-80dc0303db72",
    "name": "Crime",
    "icon": "shield-alert"
  },
  {
    "id": "b9af3a63-f058-46de-a9a0-e0c13906197a",
    "name": "Drama",
    "icon": "film"
  },
  {
    "id": "erotica",
    "name": "Erotica / Ecchi",
    "icon": "sparkles"
  },
  {
    "id": "cdc58593-87dd-415e-bbc0-2ec27bf404cc",
    "name": "Fantasy",
    "icon": "wand-2"
  },
  {
    "id": "a3c67850-4684-404e-9b7f-c69850ee5da6",
    "name": "Girls' Love",
    "icon": "heart"
  },
  {
    "id": "hentai",
    "name": "Hentai (18+)",
    "icon": "flame"
  },
  {
    "id": "33771934-028e-4cb3-8744-691e866a923e",
    "name": "Historical",
    "icon": "landmark"
  },
  {
    "id": "cdad7e68-1419-41dd-bdce-27753074a640",
    "name": "Horror",
    "icon": "skull"
  },
  {
    "id": "ace04997-f6bd-436e-b261-779182193d3d",
    "name": "Isekai",
    "icon": "sparkles"
  },
  {
    "id": "81c836c9-914a-4eca-981a-560dad663e73",
    "name": "Magical Girls",
    "icon": "star"
  },
  {
    "id": "50880a9d-5440-4732-9afb-8f457127e836",
    "name": "Mecha",
    "icon": "bot"
  },
  {
    "id": "c8cbe35b-1b2b-4a3f-9c37-db84c4514856",
    "name": "Medical",
    "icon": "stethoscope"
  },
  {
    "id": "ee968100-4191-4968-93d3-f82d72be7e46",
    "name": "Mystery",
    "icon": "search"
  },
  {
    "id": "b1e97889-25b4-4258-b28b-cd7f4d28ea9b",
    "name": "Philosophical",
    "icon": "lightbulb"
  },
  {
    "id": "3b60b75c-a2d7-4860-ab56-05f391bb889c",
    "name": "Psychological",
    "icon": "brain"
  },
  {
    "id": "423e2eae-a7a2-4a8b-ac03-a8351462d71d",
    "name": "Romance",
    "icon": "heart"
  },
  {
    "id": "256c8bd9-4904-4360-bf4f-508a76d67183",
    "name": "Sci-Fi",
    "icon": "cpu"
  },
  {
    "id": "e5301a23-ebd9-49dd-a0cb-2add944c7fe9",
    "name": "Slice of Life",
    "icon": "coffee"
  },
  {
    "id": "69964a64-2f90-4d33-beeb-f3ed2875eb4c",
    "name": "Sports",
    "icon": "trophy"
  },
  {
    "id": "7064a261-a137-4d3a-8848-2d385de3a99c",
    "name": "Superhero",
    "icon": "shield"
  },
  {
    "id": "07251805-a27e-4d59-b488-f0bfbec15168",
    "name": "Thriller",
    "icon": "flame"
  },
  {
    "id": "f8f62932-27da-4fe4-8ee1-6779a8c5edba",
    "name": "Tragedy",
    "icon": "cloud-rain"
  },
  {
    "id": "acc803a4-c95a-4c22-86fc-eb6b582d82a2",
    "name": "Wuxia",
    "icon": "swords"
  }
];

// Themes Catalog
export const MANGADEX_POPULAR_THEMES = [
  {
    "id": "e64f6742-c834-471d-8d72-dd51fc02b835",
    "name": "Aliens",
    "icon": "radar"
  },
  {
    "id": "3de8c75d-8ee3-48ff-98ee-e20a65c86451",
    "name": "Animals",
    "icon": "paw-print"
  },
  {
    "id": "ea2bc92d-1c26-4930-9b7c-d5c0dc1b6869",
    "name": "Cooking",
    "icon": "utensils"
  },
  {
    "id": "9ab53f92-3eed-4e9b-903a-917c86035ee3",
    "name": "Crossdressing",
    "icon": "shirt"
  },
  {
    "id": "da2d50ca-3018-4cc0-ac7a-6b7d472a29ea",
    "name": "Delinquents",
    "icon": "frown"
  },
  {
    "id": "39730448-9a5f-48a2-85b0-a70db87b1233",
    "name": "Demons",
    "icon": "skull"
  },
  {
    "id": "2bd2e8d0-f146-434a-9b51-fc9ff2c5fe6a",
    "name": "Genderswap",
    "icon": "refresh-cw"
  },
  {
    "id": "3bb26d85-09d5-4d2e-880c-c34b974339e9",
    "name": "Ghosts",
    "icon": "ghost"
  },
  {
    "id": "fad12b5e-68ba-460e-b933-9ae8318f5b65",
    "name": "Gyaru",
    "icon": "sparkles"
  },
  {
    "id": "aafb99c1-7f60-43fa-b75f-fc9502ce29c7",
    "name": "Harem",
    "icon": "users"
  },
  {
    "id": "5bd0e105-4481-44ca-b6e7-7544da56b1a3",
    "name": "Incest",
    "icon": "alert-circle"
  },
  {
    "id": "2d1f5d56-a1e5-4d0d-a961-2193588b08ec",
    "name": "Loli",
    "icon": "smile"
  },
  {
    "id": "85daba54-a71c-4554-8a28-9901a8b0afad",
    "name": "Mafia",
    "icon": "briefcase"
  },
  {
    "id": "a1f53773-c69a-4ce5-8cab-fffcd90b1565",
    "name": "Magic",
    "icon": "sparkles"
  },
  {
    "id": "cb562697-929f-4d28-9d66-6d3995bf2592",
    "name": "Mahjong",
    "icon": "tablets"
  },
  {
    "id": "799c202e-7daa-44eb-9cf7-8a3c0441531e",
    "name": "Martial Arts",
    "icon": "swords"
  },
  {
    "id": "ac72833b-c4e9-4878-b9db-6c8a4a99444a",
    "name": "Military",
    "icon": "crosshair"
  },
  {
    "id": "dd1f77c5-dea9-4e2b-97ae-224af09caf99",
    "name": "Monster Girls",
    "icon": "heart"
  },
  {
    "id": "36fd93ea-e8b8-445e-b836-358f02b3d33d",
    "name": "Monsters",
    "icon": "target"
  },
  {
    "id": "f42fbf9e-188a-447b-9fdc-f19dc1e4d685",
    "name": "Music",
    "icon": "music"
  },
  {
    "id": "489dd859-9b61-4c37-af75-5b18e88daafc",
    "name": "Ninja",
    "icon": "shield"
  },
  {
    "id": "92d6d951-ca5e-429c-ac78-451071cbf064",
    "name": "Office Workers",
    "icon": "building"
  },
  {
    "id": "df33b754-73a3-4c54-80e6-1a74a8058539",
    "name": "Police",
    "icon": "badge-check"
  },
  {
    "id": "9467335a-1b83-4497-9231-765337a00b96",
    "name": "Post-Apocalyptic",
    "icon": "radiation"
  },
  {
    "id": "0bc90acb-ccc1-44ca-a34a-b9f3a73259d0",
    "name": "Reincarnation",
    "icon": "refresh-ccw"
  },
  {
    "id": "65761a2a-415e-47f3-bef2-a9dababba7a6",
    "name": "Reverse Harem",
    "icon": "crown"
  },
  {
    "id": "81183756-1453-4c81-aa9e-f6e1b63be016",
    "name": "Samurai",
    "icon": "sword"
  },
  {
    "id": "caaa44eb-cd40-4177-b930-79d3ef2afe87",
    "name": "School Life",
    "icon": "graduation-cap"
  },
  {
    "id": "ddefd648-5140-4e5f-ba18-4eca4071d19b",
    "name": "Shota",
    "icon": "user"
  },
  {
    "id": "eabc5b4c-6aff-42f3-b657-3e90cbd00b75",
    "name": "Supernatural",
    "icon": "flame"
  },
  {
    "id": "5fff9cde-849c-4d78-aab0-0d52b2ee1d25",
    "name": "Survival",
    "icon": "life-buoy"
  },
  {
    "id": "292e862b-2d17-4062-90a2-0356caa4ae27",
    "name": "Time Travel",
    "icon": "clock"
  },
  {
    "id": "31932a7e-5b8e-49a6-9f12-2afa39dc544c",
    "name": "Traditional Games",
    "icon": "dice-5"
  },
  {
    "id": "d7d1730f-6eb0-4ba6-9437-602cac38664c",
    "name": "Vampires",
    "icon": "moon"
  },
  {
    "id": "9438db5a-7e2a-4ac0-b39e-e0d95a34b8a8",
    "name": "Video Games",
    "icon": "gamepad-2"
  },
  {
    "id": "d14322ac-4d6f-4e9b-afd9-629d5f4d8a41",
    "name": "Villainess",
    "icon": "crown"
  },
  {
    "id": "8c86611e-fab7-4986-9dec-d1a2f44acdd5",
    "name": "Virtual Reality",
    "icon": "glasses"
  },
  {
    "id": "631ef465-9aba-4afb-b0fc-ea10efe274a8",
    "name": "Zombies",
    "icon": "biohazard"
  }
];

// Formats Catalog
export const MANGADEX_FORMATS = [
  {
    "id": "b11fda93-8f1d-4bef-b2ed-8803d3733170",
    "name": "4-Koma",
    "icon": "grid"
  },
  {
    "id": "f4122d1c-3b44-44d0-9936-ff7502c39ad3",
    "name": "Adaptation",
    "icon": "book-open"
  },
  {
    "id": "51d83883-4103-437c-b4b1-731cb73d786c",
    "name": "Anthology",
    "icon": "layers"
  },
  {
    "id": "0a39b5a1-b235-4886-a747-1d05d216532d",
    "name": "Award Winning",
    "icon": "award"
  },
  {
    "id": "b13b2a48-c720-44a9-9c77-39c9979373fb",
    "name": "Doujinshi",
    "icon": "book-marked"
  },
  {
    "id": "7b2ce280-79ef-4c09-9b58-12b7c23a9b78",
    "name": "Fan Colored",
    "icon": "palette"
  },
  {
    "id": "f5ba408b-0e7a-484d-8d49-4e9125ac96de",
    "name": "Full Color",
    "icon": "palette"
  },
  {
    "id": "3e2b8dae-350e-4ab8-a8ce-016e844b9f0d",
    "name": "Long Strip",
    "icon": "scroll"
  },
  {
    "id": "320831a8-4026-470b-94f6-8353740e6f04",
    "name": "Official Colored",
    "icon": "check-circle-2"
  },
  {
    "id": "0234a31e-a729-4e28-9d6a-3f87c4966b9e",
    "name": "Oneshot",
    "icon": "file-text"
  },
  {
    "id": "891cf039-b895-47f0-9229-bef4c96eccd4",
    "name": "Self-Published",
    "icon": "feather"
  },
  {
    "id": "e197df38-d0e7-43b5-9b09-2842d0c326dd",
    "name": "Web Comic",
    "icon": "globe"
  }
];

// Content Warnings
export const MANGADEX_CONTENT_WARNINGS = [
  {
    "id": "b29d6a3d-1569-4e7a-8caf-7557bc92cd5d",
    "name": "Gore",
    "icon": "alert-triangle"
  },
  {
    "id": "97893a4c-12af-4dac-b6be-0dffb353568e",
    "name": "Sexual Violence",
    "icon": "alert-octagon"
  }
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

// Global Toast Notification (Disabled per user request)
export function showToast(message, duration = 3000) {
  // All toast popup notifications disabled per user preference
  return;
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
    const fn = coverRel.attributes.fileName;
    const thumbFn = (fn.endsWith('.256.jpg') || fn.endsWith('.512.jpg')) ? fn : `${fn}.512.jpg`;
    return `/api/cover/${manga.id}/${thumbFn}`;
  }
  const cached = CoverCache.get(manga.id);
  if (cached?.coverUrl) return cached.coverUrl;
  return 'https://placehold.co/300x420/1e2025/ffffff?text=No+Cover';
}

// Language Flag Helper
export function getLanguageFlag(langCode) {
  if (!langCode) return 'JP';
  const codes = {
    ja: 'JP',
    ko: 'KR',
    zh: 'CN',
    'zh-hk': 'HK',
    en: 'EN',
    id: 'ID',
    fr: 'FR',
    es: 'ES'
  };
  return codes[langCode.toLowerCase()] || (langCode.length <= 3 ? langCode.toUpperCase() : 'RAW');
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

// Anime History Storage Helpers
export function getAnimeHistory() {
  const raw = getStoredList(STORAGE_KEY_ANIME_HISTORY);
  return raw.map(item => {
    let cleanTitle = 'Anime';
    if (typeof item.title === 'string' && item.title !== '[object Object]') {
      cleanTitle = item.title;
    } else if (typeof item.title === 'object' && item.title !== null) {
      cleanTitle = item.title.romaji || item.title.english || item.title.native || 'Anime';
    } else if (item.titleObj) {
      cleanTitle = item.titleObj.romaji || item.titleObj.english || item.titleObj.native || 'Anime';
    }
    const cleanCover = item.coverUrl || item.coverImage?.extraLarge || item.coverImage?.large || '';
    return {
      ...item,
      title: cleanTitle,
      coverUrl: cleanCover
    };
  });
}

export function saveAnimeHistory(record) {
  if (!record || !record.animeId) return;
  const list = getAnimeHistory();
  const existingIndex = list.findIndex(item => String(item.animeId) === String(record.animeId));
  
  let resolvedTitle = 'Anime';
  if (typeof record.title === 'string' && record.title !== '[object Object]') {
    resolvedTitle = record.title;
  } else if (typeof record.title === 'object' && record.title !== null) {
    resolvedTitle = record.title.romaji || record.title.english || record.title.native || 'Anime';
  } else if (record.titleObj) {
    resolvedTitle = record.titleObj.romaji || record.titleObj.english || record.titleObj.native || 'Anime';
  }

  const resolvedCover = record.coverUrl || record.coverImage?.extraLarge || record.coverImage?.large || '';

  const newEntry = {
    animeId: record.animeId,
    title: resolvedTitle,
    coverUrl: resolvedCover,
    episode: record.episode || 1,
    episodeTitle: record.episodeTitle || `Episode ${record.episode || 1}`,
    totalEpisodes: record.totalEpisodes || null,
    progress: record.progress || '100%',
    timestamp: Date.now()
  };

  if (existingIndex !== -1) {
    list.splice(existingIndex, 1);
  }
  list.unshift(newEntry);
  if (list.length > 100) list.pop();
  saveStoredList(STORAGE_KEY_ANIME_HISTORY, list);
}

export function clearAnimeHistory() {
  saveStoredList(STORAGE_KEY_ANIME_HISTORY, []);
}

// Global Media Mode Setter
export function setMediaMode(mode) {
  if (mode !== 'manga' && mode !== 'anime') return;
  state.activeMediaMode = mode;
  try {
    localStorage.setItem(STORAGE_KEY_ACTIVE_MEDIA_MODE, mode);
  } catch (e) {}
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme-mode', mode);
    if (document.body) document.body.setAttribute('data-theme-mode', mode);
  }

  // Update all switcher buttons across navbar & drawer
  document.querySelectorAll('.mode-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Dispatch global custom event for dynamic components
  window.dispatchEvent(new CustomEvent('yomikomi:mediamode', { detail: { mode } }));
}

// Initial theme mode attribute setup
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme-mode', state.activeMediaMode);
  if (document.body) document.body.setAttribute('data-theme-mode', state.activeMediaMode);
}

// Export to window for backward compatibility with templates
if (typeof window !== 'undefined') {
  window.YomikomiState = state;
  window.showToast = showToast;
  window.initIcons = initIcons;
  window.CoverCache = CoverCache;
  window.setMediaMode = setMediaMode;
  window.getAnimeHistory = getAnimeHistory;
  window.saveAnimeHistory = saveAnimeHistory;
}

