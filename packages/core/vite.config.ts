import { defineConfig } from 'vite';

// The library build: Comlink stays external (a dependency).
export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts', client: 'src/client.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    rollupOptions: { external: ['comlink'] },
    sourcemap: true,
    minify: false,
    emptyOutDir: true
  }
});
