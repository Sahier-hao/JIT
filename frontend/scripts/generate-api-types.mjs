/** Regenerate TypeScript types from the curated public OpenAPI contract. */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const CLI = resolve(ROOT, 'node_modules/@hey-api/openapi-ts/bin/run.js')
const result = spawnSync(process.execPath, [
  CLI,
  '-i', '../docs/api/openapi.yaml',
  '-o', 'src/lib/api-generated',
  '-p', '@hey-api/typescript',
], { stdio: 'inherit' })

process.exit(result.status ?? 1)
