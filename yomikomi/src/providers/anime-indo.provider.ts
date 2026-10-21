import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnimeStreamServer } from '../types/anime.js';
import { globalCache } from '../utils/cache.js';

/**
 * Anime Indo Provider
 * Scrapes and aggregates Indonesian Subtitled anime streaming links from Otakudesu / Samehadaku mirrors
 */
export class AnimeIndoProvider {
  readonly source = 'anime-indo';
  readonly displayName = 'Anime Sub Indo';
  readonly baseUrl = process.env.OTAKUDESU_BASE_URL?.trim() || 'https://otakudesu.best';
  protected readonly timeoutMs = 7000;

  /**
   * Search anime by title
   */
  async search(query: string): Promise<Array<{ title: string; slug: string; thumb: string; status: string }>> {
    if (!query || !query.trim()) return [];
    const cacheKey = `indo_anime_search_${query.toLowerCase().trim()}`;
    const cached = globalCache.get<any>(cacheKey);
    if (cached) return cached;

    try {
      const searchUrl = `${this.baseUrl}/?s=${encodeURIComponent(query)}&post_type=anime`;
      const res = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': this.baseUrl
        },
        timeout: this.timeoutMs
      });

      const $ = cheerio.load(res.data);
      const results: Array<{ title: string; slug: string; thumb: string; status: string }> = [];

      $('.chivsrc li').each((_, el) => {
        const titleEl = $(el).find('h2 a');
        const title = titleEl.text().trim();
        const href = titleEl.attr('href') || '';
        const thumb = $(el).find('img').attr('src') || '';
        const status = $(el).find('.set:contains("Status")').text().replace('Status :', '').trim();

        const slugMatch = href.match(/\/anime\/([^/]+)/);
        const slug = slugMatch ? slugMatch[1] : '';

        if (title && slug) {
          results.push({ title, slug, thumb, status: status || 'Unknown' });
        }
      });

      globalCache.set(cacheKey, results, 30 * 60 * 1000);
      return results;
    } catch (err) {
      console.warn('[AnimeIndoProvider] Search failed:', (err as any).message);
      return [];
    }
  }

  /**
   * Get episode streaming servers for anime title and episode number
   */
  async getEpisodeStreams(animeTitle: string, episodeNumber: number): Promise<AnimeStreamServer[]> {
    const cleanTitle = animeTitle
      .replace(/\(tv\)/i, '')
      .replace(/season\s*\d+/i, '')
      .replace(/s\d+/i, '')
      .replace(/:\s*[^:]+$/, '')
      .trim();

    const cacheKey = `indo_streams_${cleanTitle}_ep${episodeNumber}`;
    const cached = globalCache.get<AnimeStreamServer[]>(cacheKey);
    if (cached) return cached;

    const servers: AnimeStreamServer[] = [];

    try {
      const searchResults = await this.search(cleanTitle);
      if (searchResults.length > 0) {
        const animeSlug = searchResults[0].slug;
        const animePageUrl = `${this.baseUrl}/anime/${animeSlug}`;

        const pageRes = await axios.get(animePageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': this.baseUrl
          },
          timeout: this.timeoutMs
        });

        const $ = cheerio.load(pageRes.data);
        let targetEpUrl = '';

        $('.episodelist ul li a').each((_, el) => {
          const epText = $(el).text().trim();
          const epHref = $(el).attr('href') || '';
          if (epText.toLowerCase().includes('pembatas') || epHref.includes('batch')) return;
          // Avoid matching ranges like "Episode 001 – 025"
          if (epText.includes('–') || (epText.includes('-') && !epHref.includes('episode-'))) return;

          const numRegex = new RegExp(`\\bepisode\\s*0*${episodeNumber}\\b`, 'i');
          const hrefRegex = new RegExp(`episode-0*${episodeNumber}-`, 'i');

          if (numRegex.test(epText) || hrefRegex.test(epHref)) {
            targetEpUrl = epHref;
            return false;
          }
        });

        if (targetEpUrl) {
          const epRes = await axios.get(targetEpUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': animePageUrl
            },
            timeout: this.timeoutMs
          });

          const $ep = cheerio.load(epRes.data);
          const defaultIframe = $ep('#lightsVideo iframe, .responsive-embed iframe, iframe').attr('src');
          if (defaultIframe) {
            servers.push({
              id: 'indo-desu-main',
              name: 'Server Sub Indo (DesuStream HD)',
              type: 'iframe',
              url: `/api/proxy/stream?url=${encodeURIComponent(defaultIframe)}`,
              quality: '720p',
              isSubIndo: true
            });
          }
        }
      }
    } catch (e) {
      console.warn('[AnimeIndoProvider] Otakudesu failed, trying Samehadaku:', (e as any).message);
    }

    // Try Samehadaku Scraper if Otakudesu yielded no servers
    if (servers.length === 0) {
      try {
        const sRes = await axios.get(`https://samehadaku.care/?s=${encodeURIComponent(cleanTitle)}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: this.timeoutMs
        });
        const $s = cheerio.load(sRes.data);
        const firstLink = $s('.animpost .animepost a').first().attr('href') || $s('article a').first().attr('href');
        if (firstLink) {
          const detailRes = await axios.get(firstLink, { timeout: this.timeoutMs });
          const $d = cheerio.load(detailRes.data);
          let targetEpLink = '';
          $d('.lastep ul li a, .episodelist ul li a').each((_, el) => {
            const txt = $d(el).text();
            if (txt.includes(`Episode ${episodeNumber}`) || txt.includes(`Ep ${episodeNumber}`)) {
              targetEpLink = $d(el).attr('href') || '';
              return false;
            }
          });

          if (targetEpLink) {
            const streamPage = await axios.get(targetEpLink, { timeout: this.timeoutMs });
            const $p = cheerio.load(streamPage.data);
            const embedSrc = $p('#player-area iframe, .video-content iframe').attr('src');
            if (embedSrc) {
              servers.push({
                id: 'samehadaku-main',
                name: 'Server Sub Indo (Samehadaku HD)',
                type: 'iframe',
                url: `/api/proxy/stream?url=${encodeURIComponent(embedSrc)}`,
                quality: '1080p',
                isSubIndo: true
              });
            }
          }
        }
      } catch (sErr) {
        console.warn('[AnimeIndoProvider] Samehadaku fallback failed:', (sErr as any).message);
      }
    }

    globalCache.set(cacheKey, servers, 2 * 60 * 60 * 1000);
    return servers;
  }
}

export const animeIndoProvider = new AnimeIndoProvider();
