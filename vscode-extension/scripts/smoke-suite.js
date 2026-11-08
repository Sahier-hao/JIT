const fs = require('fs')
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
  await vscode.commands.executeCommand('jitReport.clear')
  await vscode.commands.executeCommand('jitReport.refresh')
  const out = process.env.JIT_SMOKE_MARKER || path.resolve(__dirname, '.smoke-ok')
  fs.writeFileSync(out, 'ok')
}
