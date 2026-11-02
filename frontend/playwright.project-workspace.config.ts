import { defineConfig } from '@playwright/test'

// 只连接本轮专用预览端口，不执行共享清理、不启动或停止其他服务。
export default defineConfig({
  testDir: './e2e',
  testMatch: ['project-workspace.spec.ts', 'admin-experiments.spec.ts'],
  outputDir: '../docs/evidence/_run/project-workspace-browser/results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: '../docs/evidence/_run/project-workspace-browser/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:18770',
    browserName: 'chromium',
    channel: 'msedge',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
})
