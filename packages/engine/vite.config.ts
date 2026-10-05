import { defineConfig } from 'vite';

// The library build: Langium, Comlink and the other Bango packages stay external (peer / dependencies).
export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts', worker: 'src/worker/index.ts', workspace: 'src/workspace/index.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    rollupOptions: { external: [/^langium(\/.*)?$/, /^@bango\//, 'comlink'] },
    sourcemap: true,
    minify: false,
    emptyOutDir: true
  }
});
