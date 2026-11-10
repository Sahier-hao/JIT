const cp = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vscode = require('vscode')

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('local.jit-commit-analysis')
  if (!extension) throw new Error('扩展 local.jit-commit-analysis 未加载')
  await extension.activate()
  const commands = await vscode.commands.getCommands(true)
  const needed = ['jitReport.import', 'jitReport.refresh', 'jitReport.clear', 'jitReport.openCommit', 'jitReport.openCandidate']
  const missing = needed.filter(name => !commands.includes(name))
  if (missing.length) throw new Error('缺少命令：' + missing.join(','))
  const api = extension.exports
  if (!api || typeof api.importReport !== 'function') throw new Error('扩展未暴露测试 API')

  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error('冒烟工作区缺失')
  const fixture = path.resolve(__dirname, 'fixtures/sample-report.json')
  await api.importReport(fixture)
  let state = api.getState()
  if (state.commits !== 1 || state.candidates !== 2) throw new Error('导入后数量不符：' + JSON.stringify(state))
  if (state.identity.state !== 'stale' && state.identity.state !== 'unknown') throw new Error('过期报告未标记：' + JSON.stringify(state.identity))

  const head = cp.execSync('git rev-parse HEAD', { cwd: folder.uri.fsPath }).toString().trim()
  const data = JSON.parse(fs.readFileSync(fixture, 'utf8'))
  data.repository.headSha = head
  const matched = path.join(os.tmpdir(), 'jit-smoke-matched.json')
  fs.writeFileSync(matched, JSON.stringify(data))
  await api.importReport(matched)
  state = api.getState()
  if (state.identity.state !== 'match') throw new Error('同提交报告未标记一致：' + JSON.stringify(state.identity))

  await api.importReport(fixture)
  if (api.getState().identity.state !== 'stale') throw new Error('不同提交报告未标记过期')

  // 真实命令入口导入：不经过测试 API。
  await vscode.commands.executeCommand('jitReport.import', vscode.Uri.file(matched))
  if (api.getState().identity.state !== 'match') throw new Error('真实命令导入后身份应为一致')

  // 工作树改动后必须降级为 dirty，而不是仍标一致。
  const readme = path.join(folder.uri.fsPath, 'SMOKE_DIRTY.txt')
  fs.writeFileSync(readme, 'dirty')
  await vscode.commands.executeCommand('jitReport.refresh')
  if (api.getState().identity.state !== 'dirty') throw new Error('工作树改动后未标记 dirty：' + JSON.stringify(api.getState().identity))

  const external = process.env.JIT_SMOKE_REPORT
  if (external) {
    await vscode.commands.executeCommand('jitReport.import', vscode.Uri.file(external))
    const state2 = api.getState()
    if (state2.identity.state !== 'match' && state2.identity.state !== 'dirty') {
      throw new Error('真实报告导入后身份不符：' + JSON.stringify(state2.identity))
    }
  }

  const bad = path.join(os.tmpdir(), 'jit-smoke-bad.json')
  fs.writeFileSync(bad, '{"format":"other"}')
  let rejected = false
  try { await api.importReport(bad) } catch { rejected = true }
  if (!rejected) throw new Error('非法报告未被拒绝')

  await vscode.commands.executeCommand('jitReport.clear')
  const out = process.env.JIT_SMOKE_MARKER || path.resolve(__dirname, '.smoke-ok')
  fs.writeFileSync(out, 'ok')
}
