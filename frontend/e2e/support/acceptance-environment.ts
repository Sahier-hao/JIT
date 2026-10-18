/**
 * 隔离验收环境的生命周期夹具（任务 1.1，设计 D8）。
 *
 * 只使用独立资源：复制到临时根的模型副本、显式初始化的临时 SQLite、
 * 只存在于本进程内存中的测试团队凭据，以及本项目自己启动/结束的本机服务。
 * 绝不触碰默认开发库 `backend/storage/catalog.sqlite3`，也不停止非本夹具启动的进程。
 *
 * 凭据处理：本模块生成随机 token 后只经子进程环境变量传递；不写文件、不进 argv、
 * 不进日志、不进截图。落盘的服务日志由后端中间件保证只记录 operation/role/status。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../../..')
const backendDir = join(repoRoot, 'backend')
const python = process.platform === 'win32'
  ? join(backendDir, '.venv', 'Scripts', 'python.exe')
  : join(backendDir, '.venv', 'bin', 'python')
const script = join(backendDir, 'scripts', 'acceptance_environment.py')

export interface PreparedEnvironment {
  base: string
  run: string
  database: string
  artifactRoot: string
  sources: string[]
  temporaryDatabaseIsNotDefault: boolean
}

export interface AcceptanceService {
  process: ChildProcess
  port: number
  pid: number
}

/** 隔离验收的临时根；位于 backend/.cache（已被 .gitignore 忽略）下。 */
export function acceptanceBaseDirectory(label: string): string {
  return join(backendDir, '.cache', `acceptance-${label}`)
}

export function acceptancePython(): string {
  return python
}

function runPython(args: string[], env: NodeJS.ProcessEnv = {}): string {
  const result = spawnSync(python, [script, ...args], {
    cwd: backendDir, env: { ...process.env, ...env, PYTHONIOENCODING: 'utf-8' }, encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`验收夹具命令失败（${args[0]}）：${result.stderr || result.stdout}`)
  return result.stdout
}

/** 复制已验证模型、显式初始化独立 SQLite，并记录原产物 hash。 */
export function prepareEnvironment(base: string): PreparedEnvironment {
  if (resolve(base) !== base || !base.toLowerCase().startsWith(join(backendDir, '.cache', 'acceptance-').toLowerCase()) || resolve(base, '..') !== join(backendDir, '.cache')) throw new Error('验收临时根必须是 backend/.cache/acceptance-* 目录')
  mkdirSync(join(backendDir, '.cache'), { recursive: true })
  if (existsSync(base)) rmSync(base, { recursive: true, force: true })
  const stdout = runPython(['prepare', '--base', base])
  return JSON.parse(stdout) as PreparedEnvironment
}

/** 只删除本次验收创建、且带 environment.json 的临时目录。 */
export function cleanupEnvironment(base: string): void {
  if (!existsSync(join(base, 'environment.json'))) return
  runPython(['cleanup', '--base', base])
}

export function inspectEnvironment(base: string): Record<string, unknown> {
  return JSON.parse(runPython(['inspect', '--base', base])) as Record<string, unknown>
}

export function setModelAvailable(base: string, key: string, available: boolean): void {
  runPython([available ? 'restore' : 'invalidate', '--base', base, '--key', key])
}

/** 仅用于本次运行的团队凭据；只存于内存，绝不落盘。 */
export function generateCredentials(): { member: string; admin: string } {
  return { member: `${randomUUID()}${randomUUID()}`.replace(/-/g, ''), admin: `${randomUUID()}${randomUUID()}`.replace(/-/g, '') }
}

export async function waitForService(port: number, token: string, process_: ChildProcess, timeoutMs = 45000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (process_.exitCode !== null) throw new Error(`验收服务提前退出，退出码 ${process_.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/models`, { headers: { Authorization: `Bearer ${token}` } })
      if (response.ok) return
    } catch {
      // 服务尚未就绪，继续等待。
    }
    await new Promise(resolve_ => setTimeout(resolve_, 150))
  }
  throw new Error('验收服务未在限定时间内就绪')
}

/**
 * 启动自有本机服务：临时产物根 + 临时库 + 内存凭据，不使用默认端口以外的任何共享资源。
 * 日志直接写入临时根内的文件（文件描述符，不经过管道），便于事后扫描是否泄漏凭据。
 *
 * 服务以 detached 方式启动并 unref：它的生命周期由夹具的 pid 文件管理，而不是由某个测试工作进程管理。
 * 否则工作进程被 Playwright 结束时会连带结束服务，后面的浏览器项目就再也连不上它。
 */
export async function startService(environment: PreparedEnvironment, port: number, credentials: { member: string; admin: string }): Promise<AcceptanceService> {
  const logPath = join(environment.base, 'service.log')
  const logFd = openSync(logPath, 'a')
  const child = spawn(python, [script, 'serve',
    '--run', environment.run,
    '--database', environment.database,
    '--artifact-root', environment.artifactRoot,
    '--port', String(port),
  ], {
    cwd: backendDir,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      JIT_MEMBER_TOKEN: credentials.member,
      JIT_ADMIN_TOKEN: credentials.admin,
    },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    detached: true,
  })
  closeSync(logFd)
  child.unref()
  // 只记录自有进程的 pid，供重启后仍由本夹具收尾。
  writeFileSync(join(environment.base, 'service.pid'), String(child.pid ?? ''), 'utf8')
  await waitForService(port, credentials.member, child)
  return { process: child, port, pid: child.pid ?? -1 }
}

/** 只结束本夹具启动的进程；不使用按端口或按镜像名的宽泛清理。 */
export async function stopService(service: AcceptanceService | null): Promise<void> {
  if (!service || service.process.exitCode !== null) return
  const exited = new Promise<void>(resolve_ => service.process.once('exit', () => resolve_()))
  service.process.kill()
  const timeout = new Promise<void>(resolve_ => setTimeout(resolve_, 15000))
  await Promise.race([exited, timeout])
  if (service.process.exitCode === null) service.process.kill('SIGKILL')
}

export function lastServicePid(base: string): number | null {
  const path = join(base, 'service.pid')
  if (!existsSync(path)) return null
  const value = Number(readFileSync(path, 'utf8').trim())
  return Number.isInteger(value) && value > 0 ? value : null
}

/** 结束指定 pid 的自有服务进程（用于跨进程的重启链路）。 */
export async function stopServiceByPid(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 1) return
  try {
    process.kill(pid)
  } catch {
    return
  }
  for (let index = 0; index < 100; index += 1) {
    await new Promise(resolve_ => setTimeout(resolve_, 150))
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // 进程已退出。
  }
}

/**
 * 扫描任意落盘文本，确认没有测试凭据、完整 Authorization 或本夹具的服务器绝对路径。
 *
 * `forbidden` 由调用方给出：本次运行的内存凭据与服务端临时根路径（含两种分隔符写法）。
 * 不把仓库自身路径当作泄漏——历史归档与常规日志本就包含仓库路径。
 */
export function scanForSecrets(text: string, forbidden: string[]): string[] {
  const findings: string[] = []
  for (const secret of forbidden) {
    if (secret && text.includes(secret)) findings.push('泄漏测试凭据或服务端绝对路径')
  }
  if (/Bearer\s+[A-Za-z0-9._~+/-]{16,}/i.test(text)) findings.push('泄漏完整 Authorization 头')
  return findings
}

/** 记录目录当前的文件指纹，用于把脱敏扫描限定在本轮新增或改写的产物上。 */
export function snapshotFiles(directory: string, into: Record<string, string> = {}, root: string = directory): Record<string, string> {
  if (!existsSync(directory)) return into
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const info = statSync(path)
    if (info.isDirectory()) snapshotFiles(path, into, root)
    else into[path.slice(root.length)] = `${info.size}:${info.mtimeMs}`
  }
  return into
}

/**
 * 已归档 change 证据的指纹：跳过运行工作区 `_run`（它每轮都会被覆盖）。
 * 用于核对本轮验收没有改动历史归档（任务 1.3）。
 */
export function archiveFingerprint(directory: string): Record<string, string> {
  const into = snapshotFiles(directory)
  for (const key of Object.keys(into)) {
    if (key.startsWith('\\_run') || key.startsWith('/_run')) delete into[key]
  }
  return into
}
