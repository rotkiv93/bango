import { defineConfig } from 'vite';

// Self-contained browser build (dist/bundle/studio.js) for plain <script type="module"> pages. The page passes in Monaco, the engine
// connection and the renderer library (so there is one copy of each); nothing of them is in this file.
export default defineConfig({
  build: {
    outDir: 'dist/bundle',
    lib: { entry: { studio: 'src/bundle/index.ts' }, formats: ['es'], fileName: (_format, name) => `${name}.js` },
    sourcemap: false,
    minify: true,
    emptyOutDir: true
  }
});
