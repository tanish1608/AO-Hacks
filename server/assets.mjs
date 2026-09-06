import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
/** Replaces the Workers ASSETS binding: serves dist/client, 404 otherwise. */
export function createAssets(root) {
  return {
    async fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      // Contain traversal before touching the filesystem.
      const rel = normalize(path).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
      const file = join(root, rel);
      if (!file.startsWith(root + sep) && file !== root)
        return new Response('Not found', { status: 404 });
      try {
        if (!statSync(file).isFile()) return new Response('Not found', { status: 404 });
      } catch {
        return new Response('Not found', { status: 404 });
      }
      const body = await readFile(file);
      const immutable = rel.includes('/_next/static/') || rel.includes('_next/static');
      return new Response(body, {
        headers: {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'cache-control': immutable
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=0, must-revalidate',
        },
      });
    },
  };
}
