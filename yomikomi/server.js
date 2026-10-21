const express = require('express');
const https = require('https');
const http = require('http');
const dns = require('dns');
const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Explicit PWA routes with no-cache headers for sw.js
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=UTF-8');
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

app.use(express.static(path.join(__dirname, 'public')));

// Disk cache folder for cover images (safe for cloud environments)
const COVERS_CACHE_DIR = path.join(__dirname, 'public', 'cache', 'covers');
try {
  if (!fs.existsSync(COVERS_CACHE_DIR)) {
    fs.mkdirSync(COVERS_CACHE_DIR, { recursive: true });
  }
} catch (e) {
  // Read-only filesystem in some cloud environments (e.g. Vercel)
}

// In-memory cache for API responses
const cache = new Map();
const CACHE_TTL = {
  popular: 10 * 60 * 1000,    // 10 minutes
  latest: 5 * 60 * 1000,      // 5 minutes
  manga: 30 * 60 * 1000,     // 30 minutes
  chapters: 15 * 60 * 1000,   // 15 minutes
  atHome: 12 * 60 * 1000,    // 12 minutes
  search: 5 * 60 * 1000,     // 5 minutes
  external: 15 * 60 * 1000   // 15 minutes
};

function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data, ttlMs) {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
}

// Public DNS Resolver with 1.1.1.1 and 8.8.8.8 to bypass ISP DNS hijacking (Internet Positif)
const { Resolver } = require('dns');
const publicResolver = new Resolver();
try {
  publicResolver.setServers(['1.1.1.1', '8.8.8.8', '1.0.0.1']);
} catch (e) {}

// Anti-ISP DNS Hijack & DoH Resolution Engine
const MANGADEX_IPS = [
  { address: '45.129.229.1', family: 4 },
  { address: '45.129.229.2', family: 4 }
];
const CLOUDFLARE_MANGADEX_NETWORK_IPS = [
  { address: '104.26.3.73', family: 4 },
  { address: '172.67.73.44', family: 4 },
  { address: '104.26.2.73', family: 4 }
];
let ipCounter = 0;
const dohCache = new Map();

function isIspHijacked(ip) {
  if (!ip || typeof ip !== 'string') return false;
  return (
    ip.startsWith('36.86.') ||      // Telkom Internet Positif
    ip.startsWith('158.140.') ||    // Moratel / TrustPositif
    ip.startsWith('180.250.') ||    // Telkomsel
    ip.startsWith('118.98.') ||     // Kemdikbud / Telkom
    ip.startsWith('202.134.') ||    // Telkom DNS
    ip.startsWith('103.10.') ||     // TrustPositif redirect
    ip.startsWith('103.149.') ||    // FirstMedia block
    ip.startsWith('10.0.') ||
    ip.startsWith('127.') ||
    ip === '0.0.0.0'
  );
}

async function queryDoH(hostname) {
  if (dohCache.has(hostname)) {
    const item = dohCache.get(hostname);
    if (Date.now() < item.exp) return item.ips;
  }
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`, {
      signal: AbortSignal.timeout(2500)
    });
    const j = await res.json();
    const ips = (j.Answer || []).filter(a => a.type === 1).map(a => a.data).filter(ip => !isIspHijacked(ip));
    if (ips.length > 0) {
      dohCache.set(hostname, { ips, exp: Date.now() + 600000 });
      return ips;
    }
  } catch (e) {}

  try {
    const res2 = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(2500)
    });
    const j2 = await res2.json();
    const ips2 = (j2.Answer || []).filter(a => a.type === 1).map(a => a.data).filter(ip => !isIspHijacked(ip));
    if (ips2.length > 0) {
      dohCache.set(hostname, { ips: ips2, exp: Date.now() + 600000 });
      return ips2;
    }
  } catch (e2) {}

  return null;
}

function customLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const h = (hostname || '').toLowerCase();

  // On Vercel / serverless cloud, standard DNS resolution is fast, unpoisoned, and routed to nearest Anycast edge
  if (process.env.VERCEL) {
    return dns.lookup(hostname, options, callback);
  }

  // MangaDex official domains: bypass ISP DNS completely with static Anycast DDoS-Guard IPs
  if (h === 'api.mangadex.org' || h === 'uploads.mangadex.org' || h.endsWith('.mangadex.org')) {
    if (options && options.all) {
      return callback(null, MANGADEX_IPS);
    }
    const ip = MANGADEX_IPS[ipCounter++ % MANGADEX_IPS.length].address;
    return callback(null, ip, 4);
  }

  // MangaDex @Home volunteer nodes (*.mangadex.network): resolve via DoH or Cloudflare Anycast IPs
  if (h.endsWith('.mangadex.network')) {
    queryDoH(h).then(ips => {
      if (ips && ips.length > 0) {
        if (options && options.all) {
          return callback(null, ips.map(a => ({ address: a, family: 4 })));
        }
        return callback(null, ips[0], 4);
      }
      if (options && options.all) return callback(null, CLOUDFLARE_MANGADEX_NETWORK_IPS);
      return callback(null, CLOUDFLARE_MANGADEX_NETWORK_IPS[0].address, 4);
    }).catch(() => {
      if (options && options.all) return callback(null, CLOUDFLARE_MANGADEX_NETWORK_IPS);
      return callback(null, CLOUDFLARE_MANGADEX_NETWORK_IPS[0].address, 4);
    });
    return;
  }

  // Native system DNS lookup first
  dns.lookup(hostname, options, (err, address, family) => {
    let checkIp = '';
    if (Array.isArray(address) && address[0]) {
      checkIp = address[0].address || '';
    } else if (typeof address === 'string') {
      checkIp = address;
    }

    const hijacked = isIspHijacked(checkIp);

    if (err || hijacked) {
      // Fallback 1: Query DoH
      queryDoH(h).then(ips => {
        if (ips && ips.length > 0) {
          if (options && options.all) {
            return callback(null, ips.map(a => ({ address: a, family: 4 })));
          }
          return callback(null, ips[0], 4);
        }
        // Fallback 2: Public DNS Resolver (1.1.1.1 / 8.8.8.8)
        publicResolver.resolve4(hostname, (resErr, addresses) => {
          if (!resErr && addresses && addresses.length > 0) {
            const clean = addresses.filter(a => !isIspHijacked(a));
            if (clean.length > 0) {
              if (options && options.all) {
                return callback(null, clean.map(addr => ({ address: addr, family: 4 })));
              }
              return callback(null, clean[0], 4);
            }
          }
          callback(err || new Error(`DNS resolution failed or hijacked for ${hostname}`));
        });
      }).catch(() => {
        publicResolver.resolve4(hostname, (resErr, addresses) => {
          if (!resErr && addresses && addresses.length > 0) {
            if (options && options.all) {
              return callback(null, addresses.map(addr => ({ address: addr, family: 4 })));
            }
            return callback(null, addresses[0], 4);
          }
          callback(err || new Error(`DNS resolution failed for ${hostname}`));
        });
      });
      return;
    }

    callback(null, address, family);
  });
}

// Persistent HTTPS Agent with Keep-Alive to eliminate TLS handshake latency
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 30000,
  lookup: customLookup
});

// Helper for MangaDex API requests
function fetchMangaDex(pathStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathStr, 'https://api.mangadex.org');
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'GET',
      agent: httpsAgent,
      headers: {
        'User-Agent': 'MangaDexPersonalReader/1.0 (Personal Education Project)',
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse JSON response: ' + e.message));
          }
        } else {
          reject(new Error(`MangaDex API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

// ==========================================
// MANGADEX API ROUTES
// ==========================================

// 1. Popular / Trending Manga
app.get('/api/popular', async (req, res) => {
  try {
    const cacheKey = 'popular_manga';
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    if (cached) return res.json(cached);

    const data = await fetchMangaDex('/manga?limit=24&includes[]=cover_art&includes[]=author&order[followedCount]=desc&contentRating[]=safe&contentRating[]=suggestive');
    setCache(cacheKey, data, CACHE_TTL.popular);
    res.json(data);
  } catch (error) {
    console.error('Error fetching popular manga:', error.message);
    const cached = getCache('popular_manga');
    if (cached) return res.json(cached);

    try {
      const html = await fetchExternalHtml('https://komiku.org/');
      const $ = cheerio.load(html);
      const items = [];
      $('.ls2, .ls4, .ls12').each((_, el) => {
        const a = $(el).find('a').first();
        const href = a.attr('href') || '';
        const rawTitle = $(el).find('h4, h3, .tt').first().text().trim() || a.attr('title') || '';
        const img = $(el).find('img').first().attr('data-src') || $(el).find('img').first().attr('src') || '';
        const latestCh = $(el).find('.epx, .lsch, .chapter').first().text().trim();
        if (href && rawTitle) {
          const slug = href.replace(/\/+$/, '').split('/').pop();
          if (!items.some(r => r.slug === slug)) {
            const title = rawTitle.replace(/^Komik\s*/i, '').trim();
            items.push({
              id: `komiku-${slug}`,
              slug,
              title,
              type: 'manga',
              attributes: {
                title: { en: title, id: title },
                description: { id: 'Manga populer terjemahan bahasa Indonesia.', en: 'Popular manga title.' },
                status: 'ongoing',
                lastChapter: latestCh || 'Update',
                availableTranslatedLanguages: ['id', 'en']
              },
              coverUrl: img ? `/api/proxy-image?url=${encodeURIComponent(img)}` : '',
              source: 'komiku'
            });
          }
        }
      });
      if (items.length > 0) {
        return res.json({ data: items.slice(0, 24) });
      }
    } catch (e) {}

    res.status(500).json({ error: error.message });
  }
});

// 2. Latest Updates
app.get('/api/latest', async (req, res) => {
  try {
    const cacheKey = 'latest_manga';
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=180, stale-while-revalidate=360');
    if (cached) return res.json(cached);

    const data = await fetchMangaDex('/manga?limit=24&includes[]=cover_art&order[latestUploadedChapter]=desc&contentRating[]=safe&contentRating[]=suggestive');
    setCache(cacheKey, data, CACHE_TTL.latest);
    res.json(data);
  } catch (error) {
    console.error('Error fetching latest manga:', error.message);
    const cached = getCache('latest_manga');
    if (cached) return res.json(cached);

    try {
      const html = await fetchExternalHtml('https://komiku.org/');
      const $ = cheerio.load(html);
      const items = [];
      $('.ls2, .ls4, .ls12').each((_, el) => {
        const a = $(el).find('a').first();
        const href = a.attr('href') || '';
        const rawTitle = $(el).find('h4, h3, .tt').first().text().trim() || a.attr('title') || '';
        const img = $(el).find('img').first().attr('data-src') || $(el).find('img').first().attr('src') || '';
        const latestCh = $(el).find('.epx, .lsch, .chapter').first().text().trim();
        if (href && rawTitle) {
          const slug = href.replace(/\/+$/, '').split('/').pop();
          if (!items.some(r => r.slug === slug)) {
            const title = rawTitle.replace(/^Komik\s*/i, '').trim();
            items.push({
              id: `komiku-${slug}`,
              slug,
              title,
              type: 'manga',
              attributes: {
                title: { en: title, id: title },
                description: { id: 'Manga rilis chapter terbaru.', en: 'Latest released manga chapter.' },
                status: 'ongoing',
                lastChapter: latestCh || 'Update',
                availableTranslatedLanguages: ['id', 'en']
              },
              coverUrl: img ? `/api/proxy-image?url=${encodeURIComponent(img)}` : '',
              source: 'komiku'
            });
          }
        }
      });
      if (items.length > 0) {
        return res.json({ data: items.slice(0, 24) });
      }
    } catch (e) {}

    res.status(500).json({ error: error.message });
  }
});

// 3. Search Manga
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const tag = req.query.tag || '';
    const lang = req.query.lang || '';
    const order = req.query.order || (tag ? 'followedCount' : '');

    const cacheKey = `search_${query}_${limit}_${offset}_${tag}_${lang}_${order}`;
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    if (cached) return res.json(cached);

    let endpoint = `/manga?limit=${limit}&offset=${offset}&includes[]=cover_art&includes[]=author`;
    
    // Explicit tag/content handling for Hentai, Erotica, and full catalog search
    if (tag === 'hentai' || tag === 'content_rating_pornographic') {
      endpoint += '&contentRating[]=pornographic';
    } else if (tag === 'erotica') {
      endpoint += '&contentRating[]=erotica';
    } else {
      endpoint += '&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic';
    }

    if (query) endpoint += `&title=${encodeURIComponent(query)}`;
    if (tag && tag !== 'hentai' && tag !== 'content_rating_pornographic' && tag !== 'erotica') {
      endpoint += `&includedTags[]=${encodeURIComponent(tag)}`;
    }

    if (order === 'followedCount') {
      endpoint += '&order[followedCount]=desc';
    } else if (order === 'latest') {
      endpoint += '&order[latestUploadedChapter]=desc';
    } else if (order === 'rating') {
      endpoint += '&order[rating]=desc';
    } else if (order === 'newest' || order === 'createdAt') {
      endpoint += '&order[createdAt]=desc';
    }

    // Do NOT restrict to 'id' only so comics with English chapters remain discoverable
    if (lang && lang !== 'all') {
      if (lang === 'id') {
        endpoint += `&availableTranslatedLanguage[]=id&availableTranslatedLanguage[]=en`;
      } else {
        endpoint += `&availableTranslatedLanguage[]=${encodeURIComponent(lang)}`;
      }
    }

    const data = await fetchMangaDex(endpoint);
    setCache(cacheKey, data, CACHE_TTL.search);
    res.json(data);
  } catch (error) {
    console.error('Error searching manga:', error.message);
    res.json({ data: [], error: error.message });
  }
});

// 3.1 Get All Manga Tags / Genres from MangaDex API
app.get('/api/tags', async (req, res) => {
  const cacheKey = 'mangadex_all_tags_v2';
  const cached = getCache(cacheKey);
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  if (cached) return res.json(cached);

  try {
    const data = await fetchMangaDex('/manga/tag');
    setCache(cacheKey, data, CACHE_TTL.popular);
    res.json(data);
  } catch (error) {
    console.error('Error fetching tags:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 3.2 Curated Explore Feeds for MangaDex Browse Page
app.get('/api/explore', async (req, res) => {
  const cacheKey = 'mangadex_explore_sections_v2';
  const cached = getCache(cacheKey);
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  if (cached) return res.json(cached);

  try {
    const baseParams = 'limit=18&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive';
    const [recRes, recentRes, updateRes, selfRes, romRes, actRes] = await Promise.allSettled([
      fetchMangaDex(`/manga?${baseParams}&order[followedCount]=desc`),
      fetchMangaDex(`/manga?${baseParams}&order[createdAt]=desc`),
      fetchMangaDex(`/manga?${baseParams}&order[latestUploadedChapter]=desc`),
      fetchMangaDex(`/manga?${baseParams}&includedTags[]=891cf039-b895-47f0-9229-bef4c96eccd4&order[followedCount]=desc`),
      fetchMangaDex(`/manga?${baseParams}&includedTags[]=423e2eae-a7a2-4a8b-ac03-a8351462d71d&order[followedCount]=desc`),
      fetchMangaDex(`/manga?${baseParams}&includedTags[]=391b0423-d847-456f-aff0-8b0cfc03066b&order[followedCount]=desc`)
    ]);

    const result = {
      recommended: recRes.status === 'fulfilled' ? (recRes.value.data || []) : [],
      recentlyAdded: recentRes.status === 'fulfilled' ? (recentRes.value.data || []) : [],
      latestUpdates: updateRes.status === 'fulfilled' ? (updateRes.value.data || []) : [],
      selfPublished: selfRes.status === 'fulfilled' ? (selfRes.value.data || []) : [],
      romance: romRes.status === 'fulfilled' ? (romRes.value.data || []) : [],
      action: actRes.status === 'fulfilled' ? (actRes.value.data || []) : []
    };

    setCache(cacheKey, result, CACHE_TTL.popular);
    res.json(result);
  } catch (error) {
    console.error('Error fetching explore feeds:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 4. Manga Details by ID
app.get('/api/manga/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `manga_${id}`;
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200');
    if (cached) return res.json(cached);

    const data = await fetchMangaDex(`/manga/${id}?includes[]=cover_art&includes[]=author`);
    setCache(cacheKey, data, CACHE_TTL.manga);
    res.json(data);
  } catch (error) {
    console.error(`Error fetching manga ${req.params.id}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 5. Manga Chapters Feed with Full Pagination (Limit 500 & Loop) + Filtering
app.get('/api/manga/:id/chapters', async (req, res) => {
  try {
    const { id } = req.params;
    const lang = req.query.lang || 'all';
    const order = req.query.order || 'asc';

    const cacheKey = `chapters_v3_${id}_${lang}_${order}`;
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
    if (cached) return res.json(cached);

    let langParams = '';
    if (lang && lang !== 'all') {
      langParams = `&translatedLanguage[]=${encodeURIComponent(lang)}`;
    } else {
      langParams = `&translatedLanguage[]=id&translatedLanguage[]=en`;
    }

    let allChapters = [];
    let offset = 0;
    const batchLimit = 500;
    let totalChapters = 0;

    do {
      const endpoint = `/manga/${id}/feed?limit=${batchLimit}&offset=${offset}&includes[]=scanlation_group&order[chapter]=${order}&order[volume]=${order}&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic${langParams}`;
      const data = await fetchMangaDex(endpoint);
      totalChapters = data.total || 0;
      const batch = data.data || [];
      allChapters.push(...batch);
      offset += batchLimit;
    } while (offset < totalChapters && allChapters.length < totalChapters);

    // Filter out chapters that cannot be read directly (externalUrl !== null or pages === 0)
    const readableChapters = allChapters.filter(ch => {
      const attrs = ch.attributes;
      if (!attrs) return false;
      if (attrs.externalUrl) return false;
      if (attrs.pages === 0) return false;
      return true;
    });

    // Attach scanlation group name to attributes
    readableChapters.forEach(ch => {
      const groupRel = ch.relationships?.find(r => r.type === 'scanlation_group');
      if (groupRel?.attributes?.name) {
        ch.attributes.scanlationGroup = groupRel.attributes.name;
      }
    });

    const result = {
      result: 'ok',
      response: 'collection',
      data: readableChapters,
      total: readableChapters.length,
      limit: readableChapters.length,
      offset: 0
    };

    setCache(cacheKey, result, CACHE_TTL.chapters);
    res.json(result);
  } catch (error) {
    console.error(`Error fetching chapters for manga ${req.params.id}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 6. Chapter Pages via MangaDex@Home with High-Availability uploads.mangadex.org CDN
app.get('/api/chapter/:chapterId', async (req, res) => {
  try {
    const { chapterId } = req.params;
    const cacheKey = `athome_v4_${chapterId}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const data = await fetchMangaDex(`/at-home/server/${chapterId}`);
    
    const baseUrl = data.baseUrl;
    const hash = data.chapter.hash;

    // uploads.mangadex.org is MangaDex's official high-availability fallback CDN
    const cdnBase = 'https://uploads.mangadex.org';
    const homeBase = baseUrl || cdnBase;

    const dataSaverFiles = (data.chapter.dataSaver && data.chapter.dataSaver.length > 0)
      ? data.chapter.dataSaver
      : (data.chapter.data || []);
    const originalFiles = data.chapter.data || [];
    const totalPages = Math.max(dataSaverFiles.length, originalFiles.length);

    // Primary URLs: Use assigned homeBase node for high-speed, authorized, unthrottled streaming
    const dataSaverPages = dataSaverFiles.map(fn => `${homeBase}/data-saver/${hash}/${fn}`);
    const originalPages = originalFiles.map(fn => `${homeBase}/data/${hash}/${fn}`);

    // High-availability CDN fallback URLs
    const cdnDataSaverPages = dataSaverFiles.map(fn => `${cdnBase}/data-saver/${hash}/${fn}`);
    const cdnOriginalPages = originalFiles.map(fn => `${cdnBase}/data/${hash}/${fn}`);

    // Rich page objects with multi-tier fallback URLs
    const pageDetails = [];
    for (let i = 0; i < totalPages; i++) {
      const dsFn = dataSaverFiles[i] || originalFiles[i];
      const origFn = originalFiles[i] || dataSaverFiles[i];
      pageDetails.push({
        pageNumber: i + 1,
        // Primary At-Home node
        dataSaverUrl: `${homeBase}/data-saver/${hash}/${dsFn}`,
        originalUrl: `${homeBase}/data/${hash}/${origFn}`,
        // CDN fallback
        cdnDataSaverUrl: `${cdnBase}/data-saver/${hash}/${dsFn}`,
        cdnOriginalUrl: `${cdnBase}/data/${hash}/${origFn}`
      });
    }

    const result = {
      result: data.result,
      baseUrl: homeBase,
      cdnBase: cdnBase,
      hash: hash,
      pages: originalPages,
      dataSaverPages: dataSaverPages,
      homePages: originalPages,
      homeDataSaverPages: dataSaverPages,
      cdnPages: cdnOriginalPages,
      cdnDataSaverPages: cdnDataSaverPages,
      pageDetails: pageDetails,
      totalPages: totalPages
    };

    setCache(cacheKey, result, CACHE_TTL.atHome);
    res.json(result);
  } catch (error) {
    console.error(`Error fetching chapter pages for ${req.params.chapterId}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 7. Cover Art Proxy with LOCAL DISK CACHING & Multi-Tier Fallback (Instant 0ms on repeat views)
app.get('/api/cover/:mangaId/:filename', (req, res) => {
  const { mangaId, filename } = req.params;
  const safeFilename = `${mangaId}_${filename}`;
  const diskPath = path.join(COVERS_CACHE_DIR, safeFilename);

  // If already on disk, serve immediately!
  if (fs.existsSync(diskPath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400, immutable');
    return fs.createReadStream(diskPath).pipe(res);
  }

  // Helper to fetch from MangaDex
  const fetchMangaDexCover = (targetFn) => {
    return new Promise((resolve, reject) => {
      const targetPath = `/covers/${mangaId}/${targetFn}`;
      const options = {
        hostname: 'uploads.mangadex.org',
        port: 443,
        path: targetPath,
        method: 'GET',
        agent: httpsAgent,
        lookup: customLookup,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Referer': 'https://mangadex.org/'
        },
        timeout: 8000
      };

      const proxyReq = https.request(options, (proxyRes) => {
        if (proxyRes.statusCode === 200) {
          const chunks = [];
          proxyRes.on('data', c => chunks.push(c));
          proxyRes.on('end', () => resolve({
            buffer: Buffer.concat(chunks),
            contentType: proxyRes.headers['content-type'] || 'image/jpeg'
          }));
        } else {
          reject(new Error(`Status ${proxyRes.statusCode}`));
        }
      });
      proxyReq.on('timeout', () => { proxyReq.destroy(); reject(new Error('Cover fetch timeout')); });
      proxyReq.on('error', reject);
      proxyReq.end();
    });
  };

  (async () => {
    try {
      let coverData = null;
      try {
        coverData = await fetchMangaDexCover(filename);
      } catch (e1) {
        // Fallback 1: If requested .512.jpg or .256.jpg failed, try raw filename
        if (filename.endsWith('.512.jpg') || filename.endsWith('.256.jpg')) {
          const rawFn = filename.replace(/\.(512|256)\.jpg$/, '');
          try {
            coverData = await fetchMangaDexCover(rawFn);
          } catch (e2) {}
        }
      }

      // Fallback 2: wsrv.nl Edge CDN proxy
      if (!coverData) {
        try {
          const wsrvUrl = `https://wsrv.nl/?url=https://uploads.mangadex.org/covers/${mangaId}/${filename}&output=jpg&q=80`;
          const wsrvRes = await fetch(wsrvUrl, { signal: AbortSignal.timeout(4000) });
          if (wsrvRes.ok) {
            const arrBuf = await wsrvRes.arrayBuffer();
            coverData = { buffer: Buffer.from(arrBuf), contentType: 'image/jpeg' };
          }
        } catch (e3) {}
      }

      // Fallback 3: AniList High-Resolution Cover Art by Title
      if (!coverData) {
        try {
          let searchTitle = (req.query.title || '').trim();
          if (!searchTitle) {
            for (const [key, val] of cache.entries()) {
              if (val && Array.isArray(val.data)) {
                const found = val.data.find(m => m && m.id === mangaId);
                if (found) {
                  const t = found.title || found.attributes?.title;
                  if (typeof t === 'string') searchTitle = t;
                  else if (typeof t === 'object' && t !== null) searchTitle = t.en || t.id || t.romaji || Object.values(t)[0];
                  if (searchTitle) break;
                }
              }
            }
          }

          if (searchTitle) {
            const cleanSearchTitle = searchTitle.replace(/[\[\(][^\]\)]*[\]\)]/g, ' ').replace(/\s+/g, ' ').trim();
            const gqlQuery = `query ($s: String) { Media(search: $s, type: MANGA) { coverImage { large medium } } }`;
            const alRes = await fetch('https://graphql.anilist.co', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: gqlQuery, variables: { s: cleanSearchTitle } }),
              signal: AbortSignal.timeout(4500)
            });
            if (alRes.ok) {
              const alJson = await alRes.json();
              const alImgUrl = alJson.data?.Media?.coverImage?.large || alJson.data?.Media?.coverImage?.medium;
              if (alImgUrl) {
                const imgFetch = await fetch(alImgUrl, { signal: AbortSignal.timeout(5000) });
                if (imgFetch.ok) {
                  const arr = await imgFetch.arrayBuffer();
                  coverData = {
                    buffer: Buffer.from(arr),
                    contentType: imgFetch.headers.get('content-type') || 'image/jpeg'
                  };
                }
              }
            }
          }
        } catch (eAl) {}
      }

      if (coverData && coverData.buffer && coverData.buffer.length > 500) {
        try {
          fs.writeFileSync(diskPath, coverData.buffer);
        } catch (e) {}
        res.writeHead(200, {
          'Content-Type': coverData.contentType,
          'Cache-Control': 'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400, immutable'
        });
        return res.end(coverData.buffer);
      }

      // Fallback 4: Clean placeholder image
      res.redirect(302, 'https://placehold.co/300x420/1e2025/ffffff?text=Cover');
    } catch (err) {
      res.redirect(302, 'https://placehold.co/300x420/1e2025/ffffff?text=Cover');
    }
  })();
});

// ==========================================
// MULTI-SOURCE SCRAPER: BACAKOMIK / LOKAL
// ==========================================

function fetchExternalHtml(targetUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'id,en-US;q=0.9,en;q=0.8'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
  });
}

// Search Bacakomik
app.get('/api/external/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    if (!query) return res.json({ data: [] });

    const rawQuery = (req.query.q || '').trim();
    if (!rawQuery) return res.json({ data: [] });

    // Clean query: strip punctuation that breaks WordPress SQL search
    const cleanQuery = rawQuery.replace(/[()\[\]'":_]/g, ' ').replace(/\s+/g, ' ').trim();

    const cacheKey = `ext_search_${cleanQuery}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    function parseSearchResults(htmlText, sourceHost = 'bacakomik') {
      const re = /<a href="(https:\/\/(?:bacakomik\.my|komikindo\.ch)\/komik\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let match;
      const list = [];
      while ((match = re.exec(htmlText)) !== null) {
        const url = match[1];
        const title = match[2].replace(/<[^>]+>/g, '').replace(/^Komik\s*/i, '').trim();
        if (title && !list.some(item => item.url === url)) {
          list.push({ url, title, source: sourceHost });
        }
      }
      return list;
    }

    let list = [];

    // Step 1: Search Bacakomik with cleaned query
    try {
      const html1 = await fetchExternalHtml(`https://bacakomik.my/?s=${encodeURIComponent(cleanQuery)}`);
      list = parseSearchResults(html1, 'bacakomik');
    } catch (e) {}

    // Step 2: Fallback - Replace hyphens with spaces (e.g. Baek-sun -> Baek sun)
    if (list.length === 0 && cleanQuery.includes('-')) {
      const altQ = cleanQuery.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
      try {
        const html2 = await fetchExternalHtml(`https://bacakomik.my/?s=${encodeURIComponent(altQ)}`);
        list = parseSearchResults(html2, 'bacakomik');
      } catch (e) {}
    }

    // Step 3: Fallback - Remove hyphens completely (e.g. Gye Baek-sun -> Gye Baeksun)
    if (list.length === 0 && cleanQuery.includes('-')) {
      const altQ2 = cleanQuery.replace(/-/g, '').replace(/\s+/g, ' ').trim();
      try {
        const html3 = await fetchExternalHtml(`https://bacakomik.my/?s=${encodeURIComponent(altQ2)}`);
        list = parseSearchResults(html3, 'bacakomik');
      } catch (e) {}
    }

    // Step 4: Fallback - Progressive word search (taking last 2 words)
    if (list.length === 0) {
      const words = cleanQuery.replace(/-/g, ' ').split(/\s+/).filter(w => w.length > 2);
      if (words.length >= 2) {
        const shortQ = words.slice(-2).join(' ');
        try {
          const html4 = await fetchExternalHtml(`https://bacakomik.my/?s=${encodeURIComponent(shortQ)}`);
          list = parseSearchResults(html4, 'bacakomik');
        } catch (e) {}
      }
    }

    // Step 5: Secondary Mirror Fallback - Query Komikindo if Bacakomik returned 0!
    if (list.length === 0) {
      const kQuery = cleanQuery.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
      try {
        const kHtml = await fetchExternalHtml(`https://komikindo.ch/?s=${encodeURIComponent(kQuery)}`);
        const kList = parseSearchResults(kHtml, 'komikindo');
        if (kList.length > 0) {
          list = kList;
        } else {
          // Try short query on Komikindo
          const words = kQuery.split(/\s+/).filter(w => w.length > 2);
          if (words.length >= 2) {
            const kShort = words.slice(-2).join(' ');
            const kHtml2 = await fetchExternalHtml(`https://komikindo.ch/?s=${encodeURIComponent(kShort)}`);
            list = parseSearchResults(kHtml2, 'komikindo');
          }
        }
      } catch (kErr) {}
    }

    const result = { source: 'mirror', query: cleanQuery, data: list };
    setCache(cacheKey, result, CACHE_TTL.external);
    res.json(result);
  } catch (err) {
    console.error('External search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get Chapters from Bacakomik / Komikindo URL
app.get('/api/external/chapters', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });

    const cacheKey = `ext_chapters_${targetUrl}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const html = await fetchExternalHtml(targetUrl);
    const chapters = [];
    
    // Priority 1: Parse from #chapter_list or .eps_lst container
    const listMatch = html.match(/(?:id=["']chapter_list["']|class=["'](?:bxcl|eps_lst|listeps)["'])[\s\S]*?<\/ul>/i);
    if (listMatch) {
      const section = listMatch[0];
      const itemRe = /<a href="(https:\/\/(?:bacakomik\.my|komikindo\.ch)\/[^"]*chapter[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = itemRe.exec(section)) !== null) {
        const chUrl = m[1];
        const rawTitle = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (!chapters.some(c => c.url === chUrl)) {
          chapters.push({ url: chUrl, title: rawTitle });
        }
      }
    }

    // Fallback if container was not matched
    if (chapters.length === 0) {
      const chRe = /<a href="(https:\/\/(?:bacakomik\.my|komikindo\.ch)\/[^"]*chapter[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = chRe.exec(html)) !== null) {
        const chUrl = match[1];
        const chTitle = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (!chTitle.toLowerCase().includes('chapter awal') && !chTitle.toLowerCase().includes('chapter baru')) {
          if (!chapters.some(c => c.url === chUrl)) {
            chapters.push({ url: chUrl, title: chTitle });
          }
        }
      }
    }

    const result = { source: 'mirror', total: chapters.length, chapters };
    setCache(cacheKey, result, CACHE_TTL.external);
    res.json(result);
  } catch (err) {
    console.error('External chapters error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get Chapter Images from Bacakomik or Komikindo Chapter URL
app.get('/api/external/chapter-pages', async (req, res) => {
  try {
    const chapterUrl = req.query.url;
    if (!chapterUrl) return res.status(400).json({ error: 'Missing url parameter' });

    const cacheKey = `ext_pages_${chapterUrl}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const html = await fetchExternalHtml(chapterUrl);
    
    // Extract images from both data-lazy-src and src in chapter containers
    const imgMatches = [...html.matchAll(/<img[^>]+(?:data-lazy-src|data-src|src)=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
    
    // Filter out site logos, favicons, avatars, banners
    const chapterPages = imgMatches.filter(url => {
      const lower = url.toLowerCase();
      if (lower.includes('logo') || lower.includes('banner') || lower.includes('fav') || lower.includes('icon')) return false;
      return lower.includes('blogger.googleusercontent.com') ||
             lower.includes('/data/') ||
             (!lower.includes('wp-content/uploads') && (lower.includes('.jpg') || lower.includes('.webp') || lower.includes('.png') || lower.includes('.jpeg')));
    });

    // Remove duplicates
    const uniquePages = [...new Set(chapterPages)];

    // Proxy the images to avoid hotlink/referer blocking
    const proxiedPages = uniquePages.map(u => `/api/proxy-image?url=${encodeURIComponent(u)}`);

    const result = {
      source: 'mirror',
      total: proxiedPages.length,
      pages: proxiedPages
    };

    setCache(cacheKey, result, CACHE_TTL.external);
    res.json(result);
  } catch (err) {
    console.error('External chapter pages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// In-memory LRU Image Cache (max 250 images, TTL 1 hour)
const proxyImageMemoryCache = new Map();
const MAX_PROXY_IMAGE_CACHE_ENTRIES = 250;
const PROXY_IMAGE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCachedProxyImage(key) {
  const item = proxyImageMemoryCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    proxyImageMemoryCache.delete(key);
    return null;
  }
  // LRU bump
  proxyImageMemoryCache.delete(key);
  proxyImageMemoryCache.set(key, item);
  return item;
}

function setCachedProxyImage(key, buffer, contentType) {
  if (proxyImageMemoryCache.size >= MAX_PROXY_IMAGE_CACHE_ENTRIES) {
    const oldestKey = proxyImageMemoryCache.keys().next().value;
    proxyImageMemoryCache.delete(oldestKey);
  }
  proxyImageMemoryCache.set(key, {
    buffer,
    contentType: contentType || 'image/jpeg',
    expiresAt: Date.now() + PROXY_IMAGE_CACHE_TTL
  });
}

// Strengthened Image Proxy with Multi-Tier Fallbacks, DoH, and Smart Anti-Hotlink Bypasses
app.get(['/api/proxy-image', '/api/proxy/image'], async (req, res) => {
  let imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).end();

  // If already wrapped in proxy like /api/proxy-image?url=...
  while (typeof imageUrl === 'string' && (imageUrl.startsWith('/api/proxy-image?url=') || imageUrl.startsWith('/api/proxy/image?url='))) {
    const nextUrl = imageUrl.replace(/^\/api\/proxy[-/]image\?url=/, '');
    imageUrl = decodeURIComponent(nextUrl);
  }

  // Handle local relative cover URLs if requested via proxy
  if (typeof imageUrl === 'string' && imageUrl.startsWith('/api/cover/')) {
    const parts = imageUrl.replace('/api/cover/', '').split('/');
    if (parts.length >= 2) {
      const mangaId = parts[0];
      const filename = parts.slice(1).join('/');
      const safeFilename = `${mangaId}_${filename}`;
      const diskPath = path.join(COVERS_CACHE_DIR, safeFilename);
      if (fs.existsSync(diskPath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        return fs.createReadStream(diskPath).pipe(res);
      }
    }
  }

  // Fast Memory Cache Hit
  const cacheKey = `img_${imageUrl}`;
  const memCached = getCachedProxyImage(cacheKey);
  if (memCached) {
    res.writeHead(200, {
      'Content-Type': memCached.contentType,
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(memCached.buffer);
  }

  try {
    const parsed = new URL(imageUrl);
    const host = parsed.hostname.toLowerCase();
    const isMangaDex = host.includes('mangadex.org') || host.includes('mangadex.network');

    // Smart Referer determination:
    function getSmartReferer(targetUrl) {
      if (req.query.referer) return req.query.referer;
      const u = new URL(targetUrl);
      const h = u.hostname.toLowerCase();
      if (
        h.includes('googleusercontent.com') ||
        h.includes('blogspot.com') ||
        h.includes('ggpht.com') ||
        h.includes('wp.com') ||
        h.includes('wordpress.com')
      ) {
        return ''; // Google & WordPress Photon block foreign Referers with 403 Forbidden
      }
      if (h.includes('mangadex.org') || h.includes('mangadex.network')) {
        return 'https://mangadex.org/';
      }
      if (h.includes('readdetectiveconan.com') || h.includes('mangapill.com')) {
        return 'https://mangapill.com/';
      }
      if (h.includes('komikindo.ch') || h.includes('komikindo')) {
        return 'https://komikindo.ch/';
      }
      if (h.includes('komiku.org') || h.includes('komiku.to') || h.includes('komiku')) {
        return 'https://komiku.org/';
      }
      if (h.includes('comick.art') || h.includes('comick') || h.includes('comicknew.pictures')) {
        return 'https://comick.art/';
      }
      return `${u.protocol}//${u.host}/`;
    }

    // Single Stream Fetch with 7.5s Timeout
    function fetchSingleStream(targetUrl, currentReferer, redirectCount = 0) {
      return new Promise((resolve, reject) => {
        if (redirectCount > 3) return reject(new Error('Too many redirects'));
        const u = new URL(targetUrl);
        const isHttps = u.protocol === 'https:';
        const client = isHttps ? https : http;
        const agent = isHttps ? httpsAgent : null;

        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
        };
        if (currentReferer) {
          headers['Referer'] = currentReferer;
        }

        const reqOpts = {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname + u.search,
          method: 'GET',
          agent: agent,
          lookup: customLookup,
          headers: headers,
          timeout: 7500
        };

        const req = client.request(reqOpts, (proxyRes) => {
          if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            const redirectUrl = new URL(proxyRes.headers.location, targetUrl).href;
            return resolve(fetchSingleStream(redirectUrl, currentReferer, redirectCount + 1));
          }

          if (proxyRes.statusCode < 200 || proxyRes.statusCode >= 300) {
            return reject(new Error(`Upstream returned ${proxyRes.statusCode}`));
          }

          const chunks = [];
          proxyRes.on('data', chunk => chunks.push(chunk));
          proxyRes.on('end', () => {
            const buffer = Buffer.concat(chunks);
            resolve({
              statusCode: proxyRes.statusCode,
              headers: proxyRes.headers,
              buffer: buffer
            });
          });
          proxyRes.on('error', reject);
        });

        req.on('timeout', () => {
          req.destroy(new Error('Proxy request timed out'));
        });
        req.on('error', reject);
        req.end();
      });
    }

    // Build ordered list of candidate URLs for multi-tier resilience
    const candidates = [];

    // For Komiku: if url is on timing-out image3/image4, prioritize alive image2.komiku.to
    if (host.includes('komiku.to')) {
      const aliveUrl = imageUrl.replace(/^https?:\/\/image\d*\.komiku\.to\//i, 'https://image2.komiku.to/');
      candidates.push({ url: aliveUrl, referer: 'https://komiku.org/' });
      if (aliveUrl !== imageUrl) {
        candidates.push({ url: imageUrl, referer: getSmartReferer(imageUrl) });
      }
    } else {
      candidates.push({ url: imageUrl, referer: getSmartReferer(imageUrl) });
    }

    if (isMangaDex) {
      // If node is At-Home (*.mangadex.network), add official CDN fallback
      if (host.includes('mangadex.network')) {
        const cdnUrl = `https://uploads.mangadex.org${parsed.pathname}${parsed.search}`;
        candidates.push({ url: cdnUrl, referer: 'https://mangadex.org/' });
      }

      // If requested /data-saver/, add /data/ as fallback (and vice-versa)
      if (parsed.pathname.includes('/data-saver/')) {
        const fullResPath = parsed.pathname.replace('/data-saver/', '/data/');
        candidates.push({ url: `https://uploads.mangadex.org${fullResPath}${parsed.search}`, referer: 'https://mangadex.org/' });
      } else if (parsed.pathname.includes('/data/')) {
        const saverPath = parsed.pathname.replace('/data/', '/data-saver/');
        candidates.push({ url: `https://uploads.mangadex.org${saverPath}${parsed.search}`, referer: 'https://mangadex.org/' });
      }
    } else {
      // Non-MangaDex mirrors (Komiku, Mangapill, etc.)
      // Retry candidate with clean empty Referer (bypasses strict CDN referer validations)
      candidates.push({ url: imageUrl, referer: '' });
      // Edge CDN fallback (wsrv.nl works great for external mirrors)
      candidates.push({
        url: `https://wsrv.nl/?url=${encodeURIComponent(imageUrl)}&we=1&n=-1`,
        referer: ''
      });
    }

    let successfulResult = null;
    let lastError = null;

    for (const cand of candidates) {
      try {
        const result = await fetchSingleStream(cand.url, cand.referer);
        const buf = result.buffer;

        if (buf && buf.length > 200) {
          successfulResult = result;
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!successfulResult) {
      throw lastError || new Error('All image proxy candidates failed');
    }

    const contentType = successfulResult.headers['content-type'] || 'image/jpeg';
    const imageBuffer = successfulResult.buffer;

    // Save to Memory Cache
    setCachedProxyImage(cacheKey, imageBuffer, contentType);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': '*'
    });

    res.end(imageBuffer);
  } catch (err) {
    console.error('Image proxy final error for', imageUrl, ':', err.message);
    res.status(502).json({ error: 'Bad Gateway: ' + err.message });
  }
});

// ==========================================
// ENGLISH MIRROR PROVIDER (Mangapill Engine)
// ==========================================

// Search English Mirror
app.get('/api/external/en/search', async (req, res) => {
  try {
    const rawQuery = (req.query.q || '').trim();
    if (!rawQuery) return res.json({ data: [] });

    const cleanQuery = rawQuery.replace(/[()\[\]'":_]/g, ' ').replace(/\s+/g, ' ').trim();
    const cacheKey = `ext_en_search_${cleanQuery}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const html = await fetchExternalHtml(`https://mangapill.com/search?q=${encodeURIComponent(cleanQuery)}`);
    const re = /<a[^>]+href="(\/manga\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    const list = [];
    while ((match = re.exec(html)) !== null) {
      const href = match[1];
      const rawTitle = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const fullUrl = `https://mangapill.com${href}`;
      if (rawTitle && !list.some(item => item.url === fullUrl)) {
        list.push({
          url: fullUrl,
          title: rawTitle,
          source: 'mangapill'
        });
      }
    }

    const result = { source: 'mangapill', query: cleanQuery, data: list };
    setCache(cacheKey, result, CACHE_TTL.external);
    res.json(result);
  } catch (err) {
    console.error('English mirror search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get Chapters from English Mirror Manga URL
app.get('/api/external/en/chapters', async (req, res) => {
  try {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });
    if (!targetUrl.startsWith('http')) targetUrl = `https://mangapill.com${targetUrl}`;

    const cacheKey = `ext_en_chapters_${targetUrl}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const html = await fetchExternalHtml(targetUrl);
    const chapters = [];
    const chRe = /<a[^>]+href="(\/chapters\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = chRe.exec(html)) !== null) {
      const href = match[1];
      const chTitle = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const fullUrl = `https://mangapill.com${href}`;
      if (!chapters.some(c => c.url === fullUrl)) {
        chapters.push({
          url: fullUrl,
          title: chTitle
        });
      }
    }

    const result = { source: 'mangapill', total: chapters.length, chapters };
    setCache(cacheKey, result, CACHE_TTL.external);
    res.json(result);
  } catch (err) {
    console.error('English mirror chapters error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get Chapter Images from English Mirror Chapter URL
app.get('/api/external/en/chapter-pages', async (req, res) => {
  try {
    let chapterUrl = req.query.url;
    if (!chapterUrl) return res.status(400).json({ error: 'Missing url parameter' });
    if (!chapterUrl.startsWith('http')) chapterUrl = `https://mangapill.com${chapterUrl}`;

    const cacheKey = `ext_en_pages_${chapterUrl}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const html = await fetchExternalHtml(chapterUrl);
    const imgMatches = [...html.matchAll(/<img[^>]+data-src=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
    
    const uniquePages = [...new Set(imgMatches)];
    const proxiedPages = uniquePages.map(u => `/api/proxy-image?url=${encodeURIComponent(u)}`);

    const result = {
      source: 'mangapill',
      total: proxiedPages.length,
      pages: proxiedPages
    };

    setCache(cacheKey, result, CACHE_TTL.external);
    res.json(result);
  } catch (err) {
    console.error('English mirror chapter pages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ANILIST GRAPHQL API (Hero Banner, Rating, Anime & Smart Relations)
// ==========================================
const ANILIST_QUERY = `
query ($search: String, $id: Int, $type: MediaType = MANGA) {
  Media (search: $search, id: $id, type: $type) {
    id
    title {
      romaji
      english
      native
    }
    bannerImage
    coverImage {
      extraLarge
      large
      color
    }
    description(asHtml: false)
    averageScore
    genres
    status
    format
    episodes
    chapters
    season
    seasonYear
    relations {
      edges {
        relationType
        node {
          id
          title {
            romaji
            english
            native
          }
          type
          format
          status
          coverImage {
            large
            extraLarge
          }
          bannerImage
        }
      }
    }
  }
}
`;

const ANILIST_ANIME_PAGE_QUERY = `
query ($page: Int = 1, $perPage: Int = 24, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $format: MediaFormat, $search: String, $genre: String) {
  Page (page: $page, perPage: $perPage) {
    pageInfo {
      total
      currentPage
      hasNextPage
    }
    media (type: ANIME, sort: $sort, season: $season, seasonYear: $seasonYear, format: $format, search: $search, genre: $genre) {
      id
      title {
        romaji
        english
        native
      }
      bannerImage
      coverImage {
        extraLarge
        large
        color
      }
      description(asHtml: false)
      averageScore
      genres
      status
      format
      episodes
      season
      seasonYear
      relations {
        edges {
          relationType
          node {
            id
            title {
              romaji
              english
            }
            type
            format
          }
        }
      }
    }
  }
}
`;

function cleanAniListTitle(title) {
  if (!title) return '';
  return title
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[-_:]/g, ' ')
    .replace(/\s+(manga|manhwa|manhua|anime|bahasa indonesia|indo|chapter\s*\d+|episode\s*\d+).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchAniListGraphQL(title, mediaType = 'MANGA', mediaId = null) {
  const cleanTitle = cleanAniListTitle(title);
  if (!cleanTitle && !mediaId) return null;

  const cacheKey = `anilist_v2_${mediaType}_${mediaId || cleanTitle.toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  return new Promise((resolve) => {
    const variables = { type: mediaType };
    if (mediaId) {
      variables.id = parseInt(mediaId, 10);
    } else {
      variables.search = cleanTitle;
    }

    const postData = JSON.stringify({
      query: ANILIST_QUERY,
      variables: variables
    });

    const req = https.request({
      hostname: 'graphql.anilist.co',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Yomikomi/2.0 (Personal Manga & Anime Platform)'
      },
      timeout: 6500
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const media = json.data?.Media;
          if (media) {
            const rating = typeof media.averageScore === 'number' ? Math.round((media.averageScore / 10) * 10) / 10 : null;
            const ratingFormatted = rating ? rating.toFixed(1) : null;

            // Extract cross-relations (Anime <-> Manga)
            const relations = (media.relations?.edges || []).map(edge => ({
              relationType: edge.relationType,
              id: edge.node.id,
              title: edge.node.title,
              type: edge.node.type,
              format: edge.node.format,
              status: edge.node.status,
              coverImage: edge.node.coverImage?.large || edge.node.coverImage?.extraLarge || null,
              bannerImage: edge.node.bannerImage || null
            }));

            // Find specific smart links
            const relatedAnime = relations.find(r => r.type === 'ANIME') || null;
            const relatedManga = relations.find(r => r.type === 'MANGA') || null;

            const result = {
              id: media.id,
              title: media.title,
              bannerImage: media.bannerImage || null,
              coverImage: media.coverImage || null,
              averageScore: media.averageScore || null,
              rating,
              ratingFormatted,
              genres: media.genres || [],
              description: media.description || '',
              status: media.status || '',
              format: media.format || '',
              episodes: media.episodes || null,
              chapters: media.chapters || null,
              relations,
              relatedAnime,
              relatedManga
            };
            setCache(cacheKey, result, 24 * 60 * 60 * 1000); // 24 hours
            return resolve(result);
          }
          resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.write(postData);
    req.end();
  });
}

async function fetchAniListAnimeFeed(options = {}) {
  const { sort = ['TRENDING_DESC'], season, seasonYear, format, search, genre, limit = 24 } = options;
  const cacheKey = `anime_feed_${JSON.stringify(options)}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      query: ANILIST_ANIME_PAGE_QUERY,
      variables: {
        page: 1,
        perPage: limit,
        sort,
        season,
        seasonYear,
        format,
        search: search ? cleanAniListTitle(search) : undefined,
        genre
      }
    });

    const req = https.request({
      hostname: 'graphql.anilist.co',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Yomikomi/2.0 (Personal Manga & Anime Platform)'
      },
      timeout: 7000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const rawList = json.data?.Page?.media || [];
          const normalized = rawList.map(item => {
            const rating = typeof item.averageScore === 'number' ? Math.round((item.averageScore / 10) * 10) / 10 : null;
            const relations = (item.relations?.edges || []).map(edge => ({
              relationType: edge.relationType,
              id: edge.node.id,
              title: edge.node.title,
              type: edge.node.type,
              format: edge.node.format
            }));
            const relatedManga = relations.find(r => r.type === 'MANGA') || null;

            return {
              id: item.id,
              mediaType: 'anime',
              title: item.title.romaji || item.title.english || item.title.native || 'Anime',
              titleObj: item.title,
              coverUrl: item.coverImage?.extraLarge || item.coverImage?.large || 'https://placehold.co/300x420/1e2025/ffffff?text=Anime',
              bannerUrl: item.bannerImage || null,
              rating: rating ? `⭐ ${rating.toFixed(1)}` : null,
              averageScore: item.averageScore,
              status: item.status || 'ONGOING',
              episodes: item.episodes || null,
              latestEpisode: item.episodes ? `Ep. ${item.episodes} • Sub` : 'Ep. 12 • Sub',
              format: item.format || 'TV',
              genres: item.genres || [],
              description: item.description || '',
              relatedManga
            };
          });

          setCache(cacheKey, normalized, CACHE_TTL.popular);
          resolve(normalized);
        } catch (e) {
          resolve([]);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve([]);
    });
    req.on('error', () => resolve([]));
    req.write(postData);
    req.end();
  });
}

// AniList Metadata & Relations Route
app.get(['/api/anilist', '/api/anilist/banner'], async (req, res) => {
  try {
    const title = req.query.title || req.query.q || '';
    const type = req.query.type || 'MANGA';
    const id = req.query.id || null;
    if (!title && !id) return res.status(400).json({ error: 'Missing title or id parameter' });
    const meta = await fetchAniListGraphQL(title, type, id);
    if (!meta) {
      return res.json({ bannerImage: null, rating: null, ratingFormatted: null, relations: [] });
    }
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Anime Feed Endpoints
app.get('/api/anime/popular', async (req, res) => {
  try {
    const list = await fetchAniListAnimeFeed({ sort: ['TRENDING_DESC', 'POPULARITY_DESC'] });
    res.json({ data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/anime/seasonal', async (req, res) => {
  try {
    const list = await fetchAniListAnimeFeed({ sort: ['POPULARITY_DESC'], format: 'TV' });
    res.json({ data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/anime/latest', async (req, res) => {
  try {
    const list = await fetchAniListAnimeFeed({ sort: ['UPDATED_AT_DESC'] });
    res.json({ data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/anime/movies', async (req, res) => {
  try {
    const list = await fetchAniListAnimeFeed({ format: 'MOVIE', sort: ['POPULARITY_DESC'] });
    res.json({ data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/anime/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q.trim()) return res.json({ data: [] });
    const list = await fetchAniListAnimeFeed({ search: q, limit: 16 });
    res.json({ data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// KOMIKU INDO SCRAPER (ID Indo Scan Provider)
// ==========================================

// 1. Search Komiku
app.get('/api/komiku/search', async (req, res) => {
  try {
    const rawQuery = (req.query.q || req.query.query || '').trim();
    if (!rawQuery) return res.json({ source: 'komiku', total: 0, data: [] });

    const cleanQuery = rawQuery.replace(/[()\[\]'":_]/g, ' ').replace(/\s+/g, ' ').trim();
    const cacheKey = `komiku_search_${cleanQuery.toLowerCase()}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const searchUrl = `https://api.komiku.org/?post_type=manga&s=${encodeURIComponent(cleanQuery)}`;
    const html = await fetchExternalHtml(searchUrl);
    const $ = cheerio.load(html);
    const results = [];

    $('.bge').each((_, el) => {
      const a = $(el).find('a').first();
      const href = a.attr('href') || '';
      const rawTitle = $(el).find('h3, .tt').first().text().trim() || a.attr('title') || '';
      const img = $(el).find('img').first().attr('data-src') || $(el).find('img').first().attr('src') || '';
      const typeRaw = $(el).find('.tpe1_inf, .type').first().text().trim().toLowerCase();
      const lastChapter = $(el).find('.new1, .epx, .lsch').first().text().trim().replace(/awal:\s*/i, '').trim();

      if (href && rawTitle) {
        const cleanHref = href.replace(/\/+$/, '');
        const slug = cleanHref.split('/').pop();
        const type = typeRaw.includes('manhwa') ? 'manhwa' : (typeRaw.includes('manhua') ? 'manhua' : 'manga');
        const title = rawTitle.replace(/^Komik\s*/i, '').trim();

        results.push({
          id: `komiku-${slug}`,
          slug,
          source: 'komiku',
          title,
          coverUrl: img ? `/api/proxy-image?url=${encodeURIComponent(img)}` : '',
          rawCoverUrl: img,
          type,
          lastChapter: lastChapter || undefined
        });
      }
    });

    const response = { source: 'komiku', query: cleanQuery, total: results.length, data: results };
    setCache(cacheKey, response, CACHE_TTL.search);
    res.json(response);
  } catch (err) {
    console.error('Komiku search error:', err.message);
    res.status(500).json({ error: err.message, data: [] });
  }
});

// 2. Latest Releases on Komiku
app.get('/api/komiku/latest', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const cacheKey = `komiku_latest_p${page}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const targetUrl = page > 1 ? `https://komiku.org/page/${page}/` : 'https://komiku.org/';
    const html = await fetchExternalHtml(targetUrl);
    const $ = cheerio.load(html);
    const results = [];

    $('.ls2, .ls4, .ls12').each((_, el) => {
      const a = $(el).find('a').first();
      const href = a.attr('href') || '';
      const rawTitle = $(el).find('h4, h3, .tt').first().text().trim() || a.attr('title') || '';
      const img = $(el).find('img').first().attr('data-src') || $(el).find('img').first().attr('src') || '';
      const latestCh = $(el).find('.epx, .lsch, .chapter').first().text().trim();

      if (href && rawTitle) {
        const cleanHref = href.replace(/\/+$/, '');
        const slug = cleanHref.split('/').pop();
        if (!results.some(r => r.slug === slug)) {
          const title = rawTitle.replace(/^Komik\s*/i, '').trim();
          const tLower = title.toLowerCase();
          const type = tLower.includes('manhwa') ? 'manhwa' : (tLower.includes('manhua') ? 'manhua' : 'manga');
          results.push({
            id: `komiku-${slug}`,
            slug,
            source: 'komiku',
            title,
            coverUrl: img ? `/api/proxy-image?url=${encodeURIComponent(img)}` : '',
            rawCoverUrl: img,
            type,
            lastChapter: latestCh || 'Update'
          });
        }
      }
    });

    const response = { source: 'komiku', page, total: results.length, data: results };
    setCache(cacheKey, response, CACHE_TTL.latest);
    res.json(response);
  } catch (err) {
    console.error('Komiku latest error:', err.message);
    res.status(500).json({ error: err.message, data: [] });
  }
});

// 3. Comic Detail & Chapters from Komiku
app.get('/api/komiku/manga/:slug', async (req, res) => {
  try {
    const slug = req.params.slug.replace(/^komiku-/, '');
    const cacheKey = `komiku_detail_${slug}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const detailUrl = `https://komiku.org/manga/${slug}/`;
    const html = await fetchExternalHtml(detailUrl);
    const $ = cheerio.load(html);

    const rawTitle = $('h1, .entry-title').first().text().replace(/^Komik\s*/i, '').trim();
    const synopsis = $('.desc, #sinopsis, .sinopsis, p.desc').text().replace(/\s+/g, ' ').trim();
    const imgEl = $('.ims img, .thumb img').first();
    const coverRaw = imgEl.attr('data-src') || imgEl.attr('src') || '';

    const genres = [];
    $('.genre li a, ul.genre a, .genre a').each((_, g) => {
      const name = $(g).text().trim();
      if (name && !genres.includes(name)) genres.push(name);
    });

    const statusText = $('table.inftable, .spe').text().toLowerCase();
    const status = statusText.includes('tamat') || statusText.includes('completed') ? 'completed' : 'ongoing';

    const chapters = [];
    $('#Daftar_Chapter tr, .chapter-list tr, table.table tr').each((_, row) => {
      const a = $(row).find('a').first();
      const href = a.attr('href') || '';
      const rawChTitle = a.text().replace(/\s+/g, ' ').trim();
      const dateText = $(row).find('.tgl, .date').text().trim();

      if (href && rawChTitle) {
        const cleanHref = href.replace(/\/+$/, '');
        const chSlug = cleanHref.split('/').pop();
        const numMatch = rawChTitle.match(/chapter\s*([\d.]+)/i) || href.match(/chapter-([\d.]+)/i);
        const number = numMatch ? numMatch[1] : (chapters.length + 1).toString();

        chapters.push({
          id: chSlug,
          number,
          title: `Chapter ${number}`,
          url: href.startsWith('http') ? href : `https://komiku.org${href}`,
          releaseDate: dateText || undefined,
          source: 'komiku',
          language: 'id'
        });
      }
    });

    const result = {
      source: 'komiku',
      data: {
        id: `komiku-${slug}`,
        slug,
        source: 'komiku',
        title: rawTitle || slug,
        coverUrl: coverRaw ? `/api/proxy-image?url=${encodeURIComponent(coverRaw)}` : '',
        rawCoverUrl: coverRaw,
        synopsis: synopsis || 'Tidak ada sinopsis tersedia untuk judul ini.',
        status,
        genres,
        chapters
      }
    };

    setCache(cacheKey, result, CACHE_TTL.manga);
    res.json(result);
  } catch (err) {
    console.error('Komiku manga detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. Chapter Reader Pages from Komiku
app.get(['/api/komiku/chapter-pages', '/api/komiku/chapter/:chapterSlug'], async (req, res) => {
  try {
    let targetUrl = req.query.url;
    if (!targetUrl && req.params.chapterSlug) {
      targetUrl = `https://komiku.org/${req.params.chapterSlug.replace(/^\/+|\/+$/g, '')}/`;
    }
    if (!targetUrl) return res.status(400).json({ error: 'Missing chapter url or slug' });
    if (!targetUrl.startsWith('http')) targetUrl = `https://komiku.org/${targetUrl.replace(/^\/+|\/+$/g, '')}/`;

    const cacheKey = `komiku_pages_${targetUrl}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const html = await fetchExternalHtml(targetUrl);
    const $ = cheerio.load(html);
    const pages = [];

    $('#Baca_Komik img, .main-reading-area img').each((idx, el) => {
      let src = $(el).attr('data-src') || $(el).attr('src') || '';
      if (
        src &&
        !src.includes('iklan') &&
        !src.includes('banner') &&
        !src.includes('promosi') &&
        (src.includes('.webp') || src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png'))
      ) {
        // Rewrite dead/timing-out mirror subdomains (image3, image4, etc) to high-speed image2
        src = src.replace(/^https?:\/\/image\d*\.komiku\.to\//i, 'https://image2.komiku.to/');
        pages.push(`/api/proxy-image?url=${encodeURIComponent(src)}`);
      }
    });

    const result = {
      source: 'komiku',
      url: targetUrl,
      total: pages.length,
      pages
    };

    setCache(cacheKey, result, CACHE_TTL.chapters);
    res.json(result);
  } catch (err) {
    console.error('Komiku chapter pages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// UNIFIED DATA SERVICE LAYER (V2 API)
// ==========================================
let aggregatorService = null;
let handleImageProxyRequest = null;
let localIndoProvider = null;
let consumetProvider = null;

import('./dist/index.js').then(module => {
  aggregatorService = module.aggregatorService;
  handleImageProxyRequest = module.handleImageProxyRequest;
  if (module.LocalIndoProvider) localIndoProvider = new module.LocalIndoProvider();
  if (module.ConsumetProvider) consumetProvider = new module.ConsumetProvider();
  console.log('⚡ Unified Data Service Layer (MangaDex, Indo Mirror, Consumet, AniList) ACTIVE!');
}).catch(err => {
  console.error('Failed to load Unified Service Layer:', err.message);
});

// Image Proxy route (V2 Unified Service Layer fallback)
app.get('/api/v2/proxy/image', (req, res) => {
  if (handleImageProxyRequest) {
    return handleImageProxyRequest(req, res);
  }
  const u = req.query.url;
  if (!u) return res.status(400).end();
  res.redirect(`/api/proxy-image?url=${encodeURIComponent(u)}`);
});

// Stream Embed Proxy: Strips X-Frame-Options and frame-ancestors CSP so video embeds load without restriction
app.get('/api/proxy/stream', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://otakudesu.best/'
      },
      signal: AbortSignal.timeout(8000)
    });
    const html = await response.text();
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    const origin = new URL(targetUrl).origin;
    let modifiedHtml = html;
    if (!modifiedHtml.includes('<base')) {
      modifiedHtml = modifiedHtml.replace('<head>', `<head><base href="${origin}/">`);
    }
    res.send(modifiedHtml);
  } catch (err) {
    res.status(502).send('Stream Proxy Error: ' + err.message);
  }
});

// Multi-Source Search (Promise.allSettled)
app.get('/api/v2/search', async (req, res) => {
  if (!aggregatorService) return res.status(503).json({ error: 'Service initializing' });
  try {
    const q = req.query.q || '';
    const source = req.query.source || 'all';
    if (source === 'all') {
      const results = await aggregatorService.searchAll(q);
      res.json(results);
    } else {
      const provider = aggregatorService.getProvider(source);
      const items = await provider.search(q);
      res.json({ query: q, total: items.length, source, results: items });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Popular / Trending Manga across sources
app.get('/api/v2/popular', async (req, res) => {
  if (!aggregatorService) return res.status(503).json({ error: 'Service initializing' });
  try {
    const type = req.query.type === 'latest' ? 'latest' : 'popular';
    const source = req.query.source || 'mangadex';
    const items = await aggregatorService.getPopularOrLatest(type, source);
    res.json({ type, source, total: items.length, data: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unified Manga Detail with AniList Enrichment
app.get('/api/v2/manga/:source/:id', async (req, res) => {
  if (!aggregatorService) return res.status(503).json({ error: 'Service initializing' });
  try {
    const { source, id } = req.params;
    const detail = await aggregatorService.getDetail(source, id, true);
    res.json({ source, data: detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unified Chapter Reader Pages
app.get('/api/v2/chapter/:source/:id', async (req, res) => {
  if (!aggregatorService) return res.status(503).json({ error: 'Service initializing' });
  try {
    const { source, id } = req.params;
    const pages = await aggregatorService.getChapterPages(source, id);
    res.json({ source, total: pages.length, pages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// EXTERNAL COMIC MIRROR ROUTES (Indo & EN)
// ==========================================
app.get('/api/external/search', async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').trim();
    if (!q) return res.json({ data: [] });
    if (!localIndoProvider) return res.json({ data: [] });
    const items = await localIndoProvider.search(q);
    res.json({
      data: items.map(it => ({
        id: it.id,
        slug: it.slug,
        url: it.slug,
        title: it.title,
        coverUrl: it.coverUrl,
        type: it.type
      }))
    });
  } catch (err) {
    res.json({ data: [], error: err.message });
  }
});

app.get('/api/external/chapters', async (req, res) => {
  try {
    const url = (req.query.url || req.query.slug || '').trim();
    if (!url || !localIndoProvider) return res.json({ chapters: [] });
    const detail = await localIndoProvider.getDetailAndChapters(url);
    res.json({
      title: detail.title,
      chapters: (detail.chapters || []).map(ch => ({
        id: ch.id,
        url: ch.id,
        number: ch.number,
        title: ch.title,
        releaseDate: ch.releaseDate,
        source: 'bacakomik',
        language: 'id'
      }))
    });
  } catch (err) {
    res.json({ chapters: [], error: err.message });
  }
});

app.get('/api/external/chapter-pages', async (req, res) => {
  try {
    const url = (req.query.url || req.query.slug || '').trim();
    if (!url || !localIndoProvider) return res.json({ pages: [] });
    const pages = await localIndoProvider.getChapterImages(url);
    res.json({
      pages: pages.map(p => p.proxiedUrl || p.imageUrl)
    });
  } catch (err) {
    res.json({ pages: [], error: err.message });
  }
});

app.get('/api/external/en/search', async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').trim();
    if (!q) return res.json({ data: [] });
    if (!consumetProvider) return res.json({ data: [] });
    const items = await consumetProvider.search(q);
    res.json({
      data: items.map(it => ({
        id: it.id,
        slug: it.slug,
        url: it.slug,
        title: it.title,
        coverUrl: it.coverUrl,
        type: it.type
      }))
    });
  } catch (err) {
    res.json({ data: [], error: err.message });
  }
});

app.get('/api/external/en/chapters', async (req, res) => {
  try {
    const url = (req.query.url || req.query.slug || '').trim();
    if (!url || !consumetProvider) return res.json({ chapters: [] });
    const detail = await consumetProvider.getDetailAndChapters(url);
    res.json({
      title: detail.title,
      chapters: (detail.chapters || []).map(ch => ({
        id: ch.id,
        url: ch.id,
        number: ch.number,
        title: ch.title,
        source: 'mangapill',
        language: 'en'
      }))
    });
  } catch (err) {
    res.json({ chapters: [], error: err.message });
  }
});

app.get('/api/external/en/chapter-pages', async (req, res) => {
  try {
    const url = (req.query.url || req.query.slug || '').trim();
    if (!url || !consumetProvider) return res.json({ pages: [] });
    const pages = await consumetProvider.getChapterImages(url);
    res.json({
      pages: pages.map(p => p.proxiedUrl || p.imageUrl)
    });
  } catch (err) {
    res.json({ pages: [], error: err.message });
  }
});

// ==========================================
// COMICK PROVIDER (Consumet ComicK Engine)
// ==========================================
let comickProvider = null;
try {
  const { MANGA } = require('@consumet/extensions');
  if (MANGA?.ComicK) {
    comickProvider = new MANGA.ComicK();
    console.log('⚡ ComicK Consumet Provider ACTIVE!');
  }
} catch (e) {
  console.warn('Consumet ComicK init failed:', e.message);
}

app.get('/api/comick/search', async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').trim();
    if (!q) return res.json({ data: [] });
    if (!comickProvider) return res.json({ data: [] });

    const cacheKey = `comick_search_${q.toLowerCase()}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const searchResult = await comickProvider.search(q);
    const rawList = searchResult.results || (Array.isArray(searchResult) ? searchResult : []);
    const items = rawList.map(item => ({
      id: `comick-${item.id}`,
      slug: item.id,
      title: item.title,
      coverUrl: item.image,
      source: 'comick',
      mediaType: 'manga'
    }));

    const payload = { source: 'comick', total: items.length, data: items };
    setCache(cacheKey, payload, CACHE_TTL.search);
    res.json(payload);
  } catch (err) {
    console.error('ComicK search error:', err.message);
    res.json({ data: [], error: err.message });
  }
});

app.get('/api/comick/manga/:slug', async (req, res) => {
  try {
    const slug = req.params.slug.replace(/^comick-/, '');
    if (!comickProvider) return res.status(503).json({ error: 'ComicK provider not available' });

    const cacheKey = `comick_manga_${slug}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const info = await comickProvider.fetchMangaInfo(slug);
    const chapters = (info.chapters || []).map((ch, idx) => {
      const chNum = ch.chapterNumber ? parseFloat(ch.chapterNumber) : (idx + 1);
      const chNumStr = String(ch.chapterNumber || idx + 1);

      // Clean title: If title equals chapter number or is empty, normalize to "Chapter X"
      const rawTitle = (ch.title || '').trim();
      const isRedundant = !rawTitle || 
        rawTitle === chNumStr || 
        rawTitle.toLowerCase() === `chapter ${chNumStr}` ||
        /^\d+(\.\d+)?$/.test(rawTitle);

      const hasArabic = /[\u0600-\u06FF]/.test(rawTitle);

      let cleanTitle = `Chapter ${chNumStr}`;
      let subTitle = '';
      if (!isRedundant && !hasArabic) {
        subTitle = rawTitle;
        cleanTitle = `Chapter ${chNumStr}: ${rawTitle}`;
      }

      return {
        id: ch.id,
        number: isNaN(chNum) ? (idx + 1) : chNum,
        chapterNumStr: chNumStr,
        title: cleanTitle,
        subTitle,
        releaseDate: '',
        language: ch.lang || 'en',
        source: 'comick',
        scanlationGroup: ''
      };
    });

    const payload = {
      id: `comick-${slug}`,
      slug,
      title: info.title,
      coverUrl: info.image,
      synopsis: info.description || '',
      status: info.status || 'ONGOING',
      chapters
    };

    setCache(cacheKey, payload, CACHE_TTL.chapters);
    res.json(payload);
  } catch (err) {
    console.error(`ComicK detail error for ${req.params.slug}:`, err.message);
    res.status(500).json({ error: err.message, chapters: [] });
  }
});

app.get('/api/comick/chapter-pages', async (req, res) => {
  try {
    const chapterId = (req.query.chapterId || req.query.id || req.query.url || '').trim();
    if (!chapterId) return res.json({ pages: [] });
    if (!comickProvider) return res.status(503).json({ error: 'ComicK provider not available' });

    const cacheKey = `comick_pages_${chapterId}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const pagesResult = await comickProvider.fetchChapterPages(chapterId);
    const rawPages = (pagesResult || [])
      .map(p => (p && typeof p === 'object' ? (p.img || p.imageUrl || p.url) : p))
      .filter(Boolean);
    // Proxy through /api/proxy-image so cdn1.comicknew.pictures receives Referer: https://comick.art/ and returns 200 OK
    const pages = rawPages.map(url => `/api/proxy-image?url=${encodeURIComponent(url)}`);
    const payload = { pages, total: pages.length };

    setCache(cacheKey, payload, CACHE_TTL.atHome);
    res.json(payload);
  } catch (err) {
    console.error('ComicK chapter pages error:', err.message);
    res.status(500).json({ error: err.message, pages: [] });
  }
});

// ==========================================
// ANIME API ROUTES
// ==========================================
let animeAggregator = null;
let aniZipSvc = null;
let fetchAnimeMetaFallback = null;
let animeIndoProv = null;
let animeGlobalProv = null;

// Dynamically load anime modules from compiled TypeScript
import('./dist/index.js').then(mod => {
  if (mod.animeAggregatorService) animeAggregator = mod.animeAggregatorService;
  if (mod.aniZipService) aniZipSvc = mod.aniZipService;
  if (mod.fetchAnimeMetadataWithFallback) fetchAnimeMetaFallback = mod.fetchAnimeMetadataWithFallback;
  if (mod.animeIndoProvider) animeIndoProv = mod.animeIndoProvider;
  if (mod.animeGlobalProvider) animeGlobalProv = mod.animeGlobalProvider;
  console.log('🎬 Anime Service Layer (AniList + Jikan + AniZip + Indo + Global) ACTIVE!');
}).catch(err => {
  console.error('Failed to load Anime Service Layer:', err.message);
});

// Helper: AniList GraphQL query for anime
const ANILIST_GQL = 'https://graphql.anilist.co';

async function fetchAniListAnime(query, variables = {}) {
  try {
    const resp = await fetch(ANILIST_GQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8000)
    });
    const json = await resp.json();
    return json?.data || null;
  } catch (e) {
    console.warn('[AniList GQL] Request failed:', e.message);
    return null;
  }
}

// Helper: Jikan v4 fallback for anime search/trending
async function fetchJikanAnime(endpoint) {
  try {
    const resp = await fetch(`https://api.jikan.moe/v4${endpoint}`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Yomikomi/2.0' }
    });
    return await resp.json();
  } catch (e) {
    console.warn('[Jikan] Request failed:', e.message);
    return null;
  }
}

// Helper: AniZip mappings + episode thumbnails
async function fetchAniZipMappings(anilistId) {
  if (!anilistId) return null;
  const cacheKey = `anizip_server_${anilistId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  try {
    const resp = await fetch(`https://api.ani.zip/mappings?anilist_id=${encodeURIComponent(anilistId)}`, {
      signal: AbortSignal.timeout(2500),
      headers: { 'User-Agent': 'Yomikomi/2.0 (Anime Stream & Reader)' }
    });
    const data = await resp.json();
    if (data) {
      setCache(cacheKey, data, 24 * 60 * 60 * 1000);
    }
    return data;
  } catch (e) {
    console.warn('[AniZip] Fetch failed for', anilistId, e.message);
    return null;
  }
}

// Helper: Map AniList media to frontend-compatible format
function mapAniListMedia(media) {
  if (!media) return null;
  const title = media.title || {};
  return {
    id: media.id,
    mediaType: 'anime',
    title: title.romaji || title.english || title.native || 'Unknown',
    titleObj: title,
    coverUrl: media.coverImage?.extraLarge || media.coverImage?.large || '',
    bannerUrl: media.bannerImage || null,
    rating: media.averageScore ? `⭐ ${(media.averageScore / 10).toFixed(1)}` : null,
    averageScore: media.averageScore || null,
    status: media.status || 'UNKNOWN',
    episodes: media.episodes || null,
    format: media.format || 'TV',
    genres: media.genres || [],
    description: (media.description || '').replace(/<[^>]*>/g, ' ').trim(),
    season: media.season || null,
    seasonYear: media.seasonYear || null,
    relatedManga: null
  };
}

// 1. Trending / Popular Anime
app.get('/api/anime/trending', async (req, res) => {
  try {
    const cacheKey = 'anime_trending_v2';
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    if (cached) return res.json(cached);

    const query = `
      query ($page: Int, $perPage: Int, $sort: [MediaSort]) {
        Page(page: $page, perPage: $perPage) {
          media(type: ANIME, sort: $sort, isAdult: false) {
            id title { romaji english native }
            bannerImage coverImage { extraLarge large color }
            description(asHtml: false) averageScore genres status format episodes
            season seasonYear nextAiringEpisode { episode airingAt }
            relations { edges { relationType node { id title { romaji english } type format coverImage { large } } } }
          }
        }
      }
    `;

    const aniData = await fetchAniListAnime(query, { page: 1, perPage: 24, sort: ['TRENDING_DESC'] });
    let results = [];

    if (aniData?.Page?.media) {
      results = aniData.Page.media.map(mapAniListMedia).filter(Boolean);
    }

    // Jikan v4 fallback if AniList returned nothing
    if (results.length === 0) {
      const jikan = await fetchJikanAnime('/top/anime?filter=airing&limit=24');
      if (jikan?.data) {
        results = jikan.data.map(item => ({
          id: item.mal_id,
          mediaType: 'anime',
          title: item.title || item.title_english || 'Unknown',
          titleObj: { romaji: item.title, english: item.title_english, native: item.title_japanese },
          coverUrl: item.images?.webp?.large_image_url || item.images?.jpg?.large_image_url || '',
          bannerUrl: item.images?.webp?.large_image_url || null,
          rating: item.score ? `⭐ ${item.score.toFixed(1)}` : null,
          averageScore: item.score ? Math.round(item.score * 10) : null,
          status: item.status === 'Currently Airing' ? 'RELEASING' : 'FINISHED',
          episodes: item.episodes || null,
          format: item.type || 'TV',
          genres: (item.genres || []).map(g => g.name),
          description: (item.synopsis || '').substring(0, 500),
          relatedManga: null
        }));
      }
    }

    const payload = { data: results, total: results.length };
    setCache(cacheKey, payload, CACHE_TTL.popular);
    res.json(payload);
  } catch (error) {
    console.error('Error fetching trending anime:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 2. Seasonal Anime
app.get('/api/anime/seasonal', async (req, res) => {
  try {
    const now = new Date();
    const year = req.query.year || now.getFullYear();
    const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
    const season = req.query.season || seasons[Math.floor(now.getMonth() / 3)];

    const cacheKey = `anime_seasonal_${year}_${season}`;
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200');
    if (cached) return res.json(cached);

    const query = `
      query ($season: MediaSeason, $seasonYear: Int, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: [POPULARITY_DESC], isAdult: false) {
            id title { romaji english native }
            bannerImage coverImage { extraLarge large color }
            description(asHtml: false) averageScore genres status format episodes
            season seasonYear
          }
        }
      }
    `;

    const aniData = await fetchAniListAnime(query, { season, seasonYear: parseInt(year), page: 1, perPage: 24 });
    let results = [];

    if (aniData?.Page?.media) {
      results = aniData.Page.media.map(mapAniListMedia).filter(Boolean);
    }

    const payload = { data: results, total: results.length, season, year: parseInt(year) };
    setCache(cacheKey, payload, CACHE_TTL.popular);
    res.json(payload);
  } catch (error) {
    console.error('Error fetching seasonal anime:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 3. Search Anime
app.get('/api/anime/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q.trim()) return res.json({ data: [], total: 0 });

    const cacheKey = `anime_search_${q.toLowerCase().trim()}`;
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    if (cached) return res.json(cached);

    const query = `
      query ($search: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(type: ANIME, search: $search, sort: [SEARCH_MATCH], isAdult: false) {
            id title { romaji english native }
            bannerImage coverImage { extraLarge large color }
            description(asHtml: false) averageScore genres status format episodes
          }
        }
      }
    `;

    const aniData = await fetchAniListAnime(query, { search: q.trim(), page: 1, perPage: 20 });
    let results = [];

    if (aniData?.Page?.media) {
      results = aniData.Page.media.map(mapAniListMedia).filter(Boolean);
    }

    // Jikan v4 fallback
    if (results.length === 0) {
      const jikan = await fetchJikanAnime(`/anime?q=${encodeURIComponent(q.trim())}&limit=20`);
      if (jikan?.data) {
        results = jikan.data.map(item => ({
          id: item.mal_id,
          mediaType: 'anime',
          title: item.title || 'Unknown',
          titleObj: { romaji: item.title, english: item.title_english, native: item.title_japanese },
          coverUrl: item.images?.webp?.large_image_url || item.images?.jpg?.large_image_url || '',
          bannerUrl: null,
          rating: item.score ? `⭐ ${item.score.toFixed(1)}` : null,
          averageScore: item.score ? Math.round(item.score * 10) : null,
          status: item.status === 'Currently Airing' ? 'RELEASING' : 'FINISHED',
          episodes: item.episodes || null,
          format: item.type || 'TV',
          genres: (item.genres || []).map(g => g.name),
          description: (item.synopsis || '').substring(0, 500),
          relatedManga: null
        }));
      }
    }

    const payload = { data: results, total: results.length, query: q };
    setCache(cacheKey, payload, CACHE_TTL.search);
    res.json(payload);
  } catch (error) {
    console.error('Error searching anime:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 4. Anime Detail by AniList ID (with AniZip episode thumbnails & related manga cross-link)
app.get('/api/anime/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `anime_detail_${id}`;
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200');
    if (cached) return res.json(cached);

    // Fetch full detail from AniList
    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id title { romaji english native }
          bannerImage coverImage { extraLarge large color }
          description(asHtml: false) averageScore genres status format episodes duration
          season seasonYear startDate { year month day } endDate { year month day }
          studios { nodes { name isAnimationStudio } }
          nextAiringEpisode { episode airingAt }
          relations { edges { relationType node { id title { romaji english native } type format status coverImage { large extraLarge } } } }
        }
      }
    `;

    let media = null;
    const [aniData, aniZipData] = await Promise.all([
      fetchAniListAnime(query, { id: parseInt(id) }),
      fetchAniZipMappings(id)
    ]);
    if (aniData?.Media) {
      media = aniData.Media;
    }

    // Jikan fallback if AniList fails
    if (!media) {
      const jikan = await fetchJikanAnime(`/anime/${id}/full`);
      if (jikan?.data) {
        const item = jikan.data;
        media = {
          id: item.mal_id,
          title: { romaji: item.title, english: item.title_english, native: item.title_japanese },
          bannerImage: item.images?.webp?.large_image_url,
          coverImage: { extraLarge: item.images?.webp?.large_image_url, large: item.images?.webp?.image_url },
          description: item.synopsis || '',
          averageScore: item.score ? Math.round(item.score * 10) : null,
          genres: (item.genres || []).map(g => g.name),
          status: item.status === 'Currently Airing' ? 'RELEASING' : 'FINISHED',
          format: item.type || 'TV',
          episodes: item.episodes || null,
          duration: item.duration || null,
          relations: { edges: [] }
        };
      }
    }

    if (!media) {
      return res.status(404).json({ error: 'Anime not found' });
    }

    const mapped = mapAniListMedia(media);

    // Extract related manga for cross-link
    if (media.relations?.edges) {
      const mangaRel = media.relations.edges.find(e =>
        e.node?.type === 'MANGA' && ['SOURCE', 'ADAPTATION', 'PARENT'].includes(e.relationType)
      );
      if (mangaRel) {
        mapped.relatedManga = {
          relationType: mangaRel.relationType,
          id: mangaRel.node.id,
          title: mangaRel.node.title,
          type: mangaRel.node.type,
          format: mangaRel.node.format,
          coverUrl: mangaRel.node.coverImage?.large || mangaRel.node.coverImage?.extraLarge || ''
        };
      }
    }
    const aniZipEpisodes = aniZipData?.episodes || {};
    const totalEps = mapped.episodes || Object.keys(aniZipEpisodes).filter(k => k !== '0').length || 12;

    // Build enriched episode list
    const episodesList = [];
    for (let i = 1; i <= totalEps; i++) {
      const epKey = String(i);
      const zipEp = aniZipEpisodes[epKey];
      const epTitle = zipEp?.title?.en || zipEp?.title?.['x-jat'] || zipEp?.title?.ja || `Episode ${i}`;
      const epThumbnail = zipEp?.image || mapped.bannerUrl || mapped.coverUrl || '';
      const epOverview = zipEp?.overview || '';
      const epAirDate = zipEp?.airDate || zipEp?.airdate || null;

      episodesList.push({
        episodeNumber: i,
        title: epTitle,
        thumbnail: epThumbnail,
        overview: epOverview,
        airDate: epAirDate,
        duration: media.duration ? `${media.duration} min` : '24 min',
        servers: []
      });
    }

    // Attach AniZip mappings
    mapped.mappings = aniZipData?.mappings || null;
    mapped.episodesList = episodesList;
    mapped.totalEpisodes = totalEps;

    // Add studio info
    if (media.studios?.nodes) {
      mapped.studios = media.studios.nodes
        .filter(s => s.isAnimationStudio)
        .map(s => s.name);
    }

    const payload = { data: mapped };
    setCache(cacheKey, payload, CACHE_TTL.manga);
    res.json(payload);
  } catch (error) {
    console.error(`Error fetching anime ${req.params.id}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 5. Anime Stream Resolver - Get live streaming servers for a specific episode
app.get('/api/anime/stream/:id/:ep', async (req, res) => {
  try {
    const { id, ep } = req.params;
    const epNum = parseInt(ep, 10) || 1;

    const cacheKey = `anime_stream_${id}_ep${epNum}`;
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    if (cached) return res.json(cached);

    // Get anime title and AniZip mappings for scraper queries & stream resolution
    let animeTitle = '';
    let malId = null;
    let tmdbId = null;

    const detailCacheKey = `anime_detail_${id}`;
    const cachedDetail = getCache(detailCacheKey);
    if (cachedDetail?.data) {
      animeTitle = cachedDetail.data.title || cachedDetail.data.titleObj?.romaji || '';
      malId = cachedDetail.data.mappings?.mal_id || null;
      tmdbId = cachedDetail.data.mappings?.themoviedb_id || null;
    }

    if (!animeTitle || !malId || !tmdbId) {
      const [titleData, zipData] = await Promise.all([
        fetchAniListAnime(`query ($id: Int) { Media(id: $id, type: ANIME) { title { romaji english } } }`, { id: parseInt(id) }),
        fetchAniZipMappings(id)
      ]);
      if (titleData?.Media?.title) {
        animeTitle = titleData.Media.title.romaji || titleData.Media.title.english || animeTitle;
      }
      if (zipData?.mappings) {
        malId = zipData.mappings.mal_id || malId;
        tmdbId = zipData.mappings.themoviedb_id || tmdbId;
      }
    }

    let servers = [];

    // Try unified aggregator from compiled TypeScript service with 3.5s budget
    if (animeAggregator && animeTitle) {
      try {
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve([]), 3500));
        servers = await Promise.race([
          animeAggregator.getUnifiedEpisodeStreams(animeTitle, epNum, { malId, tmdbId }),
          timeoutPromise
        ]);
      } catch (aggErr) {
        console.warn('[Stream] Aggregator failed, using direct providers:', aggErr.message);
      }
    }

    // High performance real anime embeds if scrapers returned nothing
    if (servers.length === 0) {
      const safeTitle = encodeURIComponent(animeTitle || 'anime');

      if (tmdbId) {
        servers.push({
          id: 'server-multiembed-tmdb',
          name: 'Server 1 (FHD AutoStream • Super Lancar)',
          type: 'iframe',
          url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=1&e=${epNum}`,
          quality: '1080p',
          isSubIndo: false
        });
        servers.push({
          id: 'server-autoembed-tmdb',
          name: `Server ${servers.length + 1} (Fast Cloud CDN)`,
          type: 'iframe',
          url: `https://autoembed.co/tv/tmdb/${tmdbId}-1-${epNum}`,
          quality: 'Auto',
          isSubIndo: false
        });
        servers.push({
          id: 'server-2embed-tmdb',
          name: `Server ${servers.length + 1} (Direct Cloud 720p)`,
          type: 'iframe',
          url: `https://2embed.cc/embedtv/${tmdbId}&s=1&e=${epNum}`,
          quality: '720p',
          isSubIndo: false
        });
      }

      if (malId) {
        servers.push({
          id: 'server-vidsrc-mal',
          name: `Server ${servers.length + 1} (VidSrc Anime • Multi-Sub)`,
          type: 'iframe',
          url: `https://vidsrc.pm/embed/anime?mal=${malId}&ep=${epNum}`,
          quality: '1080p',
          isSubIndo: false
        });
      }

      if (servers.length === 0) {
        servers.push({
          id: 'server-embed-title',
          name: 'Server 1 (FHD AutoStream • Super Lancar)',
          type: 'iframe',
          url: `https://multiembed.mov/?video_id=${safeTitle}&s=1&e=${epNum}`,
          quality: '1080p',
          isSubIndo: false
        });
      }
    }

    const payload = { animeId: id, episode: epNum, title: animeTitle, servers };
    setCache(cacheKey, payload, 30 * 60 * 1000);
    res.json(payload);
  } catch (error) {
    console.error(`Error fetching anime stream ${req.params.id} ep${req.params.ep}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Fallback SPA route (Express 5 compatible)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 Yomikomi Multi-Source Reader Running!`);
    console.log(`📡 Local URL: http://localhost:${PORT}`);
    console.log(`⚡ Speed Optimizations: Keep-Alive + Disk Cache ACTIVE`);
    console.log(`🔄 Multi-Source Scraper: Bacakomik Bridge ACTIVE`);
    console.log(`===============================================`);
  });
}

module.exports = app;
