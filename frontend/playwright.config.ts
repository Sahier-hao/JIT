import { defineConfig } from '@playwright/test'
import { ensureDir, runEvidenceDir } from './evidence.ts'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: `${ensureDir(runEvidenceDir)}/browser-results.json` }]],
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', channel: 'msedge', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    // 用反斜杠的相对命令（cwd 为 ../backend），避免 Windows cmd 把正斜杠路径当成无法识别的命令。
    { command: '.venv\\Scripts\\python.exe -m jit_baseline.cli serve', cwd: '../backend', url: 'http://127.0.0.1:8000/api/review-batch', reuseExistingServer: !process.env.CI },
    { command: 'npm run dev', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
  ],
})
