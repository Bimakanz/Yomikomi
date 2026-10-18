/**
 * Image Proxy & Anti-403 Hotlink Bypass Utilities
 * 
 * 1. Primary Priority (Bandwidth Saver): wsrv.nl (global image cache & CDN)
 *    Converts any source image into compressed WebP (q=85) on the fly, saving serverless bandwidth.
 * 2. Secondary Fallback: Internal `/api/proxy/image`
 *    Used when upstream hosts enforce strict IP-based or Referer-based anti-hotlinking.
 */

export interface ProxyOptions {
  /** Target image quality (default: 85) */
  quality?: number;
  /** Force output format (default: 'webp') */
  format?: 'webp' | 'jpg' | 'png' | 'avif';
  /** Custom Referer header to bypass 403 Forbidden */
  referer?: string;
  /** Whether to bypass external CDN and use internal serverless proxy directly */
  useInternalFallback?: boolean;
}

/**
 * Constructs an optimized, CDN-cached, WebP-compressed image URL.
 * 
 * @param originalUrl Direct URL of the image
 * @param referer Optional HTTP Referer for anti-hotlink protection
 * @param options Additional compression options
 */
export function getProxiedImageUrl(
  originalUrl: string,
  referer?: string,
  options: ProxyOptions = {}
): string {
  if (!originalUrl || typeof originalUrl !== 'string') {
    return '';
  }

  const cleanUrl = originalUrl.trim();

  // If already proxied, do not double-wrap
  if (cleanUrl.startsWith('https://wsrv.nl/') || cleanUrl.includes('/api/proxy/image')) {
    return cleanUrl;
  }

  // If explicitly requested to use internal fallback proxy
  if (options.useInternalFallback) {
    return getInternalProxyUrl(cleanUrl, referer || options.referer);
  }

  // Primary: Use wsrv.nl for zero-cost serverless bandwidth offloading & WebP compression
  return getWsrvProxyUrl(cleanUrl, {
    quality: options.quality ?? 85,
    format: options.format ?? 'webp'
  });
}

/**
 * Builds the wsrv.nl proxy URL with automated WebP conversion
 */
export function getWsrvProxyUrl(
  originalUrl: string,
  options: { quality?: number; format?: string } = {}
): string {
  const q = options.quality ?? 85;
  const output = options.format ?? 'webp';
  return `https://wsrv.nl/?url=${encodeURIComponent(originalUrl)}&output=${output}&q=${q}`;
}

/**
 * Builds the internal serverless proxy URL with encoded Referer
 */
export function getInternalProxyUrl(originalUrl: string, referer?: string): string {
  const query = new URLSearchParams({
    url: originalUrl
  });

  if (referer) {
    query.set('referer', referer);
  }

  return `/api/proxy/image?${query.toString()}`;
}
