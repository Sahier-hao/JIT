/**
 * Frontend module boundary guard.
 *
 * Stable rules:
 * - app owns the application entry and route composition.
 * - components/ui is the primitive layer and cannot depend on features.
 * - components/shared cannot depend on a business feature.
 * - retired src/pages and src/ui paths cannot reappear.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(FRONTEND_ROOT, 'src')

function walk(dir, output = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, output)
    else if (/\.(tsx?|jsx?)$/.test(entry)) output.push(full)
  }
  return output
}

const files = walk(SRC)
const posix = value => value.replace(/\\/g, '/')
const rel = value => posix(relative(SRC, value))
const sourcePath = value => posix(relative(FRONTEND_ROOT, value))

function resolveImport(file, spec) {
  if (spec.startsWith('@/')) return resolve(SRC, spec.slice(2))
  if (spec.startsWith('.')) return resolve(dirname(file), spec)
  return null
}

function hasBusinessTarget(file, spec) {
  const target = resolveImport(file, spec)
  if (!target) return false
  const targetRel = rel(target)
  return targetRel.startsWith('features/')
}

const violations = []
const retiredPages = resolve(SRC, 'pages')
const retiredUi = resolve(SRC, 'ui')
for (const retired of [retiredPages, retiredUi]) {
  if (statSafe(retired) && readdirSync(retired).length > 0) {
    violations.push(`${sourcePath(retired)} 仍包含文件；业务代码必须位于 features/，基础组件必须位于 components/ui/`)
  }
}

let appEntries = 0
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const fileRel = rel(file)
  if (text.includes('createHashRouter(')) appEntries += 1
  if (fileRel.startsWith('components/ui/')) {
    for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      if (hasBusinessTarget(file, match[1])) violations.push(`${sourcePath(file)} 基础组件反向依赖业务模块：${match[1]}`)
      if (/^(?:@\/|\.\.?\/)/.test(match[1]) && /(?:radix-ui|@radix-ui\/)/.test(match[1])) {
        violations.push(`${sourcePath(file)} 的交互原语引用未通过共享组件入口：${match[1]}`)
      }
    }
  }
  if (fileRel.startsWith('components/shared/')) {
    for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      if (hasBusinessTarget(file, match[1])) violations.push(`${sourcePath(file)} 共享组合反向依赖业务模块：${match[1]}`)
    }
  }
  for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
    const spec = match[1]
    if (spec.includes('/pages/') || spec.includes('/ui/')) {
      const target = resolveImport(file, spec)
      if (target && (target.startsWith(retiredPages) || target.startsWith(retiredUi))) {
        violations.push(`${sourcePath(file)} 引用了退役目录：${spec}`)
      }
    }
  }
}

if (appEntries !== 1) violations.push(`应用入口中的 createHashRouter 应只有 1 处，实际为 ${appEntries} 处`)

function statSafe(path) {
  try { return statSync(path).isDirectory() } catch { return false }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  if (violations.length) {
    console.error(`模块边界检查未通过（${violations.length} 项）：`)
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log(`模块边界检查通过：${files.length} 个源码文件、1 个应用入口、基础层无业务反向依赖。`)
}

export { files, violations }
