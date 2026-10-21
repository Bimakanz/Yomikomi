/**
 * Multi-Source Manga & Anime Data Service Layer
 * Public API Entry Point
 */

// Export Unified Types
export * from './types/manga.js';
export * from './types/anime.js';

// Export Base Provider for Adapter Pattern
export * from './providers/base.provider.js';

// Export Concrete Manga Providers
export * from './providers/mangadex.provider.js';
export * from './providers/local-indo.provider.js';
export * from './providers/komiku.provider.js';
export * from './providers/consumet.provider.js';

// Export Anime Providers
export * from './providers/anime-global.provider.js';
export * from './providers/anime-indo.provider.js';

// Export Metadata Enrichers & Services
export * from './enrichers/anilist.enricher.js';
export { fetchAniList, cleanSearchTitle } from './services/anilist.js';

// Export Aggregator Services
export * from './services/manga-aggregator.service.js';
export * from './services/anime-aggregator.service.js';
export * from './services/anizip.service.js';

// Export Image Proxy & Cache Utilities
export * from './utils/image-proxy.js';
export * from './utils/proxy-handler.js';
export * from './utils/cache.js';

