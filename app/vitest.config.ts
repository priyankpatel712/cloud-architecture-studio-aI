import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      // The `server-only` guard package throws outside an RSC build; tests run
      // the server modules directly, so stub it out.
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
