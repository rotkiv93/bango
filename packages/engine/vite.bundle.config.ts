import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = (p: string) => fileURLToPath(new URL(`../${p}/src/index.ts`, import.meta.url));

// Self-contained browser build: Langium, Comlink and the composer are inlined, so a plain
// <script type="module"> page needs no bundler and no import map.
export default defineConfig({
  resolve: { alias: { '@bango/composer': src('composer'), '@bango/core': src('core') } },
  build: {
    outDir: 'dist/bundle',
    lib: {
      entry: { 'bango': 'src/bundle/index.ts', 'bango.worker': 'src/bundle/worker.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    sourcemap: false,
    minify: true,
    emptyOutDir: true
  }
});
