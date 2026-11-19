import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    maxWorkers: 1,
    testTimeout: 5000,
    include: ['src/lib/sprint2Core.test.ts'],
    setupFiles: [],
    reporters: ['default', 'json'],
    outputFile: '../.cache/sprint2-unit/frontend-results.json',
    coverage: {
      provider: 'v8',
      enabled: true,
      include: ['src/lib/domain.ts'],
      reporter: ['text', 'json', 'html'],
      reportsDirectory: '../.cache/sprint2-unit/frontend-coverage',
    },
  },
})
