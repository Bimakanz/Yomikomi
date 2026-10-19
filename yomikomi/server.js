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
    res.status(500).json({ error: error.message });
  }
});

// 3. Search Manga
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const limit = parseInt(req.query.limit) || 20;
    const tag = req.query.tag || '';
    const lang = req.query.lang || '';
    const order = req.query.order || (tag ? 'followedCount' : '');

    const cacheKey = `search_${query}_${limit}_${tag}_${lang}_${order}`;
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    if (cached) return res.json(cached);

    let endpoint = `/manga?limit=${limit}&includes[]=cover_art&includes[]=author`;
    
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
    res.status(500).json({ error: error.message });
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
          const wsrvRes = await fetch(wsrvUrl, { signal: AbortSignal.timeout(5000) });
          if (wsrvRes.ok) {
            const arrBuf = await wsrvRes.arrayBuffer();
            coverData = { buffer: Buffer.from(arrBuf), contentType: 'image/jpeg' };
          }
        } catch (e3) {}
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

      // Fallback 3: Clean placeholder image
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

      // Public Edge Proxy fallback (wsrv.nl)
      candidates.push({
        url: `https://wsrv.nl/?url=${encodeURIComponent(imageUrl)}&we=1&n=-1`,
        referer: ''
      });
    } else {
      // Non-MangaDex mirrors (Komiku, Mangapill, etc.)
      // Retry candidate with clean empty Referer (bypasses strict CDN referer validations)
      candidates.push({ url: imageUrl, referer: '' });
      // Edge CDN fallback
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

        // Discard MangaDex anti-hotlink placeholder banner (~59480 bytes)
        const isPlaceholderBanner = isMangaDex && buf && buf.length >= 59400 && buf.length <= 59600;
        if (isPlaceholderBanner) {
          console.warn(`[Proxy Guard] Intercepted anti-hotlink banner (${buf.length} bytes) for ${cand.url}. Proceeding to next candidate...`);
          continue;
        }

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
// ANILIST GRAPHQL API (Hero Banner & Rating)
// ==========================================
const ANILIST_QUERY = `
query ($search: String) {
  Media (search: $search, type: MANGA) {
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
  }
}
`;

function cleanAniListTitle(title) {
  if (!title) return '';
  return title
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[-_:]/g, ' ')
    .replace(/\s+(manga|manhwa|manhua|bahasa indonesia|indo|chapter\s*\d+).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchAniListGraphQL(title) {
  const cleanTitle = cleanAniListTitle(title);
  if (!cleanTitle) return null;

  const cacheKey = `anilist_${cleanTitle.toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      query: ANILIST_QUERY,
      variables: { search: cleanTitle }
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
        'User-Agent': 'Yomikomi/2.0 (Personal Manga Reader)'
      },
      timeout: 6000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const media = json.data?.Media;
          if (media) {
            const rating = typeof media.averageScore === 'number' ? Math.round((media.averageScore / 10) * 10) / 10 : null;
            const ratingFormatted = rating ? `⭐ ${rating.toFixed(1)}` : null;
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
              status: media.status || ''
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

app.get(['/api/anilist', '/api/anilist/banner'], async (req, res) => {
  try {
    const title = req.query.title || req.query.q || '';
    if (!title) return res.status(400).json({ error: 'Missing title parameter' });
    const meta = await fetchAniListGraphQL(title);
    if (!meta) {
      return res.json({ bannerImage: null, rating: null, ratingFormatted: null });
    }
    res.json(meta);
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
    const cacheKey = 'komiku_latest';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const html = await fetchExternalHtml('https://komiku.org/');
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

    const response = { source: 'komiku', total: results.length, data: results };
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

import('./dist/index.js').then(module => {
  aggregatorService = module.aggregatorService;
  handleImageProxyRequest = module.handleImageProxyRequest;
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
