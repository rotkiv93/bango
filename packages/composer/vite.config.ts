import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: { index: 'src/index.ts' }, formats: ['es'], fileName: (_format, name) => `${name}.js` },
    rollupOptions: { external: [/^langium(\/.*)?$/] },
    sourcemap: true,
    minify: false,
    emptyOutDir: true
  }
});
