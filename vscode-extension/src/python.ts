import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import * as path from 'node:path'

export interface PythonCommand {
  command: string
  args: string[]
}

export function defaultPython(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

/** 后端目录自带虚拟环境时优先使用，避免系统解释器缺少依赖。 */
export function defaultInterpreter(backend: string): string {
  const venv = process.platform === 'win32'
    ? path.join(backend, '.venv', 'Scripts', 'python.exe')
    : path.join(backend, '.venv', 'bin', 'python')
  return existsSync(venv) ? venv : defaultPython()
}

function usable(command: string, args: string[]): boolean {
  try {
    return spawnSync(command, [...args, '--version'], { windowsHide: true, timeout: 5000 }).status === 0
  } catch {
    return false
  }
}

/** 按用户配置、后端虚拟环境、系统解释器的顺序找第一个可执行项。 */
export function resolvePython(backend: string, configured: string): PythonCommand | null {
  const candidates: PythonCommand[] = []
  const venv = process.platform === 'win32'
    ? path.join(backend, '.venv', 'Scripts', 'python.exe')
    : path.join(backend, '.venv', 'bin', 'python')
  const configuredIsPath = Boolean(configured)
    && (path.isAbsolute(configured) || configured.includes('/') || configured.includes('\\'))
  if (configuredIsPath) candidates.push({ command: configured, args: [] })
  if (existsSync(venv)) candidates.push({ command: venv, args: [] })
  if (configured && !configuredIsPath) candidates.push({ command: configured, args: [] })
  if (process.platform === 'win32') {
    candidates.push({ command: 'py', args: ['-3'] }, { command: 'python', args: [] })
  } else {
    candidates.push({ command: 'python3', args: [] }, { command: 'python', args: [] })
  }
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = `${candidate.command} ${candidate.args.join(' ')}`
    if (seen.has(key)) continue
    seen.add(key)
    if (usable(candidate.command, candidate.args)) return candidate
  }
  return null
}
