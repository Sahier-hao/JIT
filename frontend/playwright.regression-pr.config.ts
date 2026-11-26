import { defineConfig } from '@playwright/test'

/** 持续回归专用：真实隔离服务 + 两个账户的 PR 续审旅程；shadcn 旅程复用同一隔离服务。 */
const python = process.env.JIT_PYTHON ?? '.venv\\Scripts\\python.exe'

export default defineConfig({
  testDir: './e2e',
  outputDir: '../docs/evidence/_run/regression-pr/results',
  timeout: 180_000,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: '../docs/evidence/_run/regression-pr/results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:18861',
    browserName: 'chromium',
    channel: 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'pr-account', testMatch: 'pr-account-continuation.spec.ts' },
    { name: 'guided-evidence', testMatch: 'guided-model-review-evidence.spec.ts' },
    {
      name: 'shadcn',
      testMatch: 'shadcn-workspaces.spec.ts',
      outputDir: '../docs/evidence/_run/shadcn-ui/results',
    },
  ],
  webServer: [
    {
      command: `${python} tests/project_review_preview.py --port 18860`,
      cwd: '../backend',
      env: {
        JIT_FRONTEND_PORT: '18861',
        JIT_REGRESSION_API: 'http://127.0.0.1:18860',
        PYTHONPATH: '.',
        ...(process.env.JIT_PREVIEW_BASELINE ? { JIT_PREVIEW_BASELINE: process.env.JIT_PREVIEW_BASELINE } : {}),
      },
      port: 18860,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: 'node node_modules/vite/bin/vite.js --config vite.config.ts .',
      cwd: '.',
      env: {
        JIT_API_PROXY_TARGET: 'http://127.0.0.1:18860',
        JIT_FRONTEND_PORT: '18861',
      },
      port: 18861,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
