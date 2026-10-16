/**
 * 隔离浏览器验收的启动夹具（任务 1.1/1.2/1.3，设计 D8）。
 *
 * 顺序：复制已验证模型到临时根 → 显式初始化临时 SQLite → 生成只存内存的测试凭据 →
 * 启动自有本机服务。Vite 由 Playwright 的 webServer 启动，代理目标指向本夹具的端口。
 *
 * 凭据只写入本进程环境变量（worker 进程继承），不落盘、不进 URL、不进证据。
 */
import {
  acceptanceBaseDirectory,
  archiveFingerprint,
  generateCredentials,
  prepareEnvironment,
  snapshotFiles,
  startService,
} from './acceptance-environment.ts'
import { ACCEPTANCE_SERVICE_PORT, numberFromEnv } from './ports.ts'
import { archiveEvidenceDir, runEvidenceDir } from '../../evidence.ts'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export default async function globalSetup(): Promise<void> {
  const port = numberFromEnv('JIT_ACCEPTANCE_SERVICE_PORT', ACCEPTANCE_SERVICE_PORT)
  const base = acceptanceBaseDirectory(process.env.JIT_ACCEPTANCE_LABEL ?? 'workbench')
  const environment = prepareEnvironment(base)
  const credentials = generateCredentials()
  try {
    await startService(environment, port, credentials)
  } catch (error) {
    // 夹具自身失败也要留下可定位信息，但不外泄凭据。
    process.stderr.write(`隔离验收服务启动失败：${error instanceof Error ? error.message : String(error)}\n`)
    throw error
  }
  process.env.JIT_ACCEPTANCE_BASE = environment.base
  process.env.JIT_ACCEPTANCE_DATABASE = environment.database
  process.env.JIT_ACCEPTANCE_RUN = environment.run
  process.env.JIT_ACCEPTANCE_ARTIFACT_ROOT = environment.artifactRoot
  process.env.JIT_ACCEPTANCE_SERVICE_PORT = String(port)
  process.env.JIT_ACCEPTANCE_MEMBER_TOKEN = credentials.member
  process.env.JIT_ACCEPTANCE_ADMIN_TOKEN = credentials.admin
  // 记录运行前证据目录指纹：脱敏扫描只针对本轮新增或改写的产物，
  // 不重扫历史归档（它们本就含仓库路径，且不属于本轮输出）。
  writeFileSync(join(environment.base, 'evidence-before.json'),
    JSON.stringify(snapshotFiles(runEvidenceDir)), 'utf8')
  // 历史归档指纹：本轮验收不得改动 docs/evidence/ 下已归档的 change 证据。
  writeFileSync(join(environment.base, 'archive-before.json'),
    JSON.stringify(archiveFingerprint(archiveEvidenceDir)), 'utf8')
}
