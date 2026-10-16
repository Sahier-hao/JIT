import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { ensureDir, runEvidenceDir } from './evidence.ts'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    maxWorkers: 2,
    // 本套件大量使用 userEvent 模拟真实输入，jsdom 加并行 worker 下 5 秒默认超时偏紧
    // （曾出现 5077ms 的间歇失败）；真正的挂起仍会在 15 秒内暴露。
    testTimeout: 15000,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    reporters: ['default', 'json'],
    outputFile: { json: `${ensureDir(runEvidenceDir)}/unit-results.json` },
  },
})
