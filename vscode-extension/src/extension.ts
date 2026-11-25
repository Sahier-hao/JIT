import * as vscode from 'vscode'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'
import {
  identity, parseReport, validLine, type AnalysisCandidate, type AnalysisCommit,
  type CommitAnalysisReport, type IdentityResult,
} from './report'
import { buildAnalyzeCommand } from './command'

const run = promisify(execFile)
const REPORT_KEY = 'jitReport.path'
const MAX_BYTES = 64 * 1024 * 1024

type Node =
  | { kind: 'status' }
  | { kind: 'heading'; label: string }
  | { kind: 'commit'; commit: AnalysisCommit }
  | { kind: 'candidate'; candidate: AnalysisCandidate }

class ReportTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>()
  readonly onDidChangeTreeData = this.changed.event
  report: CommitAnalysisReport | null = null
  identity: IdentityResult | null = null
  reportPath = ''

  refresh(): void {
    this.changed.fire(undefined)
  }

  getChildren(element?: Node): Node[] {
    if (!this.report) return []
    if (!element) {
      return [
        { kind: 'status' },
        { kind: 'heading', label: `提交（${this.report.commits.length}）` },
        ...this.report.commits.map(commit => ({ kind: 'commit' as const, commit })),
        { kind: 'heading', label: `静态候选（${this.report.candidates.length}）` },
        ...this.report.candidates.map(candidate => ({ kind: 'candidate' as const, candidate })),
      ]
    }
    if (element.kind === 'heading') return []
    return []
  }

  getTreeItem(element: Node): vscode.TreeItem {
    if (element.kind === 'status') {
      const item = new vscode.TreeItem(this.identity?.message ?? '未导入报告')
      item.iconPath = new vscode.ThemeIcon(
        this.identity?.state === 'match' ? 'pass' : this.identity?.state === 'stale' ? 'warning' : 'info')
      item.tooltip = this.reportPath
      return item
    }
    if (element.kind === 'heading') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded)
      item.iconPath = new vscode.ThemeIcon('list-unordered')
      return item
    }
    if (element.kind === 'commit') {
      const commit = element.commit
      const item = new vscode.TreeItem(
        `${commit.commitId.slice(0, 10)} · ${commit.risk.toFixed(3)} ${commit.subject || '(no subject)'}`)
      item.description = `${commit.files} 个文件`
      item.tooltip = `${commit.authorName} · ${commit.time}\n分数是提交级模型估计，不是缺陷概率。`
      item.command = { command: 'jitReport.openCommit', title: '打开提交文件', arguments: [commit] }
      item.iconPath = new vscode.ThemeIcon('git-commit')
      return item
    }
    const candidate = element.candidate
    const item = new vscode.TreeItem(`${candidate.path}:${candidate.line} · ${candidate.ruleId}`)
    item.description = candidate.suggestion?.title ?? candidate.message
    item.tooltip = [candidate.message, candidate.evidence,
      candidate.suggestion?.rationale ?? ''].filter(Boolean).join('\n\n')
    item.command = { command: 'jitReport.openCandidate', title: '打开候选位置', arguments: [candidate] }
    item.iconPath = new vscode.ThemeIcon('location')
    return item
  }
}

let tree: ReportTree
let extensionContext: vscode.ExtensionContext

function workspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0]
}

/** 本地只读 Git 核对不继承宿主注入的命令行配置，避免 GIT_CONFIG_* 污染解析。 */
function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'GIT_CONFIG_PARAMETERS' || key === 'GIT_CONFIG_COUNT'
      || key.startsWith('GIT_CONFIG_KEY_') || key.startsWith('GIT_CONFIG_VALUE_')) {
      delete env[key]
    }
  }
  return env
}

async function gitHead(folder: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', folder, 'rev-parse', 'HEAD'], { env: gitEnv() })
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function gitDirty(folder: string): Promise<boolean | null> {
  try {
    const { stdout } = await run('git', ['-C', folder, 'status', '--porcelain'], { env: gitEnv() })
    return stdout.trim().length > 0
  } catch {
    // 读不到工作树状态时不能当作“干净”：宁可拒绝定位，也不在可能已改动的代码上标注。
    return null
  }
}

/** 单个路径在工作树中的状态；空表示与 HEAD 一致。 */
async function gitPathStatus(folder: string, relativePath: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', folder, 'status', '--porcelain', '--', relativePath], { env: gitEnv() })
    return stdout.trim()
  } catch {
    return 'git-status-failed'
  }
}

function insideWorkspace(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root)
  const absolute = path.resolve(resolvedRoot, relativePath)
  if (absolute !== resolvedRoot && !absolute.startsWith(resolvedRoot + path.sep)) return null
  return absolute
}

async function recomputeIdentity(): Promise<void> {
  if (!tree.report) { tree.identity = null; tree.refresh(); return }
  const folder = workspaceFolder()
  const head = folder ? await gitHead(folder.uri.fsPath) : null
  const dirty = folder ? await gitDirty(folder.uri.fsPath) : null
  tree.identity = identity(tree.report, head, dirty)
  tree.refresh()
}

async function load(pathValue: string): Promise<void> {
  const stat = await vscode.workspace.fs.stat(vscode.Uri.file(pathValue))
  if (stat.size > MAX_BYTES) throw new Error('报告超过 64 MiB，拒绝读取')
  const raw = await readFile(pathValue, 'utf8')
  tree.report = parseReport(JSON.parse(raw))
  tree.reportPath = pathValue
  await extensionContext.workspaceState.update(REPORT_KEY, pathValue)
  await recomputeIdentity()
  const target = tree.report.repository.headSha.slice(0, 12)
  vscode.window.showInformationMessage(
    `已导入 ${tree.report.commits.length} 个提交、${tree.report.candidates.length} 个候选（目标提交 ${target}）。`)
}

async function openAt(relativePath: string, line: number | null): Promise<void> {
  if (!tree.report) { vscode.window.showWarningMessage('先导入 JIT 提交分析报告。'); return }
  if (tree.identity?.state !== 'match' && tree.identity?.state !== 'dirty') {
    vscode.window.showWarningMessage(tree.identity?.message ?? '报告身份未核对，不在当前代码上定位。')
    return
  }
  const folder = workspaceFolder()
  if (!folder) { vscode.window.showWarningMessage('当前没有工作区，无法定位文件。'); return }
  const absolute = insideWorkspace(folder.uri.fsPath, relativePath)
  if (absolute === null) {
    vscode.window.showWarningMessage(`路径越出工作区，拒绝打开：${relativePath}`)
    return
  }
  let effectiveLine = line
  if (tree.identity?.state === 'dirty' && line !== null) {
    const status = await gitPathStatus(folder.uri.fsPath, relativePath)
    if (status) {
      vscode.window.showWarningMessage(
        `${relativePath} 在工作树中有未提交改动（${String(status).split(String.fromCharCode(10))[0]}）；按报告快照只读打开，不跳到报告行号。`)
      effectiveLine = null
    }
  }
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute))
    const options: vscode.TextDocumentShowOptions = { preview: true }
    if (effectiveLine !== null) {
      if (!validLine(document.getText(), effectiveLine)) {
        vscode.window.showWarningMessage(`${relativePath} 只有 ${document.lineCount} 行，报告行号 ${effectiveLine} 已过期。`)
        return
      }
      const position = new vscode.Position(effectiveLine - 1, 0)
      options.selection = new vscode.Range(position, position)
    }
    await vscode.window.showTextDocument(document, options)
  } catch {
    vscode.window.showWarningMessage(`文件不可用：${relativePath}`)
  }
}

async function importReport(pathValue?: string): Promise<void> {
  let target = pathValue
  if (!target) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false, filters: { 'JIT 报告': ['json'] }, title: '选择提交分析报告',
    })
    if (!picked?.length) return
    target = picked[0].fsPath
  }
  try { await load(target) }
  catch (error) { vscode.window.showErrorMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`) }
}

async function input(title: string, value?: string, prompt?: string): Promise<string | undefined> {
  return vscode.window.showInputBox({ title, value, prompt, ignoreFocusOut: true })
}

async function copyAnalyzeCommand(): Promise<void> {
  const folder = workspaceFolder()?.uri.fsPath ?? process.cwd()
  const backend = await input('后端目录', `${folder}/backend`)
  if (backend === undefined) return
  const python = await input('Python 可执行文件', process.platform === 'win32' ? 'python' : 'python3')
  if (python === undefined) return
  const base = await input('基准提交', 'HEAD~10')
  if (base === undefined) return
  const head = await input('目标提交', 'HEAD')
  if (head === undefined) return
  const modelId = await input('已登记模型 ID', '', '从管理工作区的模型详情复制真实 modelId')
  if (modelId === undefined) return
  const database = await input('目录库路径', `${backend}/storage/catalog.sqlite3`)
  if (database === undefined) return
  const artifactRoot = await input('模型产物根目录', `${backend}/artifacts`)
  if (artifactRoot === undefined) return
  const output = await input('报告输出路径', `${folder}/jit-report.json`)
  if (output === undefined) return
  try {
    const command = buildAnalyzeCommand({
      backend, python, repo: folder, base, head, modelId, database, artifactRoot, output,
    })
    await vscode.env.clipboard.writeText(command)
    vscode.window.showInformationMessage('报告生成命令已复制。请在后端 Python 环境运行，再用「JIT: 导入提交分析报告」导入结果。')
  } catch (error) {
    vscode.window.showErrorMessage(`无法生成命令：${error instanceof Error ? error.message : String(error)}`)
  }
}

export function activate(context: vscode.ExtensionContext): {
  importReport: (path: string) => Promise<void>
  getState: () => object
} {
  extensionContext = context
  tree = new ReportTree()
  context.subscriptions.push(vscode.window.registerTreeDataProvider('jitReport.view', tree))
  context.subscriptions.push(
    vscode.commands.registerCommand('jitReport.import', async (uri?: vscode.Uri) => {
      await importReport(uri?.fsPath)
    }),
    vscode.commands.registerCommand('jitReport.refresh', async () => {
      await recomputeIdentity()
      vscode.window.showInformationMessage(tree.identity?.message ?? '尚未导入报告。')
    }),
    vscode.commands.registerCommand('jitReport.clear', async () => {
      tree.report = null; tree.identity = null; tree.reportPath = ''
      await context.workspaceState.update(REPORT_KEY, undefined)
      tree.refresh()
    }),
    vscode.commands.registerCommand('jitReport.copyGenerateCommand', copyAnalyzeCommand),
    vscode.commands.registerCommand('jitReport.openCommit', async (commit: AnalysisCommit) => {
      const first = commit.filePaths[0]
      if (!first) { vscode.window.showInformationMessage('该提交没有可打开的文件路径。'); return }
      await openAt(first, null)
    }),
    vscode.commands.registerCommand('jitReport.openCandidate', async (candidate: AnalysisCandidate) => {
      await openAt(candidate.path, candidate.line)
    }),
  )
  const saved = context.workspaceState.get<string>(REPORT_KEY)
  if (saved) void load(saved).catch(() => { /* 旧路径失效时保持空视图 */ })
  return {
    importReport: (pathValue: string) => load(pathValue),
    getState: () => ({
      reportPath: tree.reportPath,
      commits: tree.report?.commits.length ?? 0,
      candidates: tree.report?.candidates.length ?? 0,
      identity: tree.identity,
    }),
  }
}

export function deactivate(): void { /* 无后台资源 */ }
