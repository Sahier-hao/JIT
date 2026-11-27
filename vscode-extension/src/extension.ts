import * as vscode from 'vscode'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'
import {
  identity, parseReport, validLine, type AnalysisCandidate, type AnalysisCommit,
  type CommitAnalysisReport, type IdentityResult,
} from './report'
import { buildAnalyzeCommand } from './command'
import { analyzeCommitRange, errorText } from './analyze'
import { candidateEntries, formatRisk, summarize } from './checker'
import { explanationMarkdown } from './explanation'
import { listCommitModels, modelChoices, type CommitModel } from './models'
import {
  defaultInterpreter, readSettings, resolveEnvironment, resolveSettings, type CheckSettings,
  type ResolvedEnvironment,
} from './settings'

const run = promisify(execFile)
const REPORT_KEY = 'jitReport.path'
const MAX_BYTES = 64 * 1024 * 1024

type Node =
  | { kind: 'status' }
  | { kind: 'heading'; label: string }
  | { kind: 'commit'; commit: AnalysisCommit }
  | { kind: 'explanation'; commit: AnalysisCommit }
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
        { kind: 'heading', label: `可疑代码行（${this.report.candidates.length}）` },
        ...this.report.candidates.map(candidate => ({ kind: 'candidate' as const, candidate })),
      ]
    }
    if (element.kind === 'heading') return []
    if (element.kind === 'commit') return [{ kind: 'explanation', commit: element.commit }]
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
        `${commit.commitId.slice(0, 10)} ${commit.subject || '(no subject)'}`)
      item.description = `提交级预测分数 ${commit.risk.toFixed(3)} · ${commit.files} 个文件`
      item.tooltip = `${commit.authorName} · ${commit.time}\n提交级预测分数 ${commit.risk.toFixed(6)}（模型估计，不是缺陷概率）\n模型：${this.report?.model.name ?? '未提供'}`
      item.command = { command: 'jitReport.openCommit', title: '打开提交文件', arguments: [commit] }
      item.iconPath = new vscode.ThemeIcon('git-commit')
      item.contextValue = 'jitCommit'
      return item
    }
    if (element.kind === 'explanation') {
      const item = new vscode.TreeItem('查看提交解释')
      item.description = element.commit.commitId.slice(0, 10)
      item.tooltip = '只读展示提交 SHA、模型身份、提交级预测分数、中文摘要与 Top 特征贡献。'
      item.command = {
        command: 'jitReport.showExplanation',
        title: '查看提交解释',
        arguments: [element.commit],
      }
      item.iconPath = new vscode.ThemeIcon('book')
      item.contextValue = 'jitCommitExplanation'
      return item
    }
    const candidate = element.candidate
    const item = new vscode.TreeItem(`${candidate.path}:${candidate.line} · ${candidate.ruleId}`)
    item.description = candidate.message || candidate.evidence || '可疑代码行'
    item.tooltip = [
      `规则 ID：${candidate.ruleId}`,
      `说明：${candidate.message || '静态规则命中'}`,
      `命中证据：${candidate.evidence || '未提供'}`,
      candidate.suggestion?.rationale ?? '',
    ].filter(Boolean).join('\n\n')
    item.command = { command: 'jitReport.openCandidate', title: '打开可疑代码行位置', arguments: [candidate] }
    item.iconPath = new vscode.ThemeIcon('location')
    item.contextValue = 'jitCandidate'
    return item
  }
}

let tree: ReportTree
let extensionContext: vscode.ExtensionContext
let statusBar: vscode.StatusBarItem
let diagnostics: vscode.DiagnosticCollection
let outputChannel: vscode.OutputChannel
let repoRoot: string | null = null
let lastHead: string | null = null
let checkTimer: NodeJS.Timeout | undefined
let checking = false
let pendingCheck = false
let missingConfigNotified = false
let explanationSequence = 0

/** 只读虚拟 Markdown 文档；报告内容只作为文本数据，不注入 Webview 或命令。 */
class ExplanationProvider implements vscode.TextDocumentContentProvider {
  private readonly values = new Map<string, string>()
  private readonly changed = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidChange = this.changed.event

  put(key: string, content: string): vscode.Uri {
    this.values.set(key, content)
    return vscode.Uri.parse(`jit-commit-explanation:/${key}.md`)
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.values.get(uri.path.replace(/^\//, '').replace(/\.md$/, ''))
      ?? '提交解释不可用。'
  }

  dispose(): void {
    this.values.clear()
    this.changed.dispose()
  }
}

let explanationProvider: ExplanationProvider

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
  if (!tree.report) {
    tree.identity = null
    diagnostics?.clear()
    tree.refresh()
    return
  }
  const folder = workspaceFolder()
  const head = folder ? await gitHead(folder.uri.fsPath) : null
  const dirty = folder ? await gitDirty(folder.uri.fsPath) : null
  tree.identity = identity(tree.report, head, dirty)
  tree.refresh()
  await refreshDiagnostics()
}

async function load(pathValue: string, silent = false): Promise<void> {
  const stat = await vscode.workspace.fs.stat(vscode.Uri.file(pathValue))
  if (stat.size > MAX_BYTES) throw new Error('报告超过 64 MiB，拒绝读取')
  const raw = await readFile(pathValue, 'utf8')
  tree.report = parseReport(JSON.parse(raw))
  tree.reportPath = pathValue
  await extensionContext.workspaceState.update(REPORT_KEY, pathValue)
  await recomputeIdentity()
  if (silent) return
  const target = tree.report.repository.headSha.slice(0, 12)
  vscode.window.showInformationMessage(
    `已导入 ${tree.report.commits.length} 个提交、${tree.report.candidates.length} 条可疑代码行（目标提交 ${target}）。`)
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
  const python = await input('Python 可执行文件', defaultInterpreter(backend))
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

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function withinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function firstLines(text: string, count = 4): string {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  return lines.slice(0, count).join(' ') || text.slice(0, 300)
}

function setStatus(text: string, tooltip: string, command: string, warning = false): void {
  statusBar.text = text
  statusBar.tooltip = tooltip
  statusBar.command = command
  statusBar.backgroundColor = warning ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined
  statusBar.show()
}

function updateIdleStatus(settings: CheckSettings): void {
  if (!settings.modelId) {
    setStatus('$(shield) JIT 未配置', '点击配置提交后自动检查', 'jitReport.configure')
    return
  }
  setStatus('$(shield) JIT 待检查',
    settings.autoCheck ? '提交后自动检查已开启；点击立即检查' : '自动检查已关闭；点击立即检查',
    'jitReport.checkHead')
}

/** 工作树里已改动的文件不画报告行号，避免把旧快照标到新内容上。 */
async function gitChangedPaths(root: string): Promise<Set<string>> {
  const changed = new Set<string>()
  try {
    const { stdout } = await run('git', ['-C', root, 'status', '--porcelain'], { env: gitEnv() })
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) continue
      let value = line.slice(3).trim()
      if (value.includes(' -> ')) value = value.split(' -> ').pop() ?? value
      changed.add(value.replace(/^"|"$/g, '').replace(/\\/g, '/'))
    }
  } catch {
    // 读不到改动状态时保留全部候选，让 Problems 与报告保持一致。
  }
  return changed
}

async function refreshDiagnostics(): Promise<void> {
  diagnostics.clear()
  const folder = workspaceFolder()
  if (!folder || !tree.report || !repoRoot) return
  if (tree.identity?.state !== 'match' && tree.identity?.state !== 'dirty') return
  if (!readSettings(folder).showCandidates) return
  const changed = tree.identity.state === 'dirty' ? await gitChangedPaths(repoRoot) : new Set<string>()
  const grouped = new Map<string, ReturnType<typeof candidateEntries>>()
  for (const entry of candidateEntries(tree.report)) {
    if (changed.has(entry.path)) continue
    const absolute = path.resolve(repoRoot, entry.path)
    if (!withinRoot(folder.uri.fsPath, absolute)) continue
    const list = grouped.get(absolute) ?? []
    list.push(entry)
    grouped.set(absolute, list)
  }
  for (const [absolute, entries] of grouped) {
    let bytes: Uint8Array
    try {
      bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absolute))
    } catch {
      continue
    }
    const lines = Buffer.from(bytes).toString('utf8').split(/\r\n|\r|\n/)
    const items: vscode.Diagnostic[] = []
    for (const entry of entries) {
      if (entry.line > lines.length) continue
      const end = lines[entry.line - 1].trimEnd().length
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(entry.line - 1, 0, entry.line - 1, end),
        entry.message, vscode.DiagnosticSeverity.Warning)
      diagnostic.source = 'JIT 可疑代码行'
      diagnostic.code = entry.ruleId
      items.push(diagnostic)
    }
    if (items.length) diagnostics.set(vscode.Uri.file(absolute), items)
  }
}

function diagnosticCount(): number {
  let total = 0
  diagnostics.forEach((_uri, items) => { total += items.length })
  return total
}

async function gitRoot(folder: vscode.WorkspaceFolder): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', folder.uri.fsPath, 'rev-parse', '--show-toplevel'],
      { env: gitEnv() })
    const value = stdout.trim()
    return value ? path.resolve(value) : null
  } catch {
    return null
  }
}

async function parentCommit(root: string, head: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', root, 'rev-parse', '--verify', `${head}~1^{commit}`],
      { env: gitEnv() })
    return stdout.trim() || null
  } catch {
    return null
  }
}

function reportOutputPath(head: string): string {
  return path.join(extensionContext.globalStorageUri.fsPath, 'reports',
    `${Date.now()}-${head.slice(0, 12)}.json`)
}

async function pruneReports(): Promise<void> {
  const dir = path.join(extensionContext.globalStorageUri.fsPath, 'reports')
  try {
    const files = (await readdir(dir)).filter(name => name.endsWith('.json')).sort()
    for (const name of files.slice(0, Math.max(0, files.length - 20))) {
      await unlink(path.join(dir, name)).catch(() => undefined)
    }
  } catch {
    // 目录不存在时无需清理。
  }
}

function scheduleCheck(): void {
  const folder = workspaceFolder()
  if (!folder || !readSettings(folder).autoCheck) return
  if (checkTimer) clearTimeout(checkTimer)
  checkTimer = setTimeout(() => {
    checkTimer = undefined
    void runCheck('auto')
  }, 1500)
}

async function runCheck(trigger: 'auto' | 'manual'): Promise<void> {
  const folder = workspaceFolder()
  if (!folder) return
  const settings = readSettings(folder)
  if (trigger === 'auto' && !settings.autoCheck) return
  if (checking) {
    pendingCheck = true
    return
  }
  const resolved = resolveSettings(folder, settings)
  if (!resolved.settings) {
    const issue = resolved.issue ?? 'JIT 提交检查未配置完成。'
    setStatus('$(warning) JIT 未就绪', issue, 'jitReport.configure')
    if (!missingConfigNotified) {
      missingConfigNotified = true
      void vscode.window.showWarningMessage(issue, '去配置').then(action => {
        if (action === '去配置') void configure()
      })
    }
    return
  }
  const check = resolved.settings
  const root = repoRoot ?? await gitRoot(folder)
  if (!root) {
    setStatus('$(warning) JIT 非 Git 仓库', '当前工作区没有 Git 仓库', 'jitReport.configure')
    return
  }
  const head = await gitHead(root)
  if (!head) {
    setStatus('$(error) JIT 无法读取提交', 'git rev-parse HEAD 失败', 'jitReport.checkHead')
    return
  }
  const base = await parentCommit(root, head)
  if (!base) {
    setStatus('$(shield) JIT 首个提交', '没有父提交，无法计算提交特征', 'jitReport.checkHead')
    return
  }
  checking = true
  setStatus('$(sync~spin) JIT 分析中', '正在分析最近一次提交', 'jitReport.checkHead')
  outputChannel.appendLine(`[${new Date().toISOString()}] 检查 ${base.slice(0, 10)}..${head.slice(0, 10)}（${trigger}）`)
  try {
    const output = reportOutputPath(head)
    await mkdir(path.dirname(output), { recursive: true })
    await analyzeCommitRange({
      backend: check.backend,
      python: check.python,
      pythonArgs: check.pythonArgs,
      repo: root,
      base,
      head,
      modelId: check.modelId,
      database: check.database,
      artifactRoot: check.artifacts,
      output,
    })
    await load(output, true)
    showSummary(readSettings(folder), trigger)
    await pruneReports()
  } catch (error) {
    const message = firstLines(errorText(error))
    outputChannel.appendLine(`[${new Date().toISOString()}] 检查失败：${errorText(error)}`)
    setStatus('$(error) JIT 检查失败', message, 'jitReport.checkHead')
    if (trigger === 'manual') void vscode.window.showErrorMessage(`JIT 检查失败：${message}`)
  } finally {
    checking = false
    if (pendingCheck) {
      pendingCheck = false
      setTimeout(() => void runCheck('auto'), 800)
    }
  }
}

function showSummary(settings: CheckSettings, trigger: 'auto' | 'manual'): void {
  const report = tree.report
  if (!report) return
  const summary = summarize(report)
  if (summary.risk === null) {
    setStatus('$(shield) JIT 未评分', '本次提交没有可评分的改动（可能是合并提交）', 'jitReport.checkHead')
    if (trigger === 'manual') void vscode.window.showInformationMessage('JIT：本次提交没有可评分的改动。')
    return
  }
  const score = formatRisk(summary.risk)
  const high = summary.risk >= settings.riskThreshold
  const tooltip = [
    `${summary.commitId?.slice(0, 10) ?? ''} ${summary.subject}`.trim(),
    `提交级预测分数 ${summary.risk.toFixed(6)}（模型估计，不是缺陷概率）`,
    `可疑代码行 ${summary.candidates} 条`,
    report.model.name ? `模型 ${report.model.name}` : '',
  ].filter(Boolean).join('\n')
  setStatus(`$(shield) JIT 提交级 ${score}`, tooltip, 'jitReport.checkHead', high)
  if (trigger === 'auto' && !high && summary.candidates === 0) return
  const topCommit = report.commits.find(commit => commit.commitId === summary.commitId)
    ?? report.commits[0] ?? null
  const actions = [
    ...(summary.candidates > 0 ? ['查看问题'] : []),
    ...(topCommit ? ['查看解释'] : []),
    '详情',
  ]
  void vscode.window.showInformationMessage(
    `JIT：提交级预测分数 ${score}，${summary.candidates} 条可疑代码行。`, ...actions).then(action => {
    if (action === '查看问题') void vscode.commands.executeCommand('workbench.actions.view.problems')
    if (action === '查看解释' && topCommit) void showExplanation(topCommit)
    if (action === '详情') void vscode.commands.executeCommand('jitReport.view.focus')
  })
}

async function showExplanation(commit?: AnalysisCommit): Promise<void> {
  if (!tree.report) {
    void vscode.window.showWarningMessage('先导入或生成一份提交分析报告。')
    return
  }
  let selected = commit ?? null
  if (selected && !tree.report.commits.some(item => item.commitId === selected?.commitId)) {
    void vscode.window.showWarningMessage('所选提交不属于当前报告。')
    return
  }
  if (!selected) {
    if (tree.report.commits.length === 1) {
      selected = tree.report.commits[0]
    } else {
      const picked = await vscode.window.showQuickPick(
        tree.report.commits.map(item => ({
          label: `${item.commitId.slice(0, 10)} · 提交级预测分数 ${item.risk.toFixed(3)}`,
          description: item.subject,
          detail: item.explanation?.summary,
          commit: item,
        })),
        { title: '选择要查看解释的提交', matchOnDescription: true },
      )
      if (!picked) return
      selected = picked.commit
    }
  }
  if (!selected) return
  explanationSequence += 1
  const key = `${explanationSequence}-${selected.commitId.slice(0, 12)}`
  const uri = explanationProvider.put(key, explanationMarkdown(tree.report, selected))
  await vscode.window.showTextDocument(uri, { preview: true })
}

async function chooseModel(environment: ResolvedEnvironment, currentId: string): Promise<string | undefined> {
  let models: CommitModel[]
  try {
    models = await listCommitModels({
      backend: environment.backend,
      python: environment.python,
      pythonArgs: environment.pythonArgs,
      database: environment.database,
      artifactRoot: environment.artifacts,
    })
  } catch (error) {
    const detail = firstLines(errorText(error))
    outputChannel.appendLine(`[${new Date().toISOString()}] 模型列表不可用：${detail}`)
    return input('模型 ID', currentId, '模型列表命令不可用，请手动输入目录库中的真实已登记模型 ID')
  }
  if (models.length === 0) {
    void vscode.window.showWarningMessage(
      '目录库中没有已启用、ready 且支持提交采集字段的模型。请先在 JIT 管理工作区登记并启用模型。')
    return undefined
  }
  const choices = modelChoices(models, currentId).map(choice => ({
    label: choice.label,
    description: choice.description,
    detail: choice.detail,
    modelId: choice.model.modelId,
  }))
  const picked = await vscode.window.showQuickPick(choices, {
    title: '选择提交检查模型',
    placeHolder: currentId
      ? `当前模型 ${currentId}；从真实可用模型中选择`
      : '只列出已启用、ready 且与提交采集字段兼容的模型',
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  })
  return picked?.modelId
}

async function configure(): Promise<void> {
  const folder = workspaceFolder()
  if (!folder) {
    void vscode.window.showWarningMessage('请先打开仓库根目录。')
    return
  }
  const settings = readSettings(folder)
  const backend = await chooseBackend(folder, settings)
  if (backend === undefined) return
  if (!existsSync(path.join(backend.trim(), 'jit_baseline'))) {
    void vscode.window.showErrorMessage(
      `后端目录不可用：${backend.trim()}。请选择包含 jit_baseline 的 backend 目录。`)
    return
  }
  const python = await input('Python 可执行文件',
    settings.pythonPath && existsSync(settings.pythonPath) ? settings.pythonPath : defaultInterpreter(backend),
    '本机运行 jit_baseline 的解释器')
  if (python === undefined) return
  const database = await input('目录库路径',
    settings.databasePath && existsSync(settings.databasePath)
      ? settings.databasePath
      : path.join(backend, 'storage', 'catalog.sqlite3'))
  if (database === undefined) return
  if (!existsSync(database.trim())) {
    void vscode.window.showErrorMessage(`目录库不存在：${database.trim()}。请选择 JIT 项目的 catalog.sqlite3。`)
    return
  }
  const artifacts = await input('模型产物根目录',
    settings.artifactRoot && existsSync(settings.artifactRoot)
      ? settings.artifactRoot
      : path.join(backend, 'artifacts'))
  if (artifacts === undefined) return
  if (!existsSync(artifacts.trim())) {
    void vscode.window.showErrorMessage(`模型产物目录不存在：${artifacts.trim()}。请选择 JIT 项目的 artifacts 目录。`)
    return
  }
  const environment = resolveEnvironment(folder, {
    ...settings,
    backendPath: backend.trim(),
    pythonPath: python.trim(),
    databasePath: database.trim(),
    artifactRoot: artifacts.trim(),
  })
  if (!environment.environment) {
    void vscode.window.showErrorMessage(environment.issue ?? 'JIT 后端环境不可用。')
    return
  }
  const modelId = await chooseModel(environment.environment, settings.modelId)
  if (modelId === undefined) return
  const config = vscode.workspace.getConfiguration('jitCommitAnalysis')
  await config.update('backendPath', backend.trim(), vscode.ConfigurationTarget.Global)
  await config.update('pythonPath', python.trim(), vscode.ConfigurationTarget.Global)
  await config.update('modelId', modelId.trim(), vscode.ConfigurationTarget.Global)
  await config.update('databasePath', database.trim(), vscode.ConfigurationTarget.Global)
  await config.update('artifactRoot', artifacts.trim(), vscode.ConfigurationTarget.Global)
  updateIdleStatus(readSettings(folder))
  void vscode.window.showInformationMessage('JIT 提交检查已配置。下一次提交后会自动分析。', '立即检查')
    .then(action => {
      if (action === '立即检查') void runCheck('manual')
    })
}

async function selectModel(): Promise<void> {
  const folder = workspaceFolder()
  if (!folder) {
    void vscode.window.showWarningMessage('请先打开仓库根目录。')
    return
  }
  const settings = readSettings(folder)
  const resolved = resolveEnvironment(folder, settings)
  if (!resolved.environment) {
    const issue = resolved.issue ?? 'JIT 后端环境不可用。'
    void vscode.window.showWarningMessage(issue, '去配置').then(action => {
      if (action === '去配置') void configure()
    })
    return
  }
  const modelId = await chooseModel(resolved.environment, settings.modelId)
  if (modelId === undefined) return
  await vscode.workspace.getConfiguration('jitCommitAnalysis')
    .update('modelId', modelId.trim(), vscode.ConfigurationTarget.Global)
  updateIdleStatus(readSettings(folder))
  void vscode.window.showInformationMessage(`已选择提交检查模型 ${modelId.trim()}。`)
}

/** 已配置或工作区自带的 backend 直接确认；否则让用户选 JIT 项目的目录。 */
async function chooseBackend(folder: vscode.WorkspaceFolder,
                             settings: CheckSettings): Promise<string | undefined> {
  const workspaceBackend = path.join(folder.uri.fsPath, 'backend')
  const valid = (value: string): boolean => Boolean(value) && existsSync(path.join(value, 'jit_baseline'))
  if (valid(settings.backendPath)) {
    return await input('后端目录（JIT 工具所在处，可在当前仓库外）', settings.backendPath)
  }
  if (valid(workspaceBackend)) {
    return await input('后端目录（JIT 工具所在处，可在当前仓库外）', workspaceBackend)
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: '选择 backend 目录',
    title: '选择 JIT 项目的 backend 目录（不需要在当前仓库内）',
  })
  return picked?.[0]?.fsPath
}

async function toggleAutoCheck(): Promise<void> {
  const config = vscode.workspace.getConfiguration('jitCommitAnalysis')
  const next = !config.get<boolean>('autoCheck', true)
  await config.update('autoCheck', next, vscode.ConfigurationTarget.Global)
  const folder = workspaceFolder()
  if (folder) updateIdleStatus(readSettings(folder))
  void vscode.window.showInformationMessage(next ? '已开启提交后自动检查。' : '已关闭提交后自动检查。')
}

interface GitRepositoryLike {
  rootUri: vscode.Uri
  state: { HEAD?: { commit?: string }; onDidChange: vscode.Event<void> }
}

interface GitApiLike {
  repositories: GitRepositoryLike[]
  onDidOpenRepository: vscode.Event<GitRepositoryLike>
}

interface GitExtensionLike {
  getAPI(version: number): GitApiLike
}

/** 优先监听内置 Git 扩展；不可用时回退到低频轮询。 */
async function watchGitState(root: string): Promise<void> {
  const extension = vscode.extensions.getExtension<GitExtensionLike>('vscode.git')
  if (extension) {
    try {
      const exports = extension.isActive ? extension.exports : await extension.activate()
      const api = exports.getAPI(1)
      const bind = (repository: GitRepositoryLike): vscode.Disposable => {
        lastHead = repository.state.HEAD?.commit ?? lastHead
        return repository.state.onDidChange(() => {
          const commit = repository.state.HEAD?.commit ?? null
          if (!commit || commit === lastHead) return
          lastHead = commit
          scheduleCheck()
        })
      }
      const current = api.repositories.find(repository => samePath(repository.rootUri.fsPath, root))
      if (current) extensionContext.subscriptions.push(bind(current))
      extensionContext.subscriptions.push(api.onDidOpenRepository(repository => {
        if (samePath(repository.rootUri.fsPath, root)) extensionContext.subscriptions.push(bind(repository))
      }))
      return
    } catch {
      // 继续使用轮询兜底。
    }
  }
  const timer = setInterval(() => {
    void (async () => {
      const head = await gitHead(root)
      if (!head || head === lastHead) return
      lastHead = head
      scheduleCheck()
    })()
  }, 15000)
  extensionContext.subscriptions.push(new vscode.Disposable(() => clearInterval(timer)))
}

async function startWatching(): Promise<void> {
  const folder = workspaceFolder()
  if (!folder) {
    setStatus('$(shield) JIT 无工作区', '请打开 Git 仓库根目录', 'jitReport.configure')
    return
  }
  const root = await gitRoot(folder)
  repoRoot = root
  if (!root) {
    setStatus('$(warning) JIT 非 Git 仓库', '当前工作区没有 Git 仓库', 'jitReport.configure')
    return
  }
  if (!samePath(root, folder.uri.fsPath)) {
    setStatus('$(warning) JIT 请打开仓库根目录', `当前仓库根目录：${root}`, 'jitReport.configure')
    return
  }
  lastHead = await gitHead(root)
  updateIdleStatus(readSettings(folder))
  await refreshDiagnostics()
  await watchGitState(root)
}

export function activate(context: vscode.ExtensionContext): {
  importReport: (path: string) => Promise<void>
  getState: () => object
  runCheckNow: () => Promise<void>
  configure: () => Promise<void>
} {
  extensionContext = context
  tree = new ReportTree()
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90)
  diagnostics = vscode.languages.createDiagnosticCollection('jit')
  outputChannel = vscode.window.createOutputChannel('JIT 提交分析')
  explanationProvider = new ExplanationProvider()
  context.subscriptions.push(
    statusBar, diagnostics, outputChannel, explanationProvider,
    vscode.workspace.registerTextDocumentContentProvider('jit-commit-explanation', explanationProvider),
  )
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
      diagnostics.clear()
      tree.refresh()
    }),
    vscode.commands.registerCommand('jitReport.copyGenerateCommand', copyAnalyzeCommand),
    vscode.commands.registerCommand('jitReport.checkHead', async () => { await runCheck('manual') }),
    vscode.commands.registerCommand('jitReport.configure', configure),
    vscode.commands.registerCommand('jitReport.selectModel', selectModel),
    vscode.commands.registerCommand('jitReport.toggleAutoCheck', toggleAutoCheck),
    vscode.commands.registerCommand('jitReport.showExplanation', showExplanation),
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
  if (saved) void load(saved, true).catch(() => { /* 旧路径失效时保持空视图 */ })
  void startWatching()
  return {
    importReport: (pathValue: string) => load(pathValue),
    runCheckNow: () => runCheck('manual'),
    configure,
    getState: () => ({
      reportPath: tree.reportPath,
      commits: tree.report?.commits.length ?? 0,
      candidates: tree.report?.candidates.length ?? 0,
      identity: tree.identity,
      statusBar: statusBar.text,
      diagnostics: diagnosticCount(),
      checking,
      autoCheck: workspaceFolder() ? readSettings(workspaceFolder()).autoCheck : false,
    }),
  }
}

export function deactivate(): void {
  if (checkTimer) clearTimeout(checkTimer)
}
