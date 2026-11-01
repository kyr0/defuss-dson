import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

/**
 * Serves the website (docs/) the way GitHub Pages does. `lib` replaces docs/assets/lib/defuss-dson.mjs with another
 * build: e2e passes the dist/index.mjs of the installed tarball, so the site is tested with the published artifact,
 * not with the copy committed for Pages. Paths outside docs/ answer 403, unknown files 404.
 * VERIFIED: scripts/e2e.mjs sets DSON_LIB, so every Playwright test runs the installed build.
 */
export async function serve({ port = 0, lib } = {}) {
  const base = resolve(root, 'docs');
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      // An empty same-origin page: e2e loads example modules here, mapped to the build under test by an import map.
      if (pathname === '/__blank__') {
        response.writeHead(200, { 'content-type': types['.html'] }).end('<!doctype html><title>blank</title>');
        return;
      }
      const path = pathname === '/assets/lib/defuss-dson.mjs' && lib
        ? lib
        : resolve(base, `.${pathname}${pathname.endsWith('/') ? 'index.html' : ''}`);
      if (path !== lib && !path.startsWith(base + sep)) { response.writeHead(403).end(); return; }
      const body = await readFile(path);
      response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serve({ port: Number(process.env.PORT || 8080), lib: process.env.DSON_LIB || undefined });
  console.log(`${new Date().toISOString()} INFO serving docs/ url=${url}/`);
}
