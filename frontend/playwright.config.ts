import { defineConfig } from '@playwright/test'
import { ensureDir, runEvidenceDir } from './evidence.ts'
import { apiTarget, frontendUrl, numberFromEnv, serviceUrl, DEFAULT_FRONTEND_PORT, DEFAULT_SERVICE_PORT } from './e2e/support/ports.ts'

// 默认浏览器入口：保持历史端口 4173 / 8000，并继续由本配置托管后端与前端进程。
// 隔离验收使用 playwright.acceptance.config.ts（4273 / 8123 + 自有服务生命周期夹具）。
const frontendPort = numberFromEnv('JIT_FRONTEND_PORT', DEFAULT_FRONTEND_PORT)
const servicePort = numberFromEnv('JIT_SERVICE_PORT', DEFAULT_SERVICE_PORT)

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/acceptance.spec.ts',
  fullyParallel: true,
  retries: 0,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: `${ensureDir(runEvidenceDir)}/browser-results.json` }]],
  use: { baseURL: frontendUrl(frontendPort), browserName: 'chromium', channel: 'msedge', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    // 用反斜杠的相对命令（cwd 为 ../backend），避免 Windows cmd 把正斜杠路径当成无法识别的命令。
    {
      command: '.venv\\Scripts\\python.exe -m jit_baseline.cli serve',
      cwd: '../backend',
      url: `${serviceUrl(servicePort)}/api/review-batch`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev',
      url: frontendUrl(frontendPort),
      reuseExistingServer: false,
      env: { JIT_FRONTEND_PORT: String(frontendPort), JIT_API_PROXY_TARGET: apiTarget(servicePort) },
    },
  ],
})
