import { defineConfig } from '@playwright/test'
import { ensureDir, runEvidenceDir } from './evidence.ts'
import { DATABASE, DATASET_ROOT, ARTIFACT_ROOT } from './e2e/repository-setup.ts'
import { apiTarget, frontendUrl, numberFromEnv, serviceUrl, DEFAULT_FRONTEND_PORT, DEFAULT_SERVICE_PORT } from './e2e/support/ports.ts'

// 默认浏览器入口：保持历史端口 4173 / 8000，并继续由本配置托管后端与前端进程。
// 当前仅验证聚焦的项目/报告流程；测试服务、模型副本和目录库与开发环境隔离。
const frontendPort = numberFromEnv('JIT_FRONTEND_PORT', DEFAULT_FRONTEND_PORT)
const servicePort = numberFromEnv('JIT_SERVICE_PORT', DEFAULT_SERVICE_PORT)

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/default',
  globalSetup: './e2e/repository-setup.ts',
  fullyParallel: true,
  retries: 0,
  // 历史回放有 1,853 条，纯键盘链路的用例在并行运行时会接近 30 秒；放宽到 60 秒避免误报超时。
  timeout: 60_000,
  // 两个 worker 共用同一隔离目录库；模型策略用例会临时停用模型，若与九模型分析并发，
  // 另一 worker 会在训练阶段收到预期的 MODEL_DISABLED，造成跨用例污染。模型策略是全局状态，
  // 因此浏览器用例必须串行执行。
  workers: 1,
  reporter: [['list'], ['json', { outputFile: `${ensureDir(runEvidenceDir)}/browser-results.json` }]],
  use: { baseURL: frontendUrl(frontendPort), browserName: 'chromium', channel: 'msedge', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    // 用反斜杠的相对命令（cwd 为 ../backend），避免 Windows cmd 把正斜杠路径当成无法识别的命令。
    {
      command: `.venv\\Scripts\\python.exe -m jit_baseline.cli serve --port ${servicePort}`,
      cwd: '../backend',
      url: `${serviceUrl(servicePort)}/api/health`,
      reuseExistingServer: false,
      // 无凭据访问，只有隔离测试允许本地 Git 路径。
      env: {
        JIT_SYNC_ALLOW_LOCAL: '1',
        JIT_FRONTEND_PORT: String(frontendPort),
        JIT_CATALOG_DATABASE: DATABASE,
        JIT_ARTIFACT_ROOT: ARTIFACT_ROOT,
        JIT_DATASET_ROOT: DATASET_ROOT,
      },
    },
    {
      command: 'npm run dev',
      url: frontendUrl(frontendPort),
      reuseExistingServer: false,
      env: { JIT_FRONTEND_PORT: String(frontendPort), JIT_API_PROXY_TARGET: apiTarget(servicePort) },
    },
  ],
})
