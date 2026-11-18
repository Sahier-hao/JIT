import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config.ts'

// 大型仓库会新增项目、模型与训练任务；使用独立验证运行避免污染共享浏览器套件。
export default defineConfig({
  ...baseConfig,
  testMatch: 'admin-training-workbench.spec.ts',
  testIgnore: [],
  outputDir: '../docs/evidence/_run/admin-training-browser/results',
  reporter: [
    ['list'],
    ['json', { outputFile: '../docs/evidence/_run/admin-training-browser/results.json' }],
  ],
})
