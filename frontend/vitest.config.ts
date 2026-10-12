import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    maxWorkers: 2,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    reporters: ['default', 'json'],
    outputFile: { json: '../docs/evidence/connect-public-data-baseline-review/unit-results.json' },
  },
})
