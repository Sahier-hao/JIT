import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config.ts'

// 多方法实验闭环使用独立数据库、模型副本与端口；运行命令：
// JIT_FRONTEND_PORT=18821 JIT_SERVICE_PORT=18820 npx playwright test --config=playwright.multi-method.config.ts
export default defineConfig({
  ...baseConfig,
  testMatch: 'admin-multi-method-experiment.spec.ts',
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  projects: [baseConfig.projects![0]],
  outputDir: '../docs/evidence/_run/multi-method-browser/results',
  reporter: [
    ['list'],
    ['json', { outputFile: '../docs/evidence/_run/multi-method-browser/results.json' }],
  ],
})
