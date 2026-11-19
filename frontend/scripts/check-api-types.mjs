/** Fail when the committed generated types differ from the curated contract. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const TARGET = resolve(ROOT, 'src/lib/api-generated')
const TEMP = resolve(ROOT, 'src/lib/.api-generated-check')

rmSync(TEMP, { recursive: true, force: true })
const CLI = resolve(ROOT, 'node_modules/@hey-api/openapi-ts/bin/run.js')
const result = spawnSync(process.execPath, [
  CLI,
  '-i', '../docs/api/openapi.yaml',
  '-o', 'src/lib/.api-generated-check',
  '-p', '@hey-api/typescript',
], { stdio: 'inherit', cwd: ROOT })

if (result.status !== 0) {
  rmSync(TEMP, { recursive: true, force: true })
  process.exit(result.status ?? 1)
}

const files = ['index.ts', 'types.gen.ts']
const drift = files.filter(file => {
  const expected = resolve(TARGET, file)
  const actual = resolve(TEMP, file)
  if (!existsSync(expected) || !existsSync(actual)) return true
  return !readFileSync(expected).equals(readFileSync(actual))
})
rmSync(TEMP, { recursive: true, force: true })

if (drift.length) {
  console.error(`OpenAPI 生成类型已过期：${drift.join('、')}。请运行 npm run types:api 后重新提交。`)
  process.exit(1)
}
console.log('OpenAPI 生成类型与 docs/api/openapi.yaml 一致。')
