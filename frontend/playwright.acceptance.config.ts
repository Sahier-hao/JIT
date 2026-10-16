import { defineConfig } from '@playwright/test'
import { ensureDir, runEvidenceDir } from './evidence.ts'
import {
  ACCEPTANCE_FRONTEND_PORT,
  ACCEPTANCE_SERVICE_PORT,
  apiTarget,
  frontendUrl,
  numberFromEnv,
} from './e2e/support/ports.ts'

// 隔离浏览器验收入口（任务 1.2/1.3，设计 D8）：
// - 前端 4273、代理指向自有后端 8123，绝不复用或停止默认 4173/8000 服务；
// - 后端进程由 e2e/support/acceptance-setup.ts 启动（复制的模型、独立 SQLite、内存凭据）；
// - 受保护请求场景关闭 trace/HAR 与自动请求正文转储，避免团队凭据进入跟踪文件。
const frontendPort = numberFromEnv('JIT_ACCEPTANCE_FRONTEND_PORT', ACCEPTANCE_FRONTEND_PORT)
const servicePort = numberFromEnv('JIT_ACCEPTANCE_SERVICE_PORT', ACCEPTANCE_SERVICE_PORT)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: `${ensureDir(runEvidenceDir)}/browser-results-acceptance.json` }]],
  use: {
    baseURL: frontendUrl(frontendPort),
    browserName: 'chromium',
    channel: 'msedge',
    trace: 'off',
    video: 'off',
  },
  globalSetup: './e2e/support/acceptance-setup.ts',
  globalTeardown: './e2e/support/acceptance-teardown.ts',
  projects: [
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: frontendUrl(frontendPort),
      reuseExistingServer: false,
      env: { JIT_FRONTEND_PORT: String(frontendPort), JIT_API_PROXY_TARGET: apiTarget(servicePort) },
    },
  ],
})
