// Minimal static server for the plain-HTML example: `npm run example`, then open http://localhost:8099/examples/plain/
// (explicit MIME types: some Windows setups serve .js as text/plain, which browsers refuse for module scripts)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(import.meta.dirname, '..');
const port = Number(process.env.PORT) || 8099;
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.langium': 'text/plain', '.instance': 'text/plain', '.map': 'application/json', '.ttf': 'font/ttf', '.svg': 'image/svg+xml'
};

createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([\\/])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root)) throw new Error('outside root');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}/examples/plain/`));
