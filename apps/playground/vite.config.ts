import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));

// Relative by default, so the build works from any path: https://<user>.github.io/<repo>/, a subfolder, or a root.
// Set BASE_PATH (e.g. /bango/) to make the asset URLs absolute instead.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [react()],
  worker: { format: 'es' },
  // the playground runs against the library sources, so a change in a package shows up immediately
  resolve: {
    alias: [
      { find: '@bango/core/client', replacement: pkg('core/src/client.ts') },
      { find: '@bango/core', replacement: pkg('core/src/index.ts') },
      { find: '@bango/composer', replacement: pkg('composer/src/index.ts') },
      { find: '@bango/engine/worker', replacement: pkg('engine/src/worker/index.ts') },
      { find: '@bango/engine/workspace', replacement: pkg('engine/src/workspace/index.ts') },
      { find: '@bango/engine', replacement: pkg('engine/src/index.ts') },
      { find: '@bango/renderer/text', replacement: pkg('renderer/src/views/text/index.ts') },
      { find: '@bango/renderer', replacement: pkg('renderer/src/index.ts') }
    ]
  },
  server: { fs: { allow: ['../..'] } }
});
