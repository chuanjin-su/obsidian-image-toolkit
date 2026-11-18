import { build } from 'esbuild';
import { embeddedWorkerPlugin } from '../../build/embedded-worker.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const makeBundle = () => build({ entryPoints: [`${root}tests/browser/entry.ts`], bundle: true, format: 'esm', target: 'es2022', write: false, plugins: [embeddedWorkerPlugin()], alias: { obsidian: `${root}tests/browser/obsidian.ts` } });
const html = `<!doctype html><meta charset="utf-8"><title>Image Toolkit browser smoke</title><link rel="stylesheet" href="/styles.css"><style>:root{--background-secondary:#eee;--background-modifier-border:#bbb;--interactive-accent:#705dcf;--text-on-accent:white;--text-muted:#666}body{font:14px system-ui;margin:16px}button,input,select{font:inherit;padding:5px}button{cursor:pointer}.modal-container{position:fixed;inset:0;display:grid;place-items:center;background:#8883}.modal{background:white;border:1px solid #aaa;padding:18px;margin:auto}.modal h2{margin-top:0}.notice{white-space:pre-wrap}</style><script type="module" src="/bundle.js"></script>`;
const routes = { '/': () => html, '/bundle.js': async () => (await makeBundle()).outputFiles[0].contents, '/styles.css': () => readFile(`${root}styles.css`) };
const mime = { '/': 'text/html', '/bundle.js': 'text/javascript', '/styles.css': 'text/css' };
// Only test-memory resources are writable.
const images = new Map();
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/__stop' && req.method === 'POST') { res.end('Stopped'); server.close(); return; }
    if (path.startsWith('/__images/')) {
      const key = decodeURIComponent(path.slice('/__images/'.length));
      if (req.method === 'PUT') {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 80 * 1024 * 1024) throw new Error('Test image exceeds 80 MB');
          chunks.push(chunk);
        }
        images.set(key, Buffer.concat(chunks));res.end('Stored in test memory');return;
      }
      if (!images.has(key)) { res.writeHead(404);res.end();return; }
      res.setHeader('Content-Type', /\.png$/i.test(key) ? 'image/png' : /\.webp$/i.test(key) ? 'image/webp' : 'image/jpeg');
      res.end(images.get(key));return;
    }
    const route = routes[path];
    if (!route) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', mime[path]);res.end(await route());
  } catch (error) { res.writeHead(500);res.end(String(error)); }
});
const port = Number(process.env.PORT || 4178);
server.listen(port, '127.0.0.1', () => console.log(`DOM-only smoke harness: http://127.0.0.1:${port} (Ctrl-C to stop)`));
