import { defineConfig } from '@playwright/test'
import regression from './playwright.regression-pr.config'

export default defineConfig({
  ...regression,
  testMatch: ['pr-account-continuation.spec.ts', 'shadcn-workspaces.spec.ts'],
  outputDir: '../docs/evidence/_run/shadcn-ui/results',
  reporter: [['list'], ['json', { outputFile: '../docs/evidence/_run/shadcn-ui/browser-results.json' }]],
})
