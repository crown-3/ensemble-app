// Browser mode: runs the same backend as the Electron app and serves the UI over HTTP,
// so the app can be used where no desktop window can be shown (e.g. GitHub Codespaces).
//   npm run web  →  http://localhost:4100
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from './core';

const port = Number(process.env.PORT ?? 4100);
// Same folder Electron uses for userData on Linux, so both modes share data.
const dataDir = process.env.ENSEMBLE_DATA_DIR ?? path.join(os.homedir(), '.config', 'ensemble');
const here = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(here, '../renderer');

const clients = new Set<http.ServerResponse>();
let pending: NodeJS.Timeout | null = null;
const { store, ensemble, handlers } = createBackend(dataDir, path.join(here, 'ensemble-mcp.js'), () => {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const data = `data: ${JSON.stringify(ensemble.state())}\n\n`;
    for (const res of clients) res.write(data);
  }, 30);
});

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8', '.pdf': 'application/pdf',
};

// "열기" in the browser: show a file (or a folder listing), but only inside a chat's work folder.
function serveWorkFile(p: string, res: http.ServerResponse) {
  const abs = path.resolve(p);
  const folders = [...store.data.chats, ...store.data.projects].map((x) => x.folderPath);
  const allowed =
    store.data.projects.some((p) => p.referenceFiles.includes(abs)) ||
    folders.some((f) => {
      const rel = path.relative(f, abs);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
  if (!allowed || !fs.existsSync(abs)) return res.writeHead(404).end('Not found');
  if (fs.statSync(abs).isDirectory()) {
    const names = fs.readdirSync(abs, { withFileTypes: true }).map((d) => d.name + (d.isDirectory() ? '/' : ''));
    return res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(`${abs}\n\n${names.join('\n') || '(비어 있음)'}`);
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(abs).toLowerCase()] ?? 'text/plain; charset=utf-8' });
  fs.createReadStream(abs).pipe(res);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(ensemble.state())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname.startsWith('/api/') && req.method === 'POST') {
      const fn = handlers[url.pathname.slice(5) as keyof typeof handlers];
      if (!fn) return res.writeHead(404).end();
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const result = await fn(...JSON.parse(body || '[]'));
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result ?? null));
        } catch (e) {
          res.writeHead(500).end(String(e));
        }
      });
      return;
    }
    if (url.pathname === '/file') return serveWorkFile(url.searchParams.get('path') ?? '', res);

    const file = path.join(rendererDir, path.normalize(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(rendererDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`Ensemble (web) → http://localhost:${port}`);
    console.log(`데이터: ${dataDir}`);
  });

process.on('SIGINT', () => {
  store.flush();
  process.exit(0);
});
