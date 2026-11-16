/**
 * 样式来源守卫。
 *
 * 目的：把"界面样式只有一个来源"落成可执行的检查，而不是靠评审记忆。
 * - src 下的样式表必须在 ALLOWED_STYLE_FILES 登记；每批迁移删除文件时同步收缩清单。
 * - index.css 的样式导入必须是登记过的文件，且不允许新增未登记导入。
 * - 组件与页面不得直接导入页面级 CSS（入口、第三方内容除外）。
 * - @mantine 引用必须在 MANTINE_PENDING 内；收尾时该清单应清空。
 *
 * 用法：`node scripts/check-styles.mjs`（npm run check:styles）。有违规时退出码 1。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(FRONTEND_ROOT, 'src')

/** 当前允许存在的样式表（每批迁移后收缩）。 */
export const ALLOWED_STYLE_FILES = [
  'src/index.css',
  'src/trend.css',
  'src/components/markdown.css',
  'src/components/repository-explanation.css',
  'src/pages/analysis-comparison.css',
  'src/styles/admin.css',
  'src/styles/base.css',
  'src/styles/claude.css',
  'src/styles/components.css',
  'src/styles/dashboard.css',
  'src/styles/modern.css',
  'src/styles/pr-review.css',
  'src/styles/product.css',
  'src/styles/project-redesign.css',
  'src/styles/project-workspace.css',
  'src/styles/project.css',
  'src/styles/research.css',
  'src/styles/tokens.css',
  'src/styles/update-status.css',
  'src/styles/user-workspace.css',
  'src/styles/workbench-modern.css',
  'src/styles/workbench.css',
]

/** index.css 允许的样式导入（包导入如 tailwindcss / @mantine 不在此列）。 */
export const ALLOWED_ENTRY_IMPORTS = [
  './styles/tokens.css',
  './styles/base.css',
  './styles/components.css',
  './styles/product.css',
  './styles/modern.css',
  './styles/admin.css',
  './styles/pr-review.css',
  './styles/workbench.css',
  './styles/update-status.css',
  './styles/project.css',
  './styles/project-workspace.css',
  './styles/claude.css',
  './styles/dashboard.css',
  './styles/project-redesign.css',
  './styles/workbench-modern.css',
]

/** 允许在组件/页面中直接导入的 CSS：入口、第三方内容与迁移中的页面样式。 */
export const ALLOWED_TSX_IMPORTS = [
  ['src/main.tsx', './index.css'],
  ['src/components/Markdown.tsx', './markdown.css'],
  ['src/components/RepositoryExplanation.tsx', './repository-explanation.css'],
  ['src/pages/AnalysisComparison.tsx', './analysis-comparison.css'],
  ['src/pages/LineResearchPage.tsx', '../styles/research.css'],
  ['src/pages/MyDataPage.tsx', '../styles/user-workspace.css'],
  ['src/pages/MyModelsPage.tsx', '../styles/user-workspace.css'],
  ['src/pages/MyTrainingPage.tsx', '../styles/user-workspace.css'],
  ['src/pages/ProfilePage.tsx', '../styles/user-workspace.css'],
  ['src/TrendPage.tsx', './trend.css'],
]

/** 收尾前允许引用 Mantine 的文件；删除依赖时清空。 */
export const MANTINE_PENDING = []

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const toPosix = (path) => relative(FRONTEND_ROOT, path).replace(/\\/g, '/')

/** 收集当前仓库的样式事实。 */
export function readInventory(root = FRONTEND_ROOT) {
  const src = join(root, 'src')
  const files = walk(src)
  const styleFiles = files
    .filter((file) => /\.(css|scss)$/.test(file))
    .map(toPosix)
    .sort()

  const indexCss = readFileSync(join(src, 'index.css'), 'utf8')
  const entryImports = [...indexCss.matchAll(/@import\s+['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((spec) => spec.startsWith('.'))
    .sort()

  const tsxImports = []
  for (const file of files.filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)) {
      if (match[1].startsWith('.')) tsxImports.push([toPosix(file), match[1]])
    }
  }

  const mantineRefs = files
    .filter((f) => /\.(tsx?|jsx?)$/.test(f) && readFileSync(f, 'utf8').includes('@mantine'))
    .map(toPosix)
    .sort()

  return { styleFiles, entryImports, tsxImports, mantineRefs }
}

/** 纯校验：输入样式事实与允许清单，返回违规说明列表。 */
export function validateInventory(inventory, allowed = {
  styleFiles: ALLOWED_STYLE_FILES,
  entryImports: ALLOWED_ENTRY_IMPORTS,
  tsxImports: ALLOWED_TSX_IMPORTS,
  mantineRefs: MANTINE_PENDING,
}, root = FRONTEND_ROOT) {
  const violations = []
  const existing = new Set(inventory.styleFiles)
  const rel = (path) => relative(root, path).replace(/\\/g, '/')

  const allowedFiles = new Set(allowed.styleFiles)
  for (const file of inventory.styleFiles) {
    if (!allowedFiles.has(file)) violations.push(`未登记样式表：${file}（禁止新增页面级 CSS；共享形状放 src/ui）`)
  }

  const allowedEntry = new Set(allowed.entryImports)
  for (const spec of inventory.entryImports) {
    if (!allowedEntry.has(spec)) violations.push(`index.css 出现未登记的样式导入：${spec}`)
    const target = rel(resolve(join(root, 'src'), spec))
    if (!existing.has(target)) violations.push(`index.css 导入的目标不存在：${spec}`)
  }

  const allowedTsx = new Set(allowed.tsxImports.map(([file, css]) => `${file}|${css}`))
  for (const [file, css] of inventory.tsxImports) {
    if (!allowedTsx.has(`${file}|${css}`)) violations.push(`${file} 直接导入了页面级样式：${css}`)
    const target = rel(resolve(dirname(join(root, file)), css))
    if (!existing.has(target)) violations.push(`${file} 导入的样式不存在：${css}`)
  }

  const allowedMantine = new Set(allowed.mantineRefs)
  for (const file of inventory.mantineRefs) {
    if (!allowedMantine.has(file)) violations.push(`新增 Mantine 引用：${file}（新代码使用 src/ui 共享组件）`)
  }

  return violations
}

/** 读取并校验真实仓库。 */
export function checkStyles(root = FRONTEND_ROOT) {
  return validateInventory(readInventory(root))
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  const violations = checkStyles()
  if (violations.length) {
    console.error(`样式来源检查未通过（${violations.length} 项）：`)
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log(`样式来源检查通过：${ALLOWED_STYLE_FILES.length} 个样式表、${ALLOWED_ENTRY_IMPORTS.length} 个入口导入、${MANTINE_PENDING.length} 个待迁移 Mantine 引用。`)
}
