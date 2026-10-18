const express = require('express');
const https = require('https');
const http = require('http');
const dns = require('dns');
const path = require('path');
const fs = require('fs');

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

// Custom DNS lookup with dual IP rotation to bypass ISP DNS hijacking and prevent DDoS Guard throttling
const MANGADEX_IPS = [
  { address: '45.129.229.1', family: 4 },
  { address: '45.129.229.2', family: 4 }
];
let ipCounter = 0;

function customLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (hostname === 'api.mangadex.org' || hostname === 'uploads.mangadex.org') {
    if (options && options.all) {
      return callback(null, MANGADEX_IPS);
    }
    // Round-robin between the two MangaDex nodes
    const ip = MANGADEX_IPS[ipCounter++ % MANGADEX_IPS.length].address;
    return callback(null, ip, 4);
  }
  return dns.lookup(hostname, options, callback);
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
    if (cached) return res.json(cached);

    const data = await fetchMangaDex('/manga?limit=24&includes[]=cover_art&includes[]=author&includes[]=artist&order[followedCount]=desc&contentRating[]=safe&contentRating[]=suggestive');
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

    const cacheKey = `search_${query}_${limit}_${tag}_${lang}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    let endpoint = `/manga?limit=${limit}&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`;
    if (query) endpoint += `&title=${encodeURIComponent(query)}`;
    if (tag) endpoint += `&includedTags[]=${encodeURIComponent(tag)}`;

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

// 4. Manga Details by ID
app.get('/api/manga/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `manga_${id}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const data = await fetchMangaDex(`/manga/${id}?includes[]=cover_art&includes[]=author&includes[]=artist`);
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
      const endpoint = `/manga/${id}/feed?limit=${batchLimit}&offset=${offset}&includes[]=scanlation_group&order[chapter]=${order}&order[volume]=${order}&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica${langParams}`;
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
    const cacheKey = `athome_v3_${chapterId}`;
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

    // Primary URLs: prioritize uploads.mangadex.org data-saver for stability, speed, and 70% smaller size
    const dataSaverPages = dataSaverFiles.map(fn => `${cdnBase}/data-saver/${hash}/${fn}`);
    const originalPages = originalFiles.map(fn => `${cdnBase}/data/${hash}/${fn}`);

    // Home volunteer node URLs
    const homeDataSaverPages = dataSaverFiles.map(fn => `${homeBase}/data-saver/${hash}/${fn}`);
    const homeOriginalPages = originalFiles.map(fn => `${homeBase}/data/${hash}/${fn}`);

    // Rich page objects with multi-tier fallback URLs
    const pageDetails = [];
    for (let i = 0; i < totalPages; i++) {
      const dsFn = dataSaverFiles[i] || originalFiles[i];
      const origFn = originalFiles[i] || dataSaverFiles[i];
      pageDetails.push({
        pageNumber: i + 1,
        // High stability CDN
        dataSaverUrl: `${cdnBase}/data-saver/${hash}/${dsFn}`,
        originalUrl: `${cdnBase}/data/${hash}/${origFn}`,
        // MangaDex@Home volunteer node
        homeDataSaverUrl: `${homeBase}/data-saver/${hash}/${dsFn}`,
        homeOriginalUrl: `${homeBase}/data/${hash}/${origFn}`
      });
    }

    const result = {
      result: data.result,
      baseUrl: homeBase,
      cdnBase: cdnBase,
      hash: hash,
      pages: originalPages,
      dataSaverPages: dataSaverPages,
      homePages: homeOriginalPages,
      homeDataSaverPages: homeDataSaverPages,
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

// 7. Cover Art Proxy with LOCAL DISK CACHING (Instant 0ms on repeat views)
app.get('/api/cover/:mangaId/:filename', (req, res) => {
  const { mangaId, filename } = req.params;
  const safeFilename = `${mangaId}_${filename}`;
  const diskPath = path.join(COVERS_CACHE_DIR, safeFilename);

  // If already on disk, serve immediately!
  if (fs.existsSync(diskPath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return fs.createReadStream(diskPath).pipe(res);
  }

  // Otherwise, fetch from MangaDex, save to disk, and stream to client
  const targetPath = `/covers/${mangaId}/${filename}`;
  const options = {
    hostname: 'uploads.mangadex.org',
    port: 443,
    path: targetPath,
    method: 'GET',
    agent: httpsAgent,
    headers: {
      'User-Agent': 'MangaDexPersonalReader/1.0',
      'Referer': 'https://mangadex.org/'
    }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    if (proxyRes.statusCode !== 200) {
      return res.status(proxyRes.statusCode).end();
    }

    res.writeHead(200, {
      'Content-Type': proxyRes.headers['content-type'] || 'image/jpeg',
      'Cache-Control': 'public, max-age=604800, immutable'
    });

    const fileStream = fs.createWriteStream(diskPath);
    proxyRes.pipe(fileStream);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`Error proxying cover ${filename}:`, err.message);
    res.status(502).end();
  });

  proxyReq.end();
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

// Strengthened Image Proxy to bypass hotlink referer protection with 12s AbortController timeout
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

  try {
    const parsed = new URL(imageUrl);

    // Smart Referer determination:
    // If domain is mangadex.org or mangadex.network -> https://mangadex.org/
    // Otherwise -> origin of the image URL
    let referer = req.query.referer;
    if (!referer) {
      const host = parsed.hostname.toLowerCase();
      if (host.includes('mangadex.org') || host.includes('mangadex.network')) {
        referer = 'https://mangadex.org/';
      } else if (host.includes('readdetectiveconan.com') || host.includes('mangapill.com')) {
        referer = 'https://mangapill.com/';
      } else if (host.includes('komikindo.ch') || host.includes('komikindo')) {
        referer = 'https://komikindo.ch/';
      } else {
        referer = `${parsed.protocol}//${parsed.host}/`;
      }
    }

    // 12-second AbortController timeout to prevent hung proxy connections
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 12000);

    let response;
    let fallbackStream = null;

    try {
      response = await fetch(imageUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Referer': referer,
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
        }
      });
    } catch (fetchErr) {
      // If uploads.mangadex.org failed due to DNS poisoning (common in ISP blocking) or TLS alert, fallback to real CDN IP with SNI
      if (parsed.hostname === 'uploads.mangadex.org') {
        response = await new Promise((resolve, reject) => {
          const reqOpts = {
            hostname: '45.129.229.1',
            path: parsed.pathname + parsed.search,
            headers: {
              'Host': 'uploads.mangadex.org',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Referer': referer
            },
            servername: 'uploads.mangadex.org',
            method: 'GET'
          };
          const httpsReq = https.request(reqOpts, (proxyRes) => {
            fallbackStream = proxyRes;
            resolve({
              ok: proxyRes.statusCode >= 200 && proxyRes.statusCode < 300,
              status: proxyRes.statusCode,
              headers: {
                get: (k) => proxyRes.headers[k.toLowerCase()]
              }
            });
          });
          httpsReq.on('error', reject);
          controller.signal.addEventListener('abort', () => httpsReq.destroy());
          httpsReq.end();
        });
      } else {
        throw fetchErr;
      }
    }

    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream error ${response.status}` });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': '*'
    });

    if (fallbackStream) {
      fallbackStream.pipe(res);
    } else {
      const { Readable } = require('stream');
      if (response.body && typeof Readable.fromWeb === 'function') {
        Readable.fromWeb(response.body).pipe(res);
      } else {
        const buf = Buffer.from(await response.arrayBuffer());
        res.end(buf);
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[Proxy Timeout] Aborted image request after 12s: ${imageUrl}`);
      return res.status(504).json({ error: 'Gateway Timeout: upstream image request exceeded 12s' });
    }
    console.error('Image proxy error:', err.message);
    res.status(502).json({ error: 'Bad Gateway: failed to fetch image' });
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
