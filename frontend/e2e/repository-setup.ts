/**
 * 仓库同步 e2e 的隔离环境：固定日期的小仓库、独立目录库、九个现成的六字段模型（含四种深度方法）。
 *
 * 为什么需要它：默认 e2e 用真实服务与真实目录库，但本机目录库里可能没有可用于
 * 降级的 `openstack-six-v1` 模型；直接跑会让同步停在"没有现成模型"。这里在运行
 * 工作区（`docs/evidence/_run/fixtures`）里建一套一次性环境，既不依赖网络，也不
 * 往真实目录库写记录。
 *
 * 提交内容与作者时间固定，所以提交 SHA 与采集 CSV 稳定；重复运行同一版本时
 * `import_dataset` 走幂等分支。数据源目录在每次运行前清掉，避免旧产物造成
 * `DATASET_EXISTS`。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

const root = resolve(process.cwd(), '..')
const fixtures = resolve(root, 'docs/evidence/_run/fixtures')

/** e2e 专用仓库路径：表单里直接填这个绝对路径（服务端以 `JIT_SYNC_ALLOW_LOCAL=1` 启动）。 */
export const REPOSITORY = resolve(fixtures, 'e2e-repo')
export const LARGE_REPOSITORY = resolve(fixtures, 'e2e-large-repo')
/** e2e 专用目录库：与真实 `backend/storage/catalog.sqlite3` 隔离。 */
export const DATABASE = resolve(fixtures, 'e2e-catalog.sqlite3')
/** 同步采集的数据集版本写到这个隔离目录，避免污染 `backend/data/datasets`。 */
export const DATASET_ROOT = resolve(fixtures, 'e2e-datasets')
export const ARTIFACT_ROOT = resolve(fixtures, 'e2e-artifacts')
const DATASET = resolve(DATASET_ROOT, 'kamei14-git-v1-e2e-repo')
const LARGE_DATASET = resolve(DATASET_ROOT, 'kamei14-git-v1-e2e-large-repo')

function git(...args: string[]) {
  execFileSync('git', ['-C', REPOSITORY, ...args], { env: process.env, stdio: 'pipe' })
}

function gitAt(repo: string, ...args: string[]) {
  execFileSync('git', ['-C', repo, ...args], { env: process.env, stdio: 'pipe' })
}

function commit(subject: string, files: Record<string, string>, moment: string) {
  for (const [name, content] of Object.entries(files)) {
    const target = resolve(REPOSITORY, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  git('add', '-A')
  execFileSync('git', ['-C', REPOSITORY, 'commit', '-q', '-m', subject], {
    env: { ...process.env, GIT_AUTHOR_DATE: moment, GIT_COMMITTER_DATE: moment },
    stdio: 'pipe',
  })
}

function commitAt(repo: string, subject: string, files: Record<string, string>, moment: string) {
  for (const [name, content] of Object.entries(files)) {
    const target = resolve(repo, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  gitAt(repo, 'add', '-A')
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', subject], {
    env: { ...process.env, GIT_AUTHOR_DATE: moment, GIT_COMMITTER_DATE: moment },
    stdio: 'pipe',
  })
}

function largeRepository() {
  mkdirSync(LARGE_REPOSITORY, { recursive: true })
  gitAt(LARGE_REPOSITORY, 'init', '-q', '-b', 'main')
  gitAt(LARGE_REPOSITORY, 'config', 'user.email', 'large-e2e@example.com')
  gitAt(LARGE_REPOSITORY, 'config', 'user.name', 'Large E2E')
  for (let index = 0; index < 300; index += 1) {
    const module = index % 20
    const path = `pkg/module-${module}.py`
    const moment = new Date(Date.UTC(2024, 0, 1 + index)).toISOString().replace('.000Z', '+0000')
    const content = index % 2 === 0
      ? `def value_${index}():\n    return ${index}\n`
      : `def value_${index - 1}():\n    return ${index}\n`
    commitAt(LARGE_REPOSITORY, index % 2 === 0 ? `add module ${index}` : `fix: adjust module ${index - 1}`,
      { [path]: content }, moment)
  }
}

const LINES = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n') + '\n'
const REST = LINES.split('\n').slice(1).join('\n')

export default function globalSetup() {
  for (const target of [REPOSITORY, LARGE_REPOSITORY, DATASET, LARGE_DATASET]) {
    if (!resolve(target).toLowerCase().startsWith(resolve(fixtures).toLowerCase() + sep)) throw new Error('拒绝清理隔离夹具目录之外的路径')
  }
  rmSync(REPOSITORY, { recursive: true, force: true })
  rmSync(LARGE_REPOSITORY, { recursive: true, force: true })
  rmSync(DATASET, { recursive: true, force: true })
  rmSync(LARGE_DATASET, { recursive: true, force: true })
  mkdirSync(REPOSITORY, { recursive: true })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  commit('add module', { 'pkg/a.py': LINES }, '2024-01-01T00:00:00+0000')
  commit('add helper', { 'pkg/b.py': 'helper\n'.repeat(30) }, '2024-01-02T00:00:00+0000')
  commit('fix: adjust module', { 'pkg/a.py': 'line 0 fixed\n' + REST }, '2024-01-03T00:00:00+0000')
  commit('add docs', { 'README.md': 'docs\n' }, '2024-01-04T00:00:00+0000')
  commit('fix: repair helper', { 'pkg/b.py': 'helper\n'.repeat(39) + 'fixed\n' }, '2024-01-05T00:00:00+0000')
  commit('add util', { 'pkg/c.py': 'util\n'.repeat(20) }, '2024-01-06T00:00:00+0000')
  commit('fix: repair util', { 'pkg/c.py': 'util\n'.repeat(19) + 'fixed\n' }, '2024-01-07T10:00:00+0000')
  largeRepository()
}
