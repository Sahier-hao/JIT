import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { ensureDir, runEvidenceDir } from './evidence.ts'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    maxWorkers: 2,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    reporters: ['default', 'json'],
    outputFile: { json: `${ensureDir(runEvidenceDir)}/unit-results.json` },
  },
})
