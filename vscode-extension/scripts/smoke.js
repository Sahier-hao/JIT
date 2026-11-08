/** 在真实扩展宿主中执行冒烟：注册命令并调用只读命令。需要本机安装 VS Code。 */
const path = require('path')
const { runTests } = require('@vscode/test-electron')

const extensionDevelopmentPath = path.resolve(__dirname, '..')
const extensionTestsPath = process.env.JIT_SMOKE_SUITE
  || path.resolve(__dirname, 'smoke-suite.js')
runTests({
  vscodeExecutablePath: process.env.JIT_VSCODE_EXE || undefined,
  extensionDevelopmentPath,
  extensionTestsPath,
  launchArgs: ['--no-sandbox', '--disable-gpu',
    `--user-data-dir=${process.env.JIT_SMOKE_USER || path.resolve(__dirname, '.smoke-user')}`,
    `--extensions-dir=${process.env.JIT_SMOKE_EXT || path.resolve(__dirname, '.smoke-ext')}`],
}).then(() => console.log('SMOKE OK'), error => { console.error('SMOKE FAILED', error); process.exit(1) })
