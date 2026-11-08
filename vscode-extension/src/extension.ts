import * as vscode from 'vscode'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'
import {
  identity, parseReport, validLine, type AnalysisCandidate, type AnalysisCommit,
  type CommitAnalysisReport, type IdentityResult,
} from './report'

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

async function gitHead(folder: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', folder, 'rev-parse', 'HEAD'])
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function gitDirty(folder: string): Promise<boolean> {
  try {
    const { stdout } = await run('git', ['-C', folder, 'status', '--porcelain'])
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function recomputeIdentity(): Promise<void> {
  if (!tree.report) { tree.identity = null; tree.refresh(); return }
  const folder = workspaceFolder()
  const head = folder ? await gitHead(folder.uri.fsPath) : null
  const dirty = folder ? await gitDirty(folder.uri.fsPath) : false
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
  if (tree.identity?.state !== 'match') {
    vscode.window.showWarningMessage(tree.identity?.message ?? '报告身份未核对，不在当前代码上定位。')
    return
  }
  const folder = workspaceFolder()
  if (!folder) { vscode.window.showWarningMessage('当前没有工作区，无法定位文件。'); return }
  const absolute = path.join(folder.uri.fsPath, relativePath)
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute))
    const options: vscode.TextDocumentShowOptions = { preview: true }
    if (line !== null) {
      if (!validLine(document.getText(), line)) {
        vscode.window.showWarningMessage(`${relativePath} 只有 ${document.lineCount} 行，报告行号 ${line} 已过期。`)
        return
      }
      const position = new vscode.Position(line - 1, 0)
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
