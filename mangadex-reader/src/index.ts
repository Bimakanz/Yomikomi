/**
 * Multi-Source Manga & Manhwa Data Service Layer
 * Public API Entry Point
 */

// Export Unified Types
export * from './types/manga.js';

// Export Base Provider for Adapter Pattern
export * from './providers/base.provider.js';

// Export Concrete Providers
export * from './providers/mangadex.provider.js';
export * from './providers/local-indo.provider.js';
export * from './providers/consumet.provider.js';

// Export Metadata Enrichers
export * from './enrichers/anilist.enricher.js';

// Export Aggregator Service
export * from './services/manga-aggregator.service.js';

// Export Image Proxy & Cache Utilities
export * from './utils/image-proxy.js';
export * from './utils/proxy-handler.js';
export * from './utils/cache.js';
