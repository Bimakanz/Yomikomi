import https from 'https';
import http from 'http';
import dns from 'dns';
import { URL } from 'url';

const MANGADEX_IPS = [
  { address: '45.129.229.1', family: 4 },
  { address: '45.129.229.2', family: 4 }
];
let proxyIpCounter = 0;

function customProxyLookup(hostname: string, options: any, callback: any) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (hostname === 'api.mangadex.org' || hostname === 'uploads.mangadex.org') {
    if (options && options.all) {
      return callback(null, MANGADEX_IPS);
    }
    const ip = MANGADEX_IPS[proxyIpCounter++ % MANGADEX_IPS.length].address;
    return callback(null, ip, 4);
  }
  return dns.lookup(hostname, options, callback);
}

/**
 * Serverless / Express image proxy handler.
 * Fetches upstream image with proper Referer & modern User-Agent to bypass 403 Forbidden,
 * and responds with long-lived immutable cache headers.
 */
export async function handleImageProxyRequest(
  req: { query: { url?: string; referer?: string } },
  res: {
    status: (code: number) => any;
    setHeader: (name: string, value: string) => any;
    end: (data?: any) => any;
  }
): Promise<void> {
  const targetUrl = req.query.url;
  const referer = req.query.referer;

  if (!targetUrl) {
    res.status(400).end('Missing target "url" query parameter');
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.status(400).end('Invalid target URL');
    return;
  }

  const client = parsed.protocol === 'https:' ? https : http;

  const defaultReferer = referer || `${parsed.protocol}//${parsed.host}/`;

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Referer': defaultReferer,
    'Accept-Language': 'id,en-US;q=0.9,en;q=0.8'
  };

  const proxyReq = client.get(
    targetUrl,
    { headers, timeout: 10000, lookup: customProxyLookup } as any,
    (proxyRes: http.IncomingMessage) => {
      // Follow redirect if needed (301, 302, 307, 308)
      if (
        proxyRes.statusCode &&
        [301, 302, 307, 308].includes(proxyRes.statusCode) &&
        proxyRes.headers.location
      ) {
        return handleImageProxyRequest(
          { query: { url: proxyRes.headers.location, referer } },
          res
        );
      }

      const statusCode = proxyRes.statusCode || 200;
      if (statusCode >= 400) {
        res.status(statusCode).end(`Upstream host returned error ${statusCode}`);
        return;
      }

      // 1-year immutable caching for serverless edge and browser performance
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');

      if (typeof (proxyRes as any).pipe === 'function' && typeof (res as any).write === 'function') {
        (proxyRes as any).pipe(res);
      } else {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          res.end(Buffer.concat(chunks));
        });
      }
    }
  );

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).end('Gateway Timeout when fetching upstream image');
  });

  proxyReq.on('error', (err: Error) => {
    res.status(502).end(`Bad Gateway: ${err.message}`);
  });
}
