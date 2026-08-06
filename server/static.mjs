// ──────────────────────────────────────────────────────────────
// Static file handler for the built dist/ bundle.
//
// This replaces the nginx stage the image used to run. It keeps the
// same three caching rules nginx had — content-hashed /assets/ are
// immutable for a year, the terrain .bin/.wasm rasters cache for a
// week, everything else revalidates — and gzips on the wire.
//
// The two terrain rasters are 8 MB each, so compressed bodies are
// cached in memory after the first request rather than re-gzipped
// per client. The whole dist/ is a few tens of MB at most.
// ──────────────────────────────────────────────────────────────

import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { gzip as gzipCb } from 'node:zlib';
import { promisify } from 'node:util';
import { join, normalize, extname, sep } from 'node:path';

const gzip = promisify(gzipCb);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Worth compressing — the rest (png/woff2) is already compressed. */
const COMPRESSIBLE = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.svg', '.wasm', '.bin', '.map',
]);

/** Don't hold a compressed copy of anything enormous in RAM. */
const GZIP_CACHE_MAX_BYTES = 32 * 1024 * 1024;

export function createStaticHandler(root) {
  /** key `${path}:${mtimeMs}:${size}` → gzipped Buffer */
  const gzipCache = new Map();

  function cacheControl(urlPath, ext) {
    if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
    if (ext === '.bin' || ext === '.wasm') return 'public, max-age=604800';
    return 'public, max-age=0, must-revalidate';
  }

  /** Resolve a URL path to a file inside root, or null if it escapes. */
  function resolve(urlPath) {
    const decoded = decodeURIComponent(urlPath.split('?')[0]);
    const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
    const full = join(root, clean);
    if (full !== root && !full.startsWith(root + sep)) return null;   // traversal
    return full;
  }

  async function send(req, res, file, urlPath) {
    const info = await stat(file);
    const ext = extname(file).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    const etag = `W/"${info.size}-${Math.round(info.mtimeMs)}"`;

    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', cacheControl(urlPath, ext));
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', info.mtime.toUTCString());

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304).end();
      return;
    }

    const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const compressible = COMPRESSIBLE.has(ext) && info.size > 1024;

    if (wantsGzip && compressible) {
      const key = `${file}:${info.mtimeMs}:${info.size}`;
      let body = gzipCache.get(key);
      if (!body) {
        body = await gzip(await readFile(file), { level: 6 });
        if (body.length <= GZIP_CACHE_MAX_BYTES) gzipCache.set(key, body);
      }
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', body.length);
      if (req.method === 'HEAD') { res.writeHead(200).end(); return; }
      res.writeHead(200).end(body);
      return;
    }

    res.setHeader('Content-Length', info.size);
    if (req.method === 'HEAD') { res.writeHead(200).end(); return; }
    res.writeHead(200);
    createReadStream(file).pipe(res);
  }

  /** @returns {Promise<boolean>} true if the request was handled. */
  return async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('method not allowed');
      return true;
    }

    const urlPath = (req.url || '/').split('?')[0];
    const target = resolve(urlPath === '/' ? '/index.html' : urlPath);
    if (!target) { res.writeHead(403).end('forbidden'); return true; }

    try {
      const info = await stat(target);
      if (info.isDirectory()) {
        await send(req, res, join(target, 'index.html'), urlPath);
      } else {
        await send(req, res, target, urlPath);
      }
      return true;
    } catch {
      // Single-page-app fallback, exactly as nginx's try_files did. Assets
      // are excluded so a missing bundle 404s honestly instead of serving
      // HTML that the browser then fails to parse as JavaScript.
      if (extname(urlPath)) { res.writeHead(404).end('not found'); return true; }
      try {
        await send(req, res, join(root, 'index.html'), '/');
      } catch {
        res.writeHead(404).end('not found');
      }
      return true;
    }
  };
}
