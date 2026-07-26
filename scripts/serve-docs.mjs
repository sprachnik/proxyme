// Serves the docs/ (GitHub Pages) build — the backend-less deployment, where
// the browser calls the upstream APIs directly. No deps, no caching.
// `npm run dev:pages` → http://localhost:8000
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const port = Number(process.env.PORT) || 8000;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

createServer((req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(docs, rel);
  if (!file.startsWith(docs)) return end(res, 403, 'forbidden'); // path traversal
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
  } catch {
    return end(res, 404, 'not found');
  }
  const ext = file.slice(file.lastIndexOf('.'));
  res.writeHead(200, {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).on('error', () => end(res, 404, 'not found')).pipe(res);
}).listen(port, () => {
  console.log(`docs/ (Pages build) → http://localhost:${port}`);
  console.log('boats need a key via the 🔑 button; everything else is keyless');
});

const end = (res, code, msg) => { res.writeHead(code, { 'content-type': 'text/plain' }); res.end(msg); };
