import { defineConfig } from 'vite';

// Self-contained browser build (dist/bundle/client.js) for plain <script type="module"> pages that talk to a worker:
// Comlink is inlined and there is no Langium, so the page stays small.
export default defineConfig({
  build: {
    outDir: 'dist/bundle',
    lib: { entry: { client: 'src/bundle/client.ts' }, formats: ['es'], fileName: (_format, name) => `${name}.js` },
    sourcemap: false,
    minify: true,
    emptyOutDir: true
  }
});
