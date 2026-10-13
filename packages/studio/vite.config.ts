import { defineConfig } from 'vite';

// The library build: the engine and the renderer (types only), and Monaco, are the page's business.
export default defineConfig({
  build: {
    lib: { entry: { index: 'src/index.ts' }, formats: ['es'], fileName: (_format, name) => `${name}.js` },
    rollupOptions: { external: [/^@bango\//, /^monaco-editor(\/.*)?$/] },
    sourcemap: true,
    minify: false,
    emptyOutDir: true
  }
});
