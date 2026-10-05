import { defineConfig } from 'vite';

// The library build: the engine (types only), Monaco and elkjs are the page's business.
export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts', text: 'src/views/text/index.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    rollupOptions: { external: [/^@bango\//, /^monaco-editor(\/.*)?$/, /^elkjs(\/.*)?$/] },
    sourcemap: true,
    minify: false,
    emptyOutDir: true
  }
});
