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
const MANGADEX_POPULAR_SNAPSHOT = [
  {
    id: "a7774250-d070-494f-9260-f8232f35213b",
    type: "manga",
    attributes: {
      title: { en: "Chainsaw Man" },
      description: { en: "Denji's life of poverty is turned upside down when he merges with his pet devil-dog, Pochita!" },
      status: "ongoing",
      contentRating: "suggestive",
      availableTranslatedLanguages: ["en", "id", "ja"]
    },
    relationships: [{ type: "cover_art", attributes: { fileName: "81f9b071-ca36-40e9-b57f-d31e582e0e18.jpg" } }],
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx105778-euxXZEIfDY2u.png",
    source: "mangadex"
  },
  {
    id: "c52b2ce3-7f95-469c-96b0-474fb724fb76",
    type: "manga",
    attributes: {
      title: { en: "Jujutsu Kaisen" },
      description: { en: "Yuji Itadori swallows a cursed talisman and finds himself in the world of Jujutsu Sorcerers." },
      status: "completed",
      contentRating: "safe",
      availableTranslatedLanguages: ["en", "id", "ja"]
    },
    relationships: [{ type: "cover_art", attributes: { fileName: "32eb7a4d-0453-4318-9717-b61ec084f04d.jpg" } }],
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx101517-5nFd8b6zmwCj.jpg",
    source: "mangadex"
  },
  {
    id: "b0b721ff-c388-4486-aa0f-c8b0e921824b",
    type: "manga",
    attributes: {
      title: { en: "Sousou no Frieren" },
      description: { en: "The elf mage Frieren begins a new journey after the hero's party defeated the Demon King." },
      status: "ongoing",
      contentRating: "safe",
      availableTranslatedLanguages: ["en", "id", "ja"]
    },
    relationships: [{ type: "cover_art", attributes: { fileName: "a75871b6-7f1c-4da6-8fcf-ad12b489a5ad.jpg" } }],
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx118586-sI8Owe5Nlq4M.jpg",
    source: "mangadex"
  },
  {
    id: "296cbc31-af1a-4b58-a4ef-02ba508d49a3",
    type: "manga",
    attributes: {
      title: { en: "【OSHI NO KO】" },
      description: { en: "A doctor and his recently-deceased patient are reborn as the twin children of their favorite idol." },
      status: "completed",
      contentRating: "safe",
      availableTranslatedLanguages: ["en", "id", "ja"]
    },
    relationships: [{ type: "cover_art", attributes: { fileName: "60bf806f-4d92-4f96-be6d-6ee5e7fc243d.jpg" } }],
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx117195-k8L209U1hS9T.jpg",
    source: "mangadex"
  },
  {
    id: "32d76d19-8a05-4db0-9fc2-e0b0648fe9d0",
    type: "manga",
    attributes: {
      title: { en: "Solo Leveling" },
      description: { en: "Sung Jin-Woo awakens as the world's only player able to see an interface that lets him level up." },
      status: "completed",
      contentRating: "safe",
      availableTranslatedLanguages: ["en", "id", "ko"]
    },
    relationships: [{ type: "cover_art", attributes: { fileName: "1b2b8c9e-5b12-4e89-a2e6-764f69741c88.jpg" } }],
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx105398-b673TaPprNUp.jpg",
    source: "mangadex"
  },
  {
    id: "423f2ec4-94e8-48a8-a42e-132d32786a7d",
    type: "manga",
    attributes: {
      title: { en: "Dandadan" },
      description: { en: "An action-packed occult comedy about ghosts, aliens, and high school romance." },
      status: "ongoing",
      contentRating: "suggestive",
      availableTranslatedLanguages: ["en", "id", "ja"]
    },
    relationships: [{ type: "cover_art", attributes: { fileName: "4dcbc465-38b4-4e9b-b565-d0ff785cf61e.jpg" } }],
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx132029-7J6N1kRk0e0M.jpg",
    source: "mangadex"
  },
  {
    id: "a1c7c817-4e59-43b7-9365-09675a149a6f",
    type: "manga",
    attributes: {
      title: { en: "One Piece" },
      description: { en: "Monkey D. Luffy sets out to find the legendary treasure One Piece and become the Pirate King." },
      status: "ongoing",
      contentRating: "safe",
      availableTranslatedLanguages: ["en", "id", "ja"]
    },
    relationships: [{ type: "cover_art", attributes: { fileName: "87c94ebc-25d2-4467-938d-dc776bf7eb58.jpg" } }],
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx30013-ulmsSPjWBPut.png",
    source: "mangadex"
  },
  {
    id: "6e3553b9-ddb5-478f-b522-42480f0d250b",
    type: "manga",
    attributes: {
      title: { en: "Spy x Family" },
      description: { en: "A spy creates a fake family for his mission, unaware his wife is an assassin and his daughter a telepath." },
      status: "ongoing",
      contentRating: "safe",
      availableTranslatedLanguages: ["en", "id", "ja"]
    },
    relationships: [{ type: "cover_art", attributes: { fileName: "7f5d4750-f8fa-4a37-b95b-06e9ec1914eb.jpg" } }],
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx108556-BexxSgqGvFzX.jpg",
    source: "mangadex"
  },
  {
    id: "801513ba-a712-498b-87de-7909758d55ac",
    type: "manga",
    attributes: {
      title: { en: "Berserk" },
      description: { en: "Guts, a former mercenary known as the 'Black Swordsman', is out for revenge." },
      status: "ongoing",
      contentRating: "suggestive",
      availableTranslatedLanguages: ["en", "id", "ja"]
    },
    relationships: [{ type: "cover_art", attributes: { fileName: "a1cb5e3f-6799-4d64-b0a6-169bbf977e23.jpg" } }],
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx30002-3mN5hGk9rL4N.jpg",
    source: "mangadex"
  },
  {
    id: "2cbdab16-8679-46f3-a444-2439a2632b4b",
    type: "manga",
    attributes: {
      title: { en: "Blue Lock" },
      description: { en: "300 high school forwards compete in an isolated training facility to become Japan's greatest striker." },
      status: "ongoing",
      contentRating: "safe",
      availableTranslatedLanguages: ["en", "id", "ja"]
    },
    relationships: [{ type: "cover_art", attributes: { fileName: "b45455ea-3610-449e-953b-e3c31fc2aaae.jpg" } }],
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx106130-i4Jk0Z04d0n4.jpg",
    source: "mangadex"
  },
  {
    id: "11c65d6c-6a10-4497-a61d-65231c5eeff6",
    type: "manga",
    attributes: {
      title: { en: "Kaiju No. 8" },
      description: { en: "Kafka Hibino gains the power to turn into a kaiju and uses it to join the Defense Force." },
      status: "ongoing",
      contentRating: "safe",
      availableTranslatedLanguages: ["en", "id", "ja"]
    },
    relationships: [{ type: "cover_art", attributes: { fileName: "2d5c2e2e-8c34-4a43-9844-32b5003ea29e.jpg" } }],
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx120760-4K8P1X2M5A2S.jpg",
    source: "mangadex"
  },
  {
    id: "5d63ce89-99f8-42f2-85c3-8f0691475734",
    type: "manga",
    attributes: {
      title: { en: "Vinland Saga" },
      description: { en: "Thorfinn pursues revenge against the Viking leader who murdered his father." },
      status: "ongoing",
      contentRating: "suggestive",
      availableTranslatedLanguages: ["en", "id", "ja"]
    },
    relationships: [{ type: "cover_art", attributes: { fileName: "2bc1c52b-7c1e-450f-a42e-cf6151f49615.jpg" } }],
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx30642-NknK6E2H7eE5.jpg",
    source: "mangadex"
  }
];

app.get('/api/popular', async (req, res) => {
  try {
    const cacheKey = 'popular_manga';
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    if (cached) return res.json(cached);

    const data = await fetchMangaDex('/manga?limit=24&includes[]=cover_art&includes[]=author&order[followedCount]=desc&contentRating[]=safe&contentRating[]=suggestive');
    if (data && Array.isArray(data.data) && data.data.length > 0) {
      setCache(cacheKey, data, CACHE_TTL.popular);
      return res.json(data);
    }
    const fallbackData = { result: 'ok', response: 'collection', data: MANGADEX_POPULAR_SNAPSHOT };
    setCache(cacheKey, fallbackData, CACHE_TTL.popular);
    return res.json(fallbackData);
  } catch (error) {
    console.error('Error fetching popular manga from MangaDex:', error.message);
    const cached = getCache('popular_manga');
    if (cached) return res.json(cached);

    const fallbackData = { result: 'ok', response: 'collection', data: MANGADEX_POPULAR_SNAPSHOT };
    setCache('popular_manga', fallbackData, CACHE_TTL.popular);
    return res.json(fallbackData);
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

      // Fallback 3: AniList High-Resolution Cover Art
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
          if (!searchTitle) {
            const snap = MANGADEX_POPULAR_SNAPSHOT.find(m => m.id === mangaId);
            if (snap?.coverUrl) {
              res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400');
              return res.redirect(302, snap.coverUrl);
            }
          }
          if (searchTitle) {
            const cleanTitle = searchTitle.replace(/\(.*?\)|\[.*?\]/g, '').replace(/[-_:]/g, ' ').replace(/\s+/g, ' ').trim();
            const gql = `query ($s: String) { Media(search: $s, type: MANGA) { coverImage { extraLarge large } } }`;
            const alRes = await fetch('https://graphql.anilist.co', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: gql, variables: { s: cleanTitle } }),
              signal: AbortSignal.timeout(4000)
            });
            if (alRes.ok) {
              const alJson = await alRes.json();
              const cov = alJson.data?.Media?.coverImage?.extraLarge || alJson.data?.Media?.coverImage?.large;
              if (cov) {
                res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400');
                return res.redirect(302, cov);
              }
            }
          }
        } catch (eAl) {}
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
            const ratingFormatted = rating ? `⭐ ${rating.toFixed(1)}` : null;

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

// ==========================================
// ANIME POPULAR & TRENDING SNAPSHOT FALLBACK
// Guaranteed high-uptime anime catalog even if AniList / Jikan are temporarily down
// ==========================================
const ANIME_POPULAR_SNAPSHOT = [
  {
    id: 151807,
    malId: 52299,
    tmdbId: 213026,
    kitsuId: '46231',
    mediaType: 'anime',
    title: 'Solo Leveling',
    titleObj: { romaji: 'Ore dake Level Up na Ken', english: 'Solo Leveling', native: '俺だけレベルアップな件' },
    coverUrl: 'https://media.kitsu.app/anime/46231/poster_image/large-cdadff31f42490b9f48a035939a01a92.jpeg',
    bannerUrl: 'https://media.kitsu.app/anime/46231/cover_image/large-33273dc297cdc8b10cc1140de07d3dae.jpeg',
    rating: '⭐ 8.4',
    averageScore: 84,
    status: 'RELEASING',
    episodes: 12,
    format: 'TV',
    genres: ['Action', 'Adventure', 'Fantasy'],
    description: '10 years ago, after the Gate that connected the real world with the monster world opened, some ordinary people received the power to hunt monsters.'
  },
  {
    id: 171018,
    malId: 57334,
    tmdbId: 242224,
    kitsuId: '48269',
    mediaType: 'anime',
    title: 'Dandadan',
    titleObj: { romaji: 'Dandadan', english: 'DAN DA DAN', native: 'ダンダダン' },
    coverUrl: 'https://media.kitsu.app/anime/48269/poster_image/large-589c017798b98c69e3a615ca4191f49d.jpeg',
    bannerUrl: 'https://media.kitsu.app/anime/48269/cover_image/large-2a78bed2943524035cc0146c6633d1bf.jpeg',
    rating: '⭐ 8.6',
    averageScore: 86,
    status: 'RELEASING',
    episodes: 12,
    format: 'TV',
    genres: ['Action', 'Comedy', 'Supernatural', 'Romance'],
    description: 'Momo Ayase strikes up an unusual friendship with her school fanatical UFO nerd, whom she nicknames Okarun.'
  },
  {
    id: 154587,
    malId: 52991,
    tmdbId: 209867,
    kitsuId: '46474',
    mediaType: 'anime',
    title: 'Sousou no Frieren',
    titleObj: { romaji: 'Sousou no Frieren', english: 'Frieren: Beyond Journey\'s End', native: '葬送のフリーレン' },
    coverUrl: 'https://media.kitsu.app/anime/46474/poster_image/large-ec9b98dd5fbf8f92532d1edb45f9e882.jpeg',
    bannerUrl: 'https://media.kitsu.app/anime/46474/cover_image/large-167edf3e01fac59ce6aacfeb47df5634.jpeg',
    rating: '⭐ 9.1',
    averageScore: 91,
    status: 'FINISHED',
    episodes: 28,
    format: 'TV',
    genres: ['Adventure', 'Drama', 'Fantasy'],
    description: 'The adventure is over but life goes on for an elf mage just beginning to learn what living is all about.'
  },
  {
    id: 113415,
    malId: 40748,
    tmdbId: 95479,
    kitsuId: '42765',
    mediaType: 'anime',
    title: 'Jujutsu Kaisen',
    titleObj: { romaji: 'Jujutsu Kaisen', english: 'Jujutsu Kaisen', native: '呪術廻戦' },
    coverUrl: 'https://media.kitsu.app/anime/42765/poster_image/large-5ce19551c1a6cf995b378205b9149b5c.jpeg',
    bannerUrl: 'https://media.kitsu.app/anime/cover_images/42765/large.jpg',
    rating: '⭐ 8.6',
    averageScore: 86,
    status: 'FINISHED',
    episodes: 24,
    format: 'TV',
    genres: ['Action', 'Drama', 'Supernatural'],
    description: 'A boy swallows a cursed talisman and finds himself in the dangerous world of Jujutsu Sorcerers.'
  },
  {
    id: 127230,
    malId: 44511,
    tmdbId: 114410,
    kitsuId: '43806',
    mediaType: 'anime',
    title: 'Chainsaw Man',
    titleObj: { romaji: 'Chainsaw Man', english: 'Chainsaw Man', native: 'チェンソーマン' },
    coverUrl: 'https://media.kitsu.app/anime/43806/poster_image/large-815d6008fb3b56f4291b9f0ffa05cd8f.jpeg',
    bannerUrl: 'https://media.kitsu.app/anime/43806/cover_image/large-964674a0f11524f62d65dde845ad8e1f.jpeg',
    rating: '⭐ 8.4',
    averageScore: 84,
    status: 'FINISHED',
    episodes: 12,
    format: 'TV',
    genres: ['Action', 'Comedy', 'Drama', 'Supernatural'],
    description: 'Denji is a teenage boy living with a Chainsaw Devil named Pochita who works as a devil hunter.'
  },
  {
    id: 21,
    malId: 21,
    tmdbId: 37854,
    kitsuId: '12',
    mediaType: 'anime',
    title: 'One Piece',
    titleObj: { romaji: 'ONE PIECE', english: 'One Piece', native: 'ONE PIECE' },
    coverUrl: 'https://media.kitsu.app/anime/poster_images/12/large.jpg',
    bannerUrl: 'https://media.kitsu.app/anime/12/cover_image/large-3e72f400a87b5241780c5082f0582611.jpeg',
    rating: '⭐ 8.8',
    averageScore: 88,
    status: 'RELEASING',
    episodes: 1120,
    format: 'TV',
    genres: ['Action', 'Adventure', 'Comedy', 'Fantasy'],
    description: 'Monkey D. Luffy sets out to sea with his eccentric crew to find the legendary treasure One Piece.'
  },
  {
    id: 101922,
    malId: 38000,
    tmdbId: 85937,
    kitsuId: '41370',
    mediaType: 'anime',
    title: 'Kimetsu no Yaiba',
    titleObj: { romaji: 'Kimetsu no Yaiba', english: 'Demon Slayer: Kimetsu no Yaiba', native: '鬼滅の刃' },
    coverUrl: 'https://media.kitsu.app/anime/poster_images/41370/large.jpg',
    bannerUrl: 'https://media.kitsu.app/anime/41370/cover_image/large-3de3cc6d2b33162c928de10aa201e4ba.jpeg',
    rating: '⭐ 8.5',
    averageScore: 85,
    status: 'FINISHED',
    episodes: 26,
    format: 'TV',
    genres: ['Action', 'Adventure', 'Drama', 'Fantasy'],
    description: 'Tanjiro Kamado becomes a demon slayer after his family is slaughtered and his sister turned into a demon.'
  },
  {
    id: 140960,
    malId: 50265,
    tmdbId: 120089,
    kitsuId: '45398',
    mediaType: 'anime',
    title: 'Spy x Family',
    titleObj: { romaji: 'SPY×FAMILY', english: 'Spy x Family', native: 'SPY×FAMILY' },
    coverUrl: 'https://media.kitsu.app/anime/45398/poster_image/large-c26c1e0b77e881fcd66475af6bd22c57.jpeg',
    bannerUrl: 'https://media.kitsu.app/anime/45398/cover_image/large-1e81255ff9bde22c072c555cc5998805.jpeg',
    rating: '⭐ 8.5',
    averageScore: 85,
    status: 'FINISHED',
    episodes: 25,
    format: 'TV',
    genres: ['Action', 'Comedy', 'Slice of Life'],
    description: 'A spy must build a fake family for a secret mission, unaware his wife is an assassin and his daughter a telepath.'
  },
  {
    id: 150672,
    malId: 52034,
    tmdbId: 203737,
    kitsuId: '46170',
    mediaType: 'anime',
    title: '【OSHI NO KO】',
    titleObj: { romaji: '【OSHI NO KO】', english: '【OSHI NO KO】', native: '【推しの子】' },
    coverUrl: 'https://media.kitsu.app/anime/46170/poster_image/large-0bad1050afcf9e5320ca46bf17ac007a.jpeg',
    bannerUrl: 'https://media.kitsu.app/anime/46170/cover_image/large-49585dba0b824dbd0267d5c7ce8ef56f.jpeg',
    rating: '⭐ 8.7',
    averageScore: 87,
    status: 'FINISHED',
    episodes: 11,
    format: 'TV',
    genres: ['Drama', 'Mystery', 'Supernatural'],
    description: 'A doctor and his patient are reborn as the twin children of their favorite idol Ai Hoshino.'
  },
  {
    id: 153288,
    malId: 52588,
    tmdbId: 207374,
    kitsuId: '46300',
    mediaType: 'anime',
    title: 'Kaiju No. 8',
    titleObj: { romaji: 'Kaijuu 8-gou', english: 'Kaiju No.8', native: '怪獣8号' },
    coverUrl: 'https://media.kitsu.app/anime/46300/poster_image/large-31cc66fd5854cc555d496ced7ab40c31.jpeg',
    bannerUrl: 'https://media.kitsu.app/anime/46300/cover_image/large-beb78aec0cb2066bc44ea52f66311e04.jpeg',
    rating: '⭐ 8.2',
    averageScore: 82,
    status: 'FINISHED',
    episodes: 12,
    format: 'TV',
    genres: ['Action', 'Sci-Fi'],
    description: 'Kafka Hibino gains the power to transform into a monster and decides to join the Defense Force.'
  },
  {
    id: 16498,
    malId: 16498,
    tmdbId: 1429,
    kitsuId: '7442',
    mediaType: 'anime',
    title: 'Attack on Titan',
    titleObj: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', native: '進撃の巨人' },
    coverUrl: 'https://media.kitsu.app/anime/poster_images/7442/large.jpg',
    bannerUrl: 'https://media.kitsu.app/anime/cover_images/7442/large.jpg',
    rating: '⭐ 8.6',
    averageScore: 86,
    status: 'FINISHED',
    episodes: 25,
    format: 'TV',
    genres: ['Action', 'Drama', 'Fantasy', 'Mystery'],
    description: 'Humanity lives enclosed within enormous walls to protect themselves from gigantic human-eating Titans.'
  },
  {
    id: 114446,
    malId: 41467,
    tmdbId: 94664,
    kitsuId: '43078',
    mediaType: 'anime',
    title: 'Bleach: Thousand-Year Blood War',
    titleObj: { romaji: 'BLEACH: Sennen Kessen-hen', english: 'Bleach: Thousand-Year Blood War', native: 'BLEACH 千年血戦篇' },
    coverUrl: 'https://media.kitsu.app/anime/43078/poster_image/large-bf36dc3ed0097c8b8c49e064bf0eaa79.jpeg',
    bannerUrl: 'https://media.kitsu.app/anime/43078/cover_image/large-45a93d1d5a68cf93aa314a9efbe8bf72.jpeg',
    rating: '⭐ 8.9',
    averageScore: 89,
    status: 'FINISHED',
    episodes: 13,
    format: 'TV',
    genres: ['Action', 'Adventure', 'Supernatural'],
    description: 'The Soul Society is attacked by the Wandenreich, an army of Quincies bent on revenge.'
  }
];

// 1. Trending / Popular Anime (Supports /api/anime/trending and /api/anime/popular)
app.get(['/api/anime/trending', '/api/anime/popular'], async (req, res) => {
  try {
    const cacheKey = 'anime_trending_v2';
    const cached = getCache(cacheKey);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    if (cached && cached.data && cached.data.length > 0) return res.json(cached);

    let results = [];

    try {
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
      if (aniData?.Page?.media && Array.isArray(aniData.Page.media)) {
        results = aniData.Page.media.map(mapAniListMedia).filter(Boolean);
      }
    } catch (eAni) {
      console.warn('[Anime Popular] AniList query failed, falling back:', eAni.message);
    }

    // Jikan v4 fallback if AniList returned nothing
    if (results.length === 0) {
      try {
        const jikan = await fetchJikanAnime('/top/anime?filter=airing&limit=24');
        if (jikan?.data && Array.isArray(jikan.data)) {
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
      } catch (eJikan) {}
    }

    // Snapshot fallback if both external providers fail or rate-limit
    if (results.length === 0) {
      results = ANIME_POPULAR_SNAPSHOT;
    }

    const payload = { data: results, total: results.length };
    setCache(cacheKey, payload, CACHE_TTL.popular);
    res.json(payload);
  } catch (error) {
    console.error('Error fetching trending anime:', error.message);
    res.json({ data: ANIME_POPULAR_SNAPSHOT, total: ANIME_POPULAR_SNAPSHOT.length });
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
    if (cached && cached.data && cached.data.length > 0) return res.json(cached);

    let results = [];
    try {
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
      if (aniData?.Page?.media && Array.isArray(aniData.Page.media)) {
        results = aniData.Page.media.map(mapAniListMedia).filter(Boolean);
      }
    } catch (e) {}

    if (results.length === 0) {
      results = ANIME_POPULAR_SNAPSHOT.slice(0, 8);
    }

    const payload = { data: results, total: results.length, season, year: parseInt(year) };
    setCache(cacheKey, payload, CACHE_TTL.popular);
    res.json(payload);
  } catch (error) {
    res.json({ data: ANIME_POPULAR_SNAPSHOT.slice(0, 8), total: 8 });
  }
});

// 2b. Latest Episodes / Updates Anime
app.get('/api/anime/latest', async (req, res) => {
  try {
    const cacheKey = 'anime_latest_releases';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const latestList = ANIME_POPULAR_SNAPSHOT.map((a, idx) => ({
      ...a,
      latestEpisode: `Episode ${a.episodes || (12 - idx)}`
    }));

    const payload = { data: latestList, total: latestList.length };
    setCache(cacheKey, payload, CACHE_TTL.latest);
    res.json(payload);
  } catch (error) {
    res.json({ data: ANIME_POPULAR_SNAPSHOT, total: ANIME_POPULAR_SNAPSHOT.length });
  }
});

// 2c. Movie Anime
app.get('/api/anime/movies', async (req, res) => {
  try {
    const cacheKey = 'anime_movies_list';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const movieList = [
      {
        id: 101922,
        mediaType: 'anime',
        title: 'Demon Slayer: Mugen Train',
        titleObj: { romaji: 'Kimetsu no Yaiba: Mugen Ressha-hen', english: 'Demon Slayer -Kimetsu no Yaiba- The Movie: Mugen Train' },
        coverUrl: 'https://media.kitsu.app/anime/poster_images/42965/large.jpg',
        bannerUrl: 'https://media.kitsu.app/anime/41370/cover_image/large-3de3cc6d2b33162c928de10aa201e4ba.jpeg',
        rating: '⭐ 8.7',
        format: 'MOVIE',
        status: 'FINISHED',
        episodes: 1,
        genres: ['Action', 'Fantasy']
      },
      {
        id: 154587,
        mediaType: 'anime',
        title: 'Kimi no Na wa. (Your Name)',
        titleObj: { romaji: 'Kimi no Na wa.', english: 'Your Name.' },
        coverUrl: 'https://media.kitsu.app/anime/poster_images/11614/large.jpg',
        bannerUrl: 'https://media.kitsu.app/anime/46474/cover_image/large-167edf3e01fac59ce6aacfeb47df5634.jpeg',
        rating: '⭐ 8.9',
        format: 'MOVIE',
        status: 'FINISHED',
        episodes: 1,
        genres: ['Drama', 'Romance', 'Supernatural']
      },
      {
        id: 113415,
        mediaType: 'anime',
        title: 'Jujutsu Kaisen 0: The Movie',
        titleObj: { romaji: 'Jujutsu Kaisen 0', english: 'Jujutsu Kaisen 0' },
        coverUrl: 'https://media.kitsu.app/anime/poster_images/44365/large.jpg',
        bannerUrl: 'https://media.kitsu.app/anime/cover_images/42765/large.jpg',
        rating: '⭐ 8.5',
        format: 'MOVIE',
        status: 'FINISHED',
        episodes: 1,
        genres: ['Action', 'Drama', 'Fantasy']
      }
    ];

    const payload = { data: movieList, total: movieList.length };
    setCache(cacheKey, payload, CACHE_TTL.popular);
    res.json(payload);
  } catch (error) {
    res.json({ data: [], total: 0 });
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
    if (!media && aniZipData?.mappings?.mal_id) {
      try {
        const jikan = await fetchJikanAnime(`/anime/${aniZipData.mappings.mal_id}/full`);
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
      } catch (eJk) {}
    }

    // Snapshot fallback for popular/trending titles during AniList downtime
    if (!media) {
      const snap = ANIME_POPULAR_SNAPSHOT.find(a => String(a.id) === String(id));
      if (snap) {
        media = {
          id: snap.id,
          title: snap.titleObj || { romaji: snap.title, english: snap.title, native: snap.title },
          bannerImage: snap.bannerUrl,
          coverImage: { extraLarge: snap.coverUrl, large: snap.coverUrl },
          description: snap.description || '',
          averageScore: snap.averageScore,
          genres: snap.genres || [],
          status: snap.status || 'FINISHED',
          format: snap.format || 'TV',
          episodes: snap.episodes || 12,
          duration: 24,
          relations: { edges: [] }
        };
      }
    }

    // Direct MAL ID fallback if numerical ID matched MAL directly
    if (!media) {
      try {
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
      } catch (eJk2) {}
    }

    if (!media) {
      // Guaranteed fallback so anime page never crashes with 404
      media = {
        id: parseInt(id) || 1,
        title: { romaji: `Anime #${id}`, english: `Anime #${id}`, native: '' },
        bannerImage: null,
        coverImage: { extraLarge: '', large: '' },
        description: 'Detail anime sedang diperbarui. Episode tetap dapat ditonton.',
        averageScore: 85,
        genres: ['Action', 'Fantasy'],
        status: 'RELEASING',
        format: 'TV',
        episodes: 12,
        duration: 24,
        relations: { edges: [] }
      };
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

    // Attach AniZip & Snapshot mappings
    const snap = ANIME_POPULAR_SNAPSHOT.find(a => String(a.id) === String(id));
    mapped.mappings = {
      mal_id: snap?.malId || aniZipData?.mappings?.mal_id || null,
      themoviedb_id: snap?.tmdbId || aniZipData?.mappings?.themoviedb_id || null,
      kitsu_id: snap?.kitsuId || aniZipData?.mappings?.kitsu_id || null
    };
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
      const snap = ANIME_POPULAR_SNAPSHOT.find(a => String(a.id) === String(id));
      if (snap) {
        animeTitle = snap.title;
        if (!malId && snap.malId) malId = snap.malId;
        if (!tmdbId && snap.tmdbId) tmdbId = snap.tmdbId;
      }
      try {
        const [titleData, zipData] = await Promise.all([
          fetchAniListAnime(`query ($id: Int) { Media(id: $id, type: ANIME) { title { romaji english } } }`, { id: parseInt(id) }).catch(() => null),
          fetchAniZipMappings(id).catch(() => null)
        ]);
        if (titleData?.Media?.title) {
          animeTitle = titleData.Media.title.romaji || titleData.Media.title.english || animeTitle;
        }
        if (zipData?.mappings) {
          malId = zipData.mappings.mal_id || malId;
          tmdbId = zipData.mappings.themoviedb_id || tmdbId;
        }
      } catch (eMeta) {}
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

      if (malId) {
        servers.push({
          id: 'server-vidsrc-mal',
          name: 'Server 1 (VidSrc HD • Super Lancar)',
          type: 'iframe',
          url: `https://vidsrc.me/embed/anime?mal=${malId}&ep=${epNum}`,
          quality: '1080p',
          isSubIndo: false
        });
      }

      if (tmdbId) {
        servers.push({
          id: 'server-autoembed-tmdb',
          name: `Server ${servers.length + 1} (AutoEmbed Cloud CDN)`,
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

      if (servers.length === 0) {
        servers.push({
          id: 'server-vidsrc-fallback',
          name: 'Server 1 (AutoStream • VidSrc)',
          type: 'iframe',
          url: `https://vidsrc.me/embed/anime?title=${safeTitle}&ep=${epNum}`,
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
