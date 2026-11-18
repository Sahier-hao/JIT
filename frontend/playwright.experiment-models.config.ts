import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config.ts'

const webServer = Array.isArray(baseConfig.webServer)
  ? baseConfig.webServer.map((server, index) => index === 0
      ? { ...server, env: { ...server.env, JIT_E2E_EXPERIMENT_MODE: '1' } }
      : server)
  : baseConfig.webServer

export default defineConfig({
  ...baseConfig,
  testMatch: 'experiment-model-promotion.spec.ts',
  testIgnore: [],
  outputDir: '../docs/evidence/_run/experiment-model-browser/results',
  reporter: [
    ['list'],
    ['json', { outputFile: '../docs/evidence/_run/experiment-model-browser/results.json' }],
  ],
  webServer,
})
