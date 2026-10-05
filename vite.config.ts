import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (p: string) => fileURLToPath(new URL(`./packages/${p}`, import.meta.url));

// Test configuration for every package. Packages are tested from source; `exports` point to dist for published builds.
export default defineConfig({
  resolve: {
    alias: [
      { find: '@bango/composer', replacement: pkg('composer/src/index.ts') },
      { find: '@bango/engine/worker', replacement: pkg('engine/src/worker/index.ts') },
      { find: '@bango/engine', replacement: pkg('engine/src/index.ts') },
      { find: '@bango/renderer/text', replacement: pkg('renderer/src/views/text/index.ts') },
      { find: '@bango/renderer', replacement: pkg('renderer/src/index.ts') }
    ]
  },
  test: { environment: 'node', include: ['packages/*/test/**/*.test.ts'] }
});
