// [AI生成] 真实扩展宿主截图套件：导入匹配报告并保持 JIT 视图可见。
const cp = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vscode = require('vscode')

function gitEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'GIT_CONFIG_PARAMETERS' || key === 'GIT_CONFIG_COUNT'
      || key.startsWith('GIT_CONFIG_KEY_') || key.startsWith('GIT_CONFIG_VALUE_')) {
      delete env[key]
    }
  }
  return env
}

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('local.jit-commit-analysis')
  if (!extension) throw new Error('扩展 local.jit-commit-analysis 未加载')
  await extension.activate()
  const api = extension.exports
  if (!api || typeof api.importReport !== 'function') throw new Error('扩展未暴露测试 API')
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error('截图工作区缺失')
  const head = cp.execSync('git rev-parse HEAD', { cwd: folder.uri.fsPath, env: gitEnv() }).toString().trim()
  const fixture = path.resolve(__dirname, 'fixtures/sample-report.json')
  const data = JSON.parse(fs.readFileSync(fixture, 'utf8'))
  data.repository.headSha = head
  const matched = path.join(os.tmpdir(), 'jit-smoke-screenshot.json')
  fs.writeFileSync(matched, JSON.stringify(data))
  await api.importReport(matched)
  if (api.getState().identity.state !== 'match') {
    throw new Error('截图报告身份不是 match：' + JSON.stringify(api.getState().identity))
  }
  try {
    await vscode.commands.executeCommand('workbench.action.resetViewLocations')
  } catch {
    // 旧版本 VS Code 可能没有该命令；继续打开 Explorer。
  }
  await vscode.commands.executeCommand('workbench.view.explorer')
  try {
    await vscode.commands.executeCommand('jitReport.view.focus')
  } catch {
    // 视图 ID 的自动 focus 命令在不同 VS Code 版本可能不存在；explorer 已打开。
  }
  const ready = process.env.JIT_SMOKE_SCREENSHOT_READY || path.resolve(__dirname, '.smoke-screenshot-ready')
  const done = process.env.JIT_SMOKE_SCREENSHOT_DONE || path.resolve(__dirname, '.smoke-screenshot-done')
  fs.writeFileSync(ready, 'ready')
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (fs.existsSync(done)) break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}
