/**
 * Run one browser suite from the shared Playwright config.
 *
 * The shared config starts one isolated backend/frontend pair. Suites that need
 * a fixture mode or dedicated ports declare it here instead of copying the
 * whole webServer block into another config file.
 */
import { spawn } from 'node:child_process'

const suites = {
  acceptance: {},
  'admin-training': {},
  experiments: { JIT_E2E_EXPERIMENT_MODE: '1' },
  'model-package': { JIT_E2E_MODEL_PACKAGE_MODE: '1' },
  'current-schema': { JIT_E2E_CURRENT_SCHEMA_MODE: '1' },
  'bundled-models': { JIT_E2E_BUNDLED_MODEL_MODE: '1' },
  'multi-method': { JIT_FRONTEND_PORT: '18821', JIT_SERVICE_PORT: '18820' },
  'multi-method-explanations': { JIT_FRONTEND_PORT: '18823', JIT_SERVICE_PORT: '18822' },
  predictions: { JIT_FRONTEND_PORT: '18825', JIT_SERVICE_PORT: '18824', JIT_E2E_PREDICTION_MODE: '1' },
}

const name = process.argv[2]
if (!name || !(name in suites)) {
  console.error(`用法：node scripts/e2e.mjs <${Object.keys(suites).join('|')}>`)
  process.exit(2)
}

const child = spawn('npx', ['playwright', 'test', `--project=${name}`], {
  env: { ...process.env, ...suites[name] },
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
child.on('exit', code => process.exit(code ?? 1))
