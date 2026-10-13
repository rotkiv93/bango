import { defineConfig } from 'vite';

// Self-contained browser build (dist/bundle/renderer.js) for plain <script type="module"> pages.
// Monaco is passed in by the page; elkjs is optional (without it diagrams use the built-in layered layout).
export default defineConfig({
  build: {
    outDir: 'dist/bundle',
    lib: { entry: { renderer: 'src/bundle/index.ts' }, formats: ['es'], fileName: (_format, name) => `${name}.js` },
    rollupOptions: { external: [/^elkjs(\/.*)?$/] },
    sourcemap: false,
    minify: true,
    emptyOutDir: true
  }
});
