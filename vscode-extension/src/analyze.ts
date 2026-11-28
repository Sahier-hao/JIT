import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildAnalyzeArgs, type AnalyzeCommandOptions } from './command'

const run = promisify(execFile)

export const ANALYZE_TIMEOUT_MS = 10 * 60 * 1000

/** 在本地后端环境中执行一次提交范围分析；不经过 shell，不联网。 */
export async function analyzeCommitRange(options: AnalyzeCommandOptions): Promise<void> {
  await run(options.python, [...(options.pythonArgs ?? []), ...buildAnalyzeArgs(options)], {
    cwd: options.backend,
    windowsHide: true,
    timeout: ANALYZE_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  })
}

export function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; stderr?: unknown; message?: unknown }
    if (value.code === 'ENOENT') return '找不到 Python 解释器；请在设置 jitCommitAnalysis.pythonPath 指定路径。'
    if (typeof value.stderr === 'string' && value.stderr.trim()) return value.stderr.trim()
    if (typeof value.message === 'string') return value.message
  }
  return String(error)
}
