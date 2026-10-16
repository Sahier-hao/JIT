/**
 * 隔离浏览器验收的收尾夹具（任务 1.1/1.3）。
 *
 * 只做三件事，且都不触碰共享资源：
 * 1. 结束本夹具启动的自有服务进程（按 pid，不按端口或镜像名）；
 * 2. 核对原开发库未被使用、原模型产物 hash 未变；
 * 3. 扫描本轮写入 `docs/evidence/_run/` 的文本证据，确认没有测试凭据、
 *    完整 Authorization 头或真实服务器绝对路径，然后删除临时根。
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acceptanceEnvironmentEvidence, archiveEvidenceDir, ensureDir, runEvidenceDir } from '../../evidence.ts'
import {
  archiveFingerprint,
  cleanupEnvironment,
  inspectEnvironment,
  lastServicePid,
  scanForSecrets,
  snapshotFiles,
  stopServiceByPid,
} from './acceptance-environment.ts'

const textExtensions = ['.json', '.txt', '.log', '.md', '.csv']

function sanitizePath(text: string, base: string): string {
  return text.split(base).join('<temporary-acceptance-root>').split(base.replace(/\\/g, '/')).join('<temporary-acceptance-root>')
}

export default async function globalTeardown(): Promise<void> {
  const base = process.env.JIT_ACCEPTANCE_BASE
  const member = process.env.JIT_ACCEPTANCE_MEMBER_TOKEN ?? ''
  const admin = process.env.JIT_ACCEPTANCE_ADMIN_TOKEN ?? ''
  const summary: Record<string, unknown> = { kind: 'acceptance-environment-evidence', isolatedResources: true }
  if (!base || !existsSync(base)) {
    writeFileSync(join(ensureDir(runEvidenceDir), 'acceptance-environment.json'),
      JSON.stringify({ ...summary, prepared: false, cleaned: false }, null, 2), 'utf8')
    return
  }
  const pid = lastServicePid(base)
  await stopServiceByPid(pid ?? -1)
  summary.serviceStoppedByPid = pid
  const inspection = inspectEnvironment(base)
  summary.temporaryDatabaseIsNotDefault = inspection.temporaryDatabaseIsNotDefault
  summary.originalArtifactsUnchanged = inspection.originalArtifactsUnchanged
  summary.counts = inspection.counts

  const serviceLog = join(base, 'service.log')
  const logText = existsSync(serviceLog) ? readFileSync(serviceLog, 'utf8') : ''
  // 服务器绝对路径只在检查夹具自身的临时根时才有意义；仓库路径是正常内容。
  const forbidden = [member, admin, base, base.replace(/\\/g, '/')].filter(Boolean)
  summary.serviceLogCredentialFindings = scanForSecrets(logText, forbidden)

  ensureDir(runEvidenceDir)
  const beforePath = join(base, 'evidence-before.json')
  const before = existsSync(beforePath) ? JSON.parse(readFileSync(beforePath, 'utf8')) as Record<string, string> : {}
  const after = snapshotFiles(runEvidenceDir)
  const touched = Object.keys(after).filter(key => before[key] !== after[key])
  // Playwright 的 JSON reporter 在 globalTeardown 之后才落盘，因此永远扫不到本轮那一份；
  // 这里无条件补扫两份 reporter 产物（它们是测试标题与错误文本，不含请求头）。
  for (const key of ['browser-results-acceptance.json', 'browser-results.json']) {
    if (after[key] && !touched.includes(key)) touched.push(key)
  }
  const scanned: string[] = []
  const findings: { file: string; findings: string[] }[] = []
  for (const key of touched) {
    const path = join(runEvidenceDir, key)
    if (!textExtensions.some(extension => key.endsWith(extension))) continue
    if (statSync(path).size >= 8 * 1024 * 1024) continue
    scanned.push(key)
    const found = scanForSecrets(readFileSync(path, 'utf8'), forbidden)
    if (found.length) findings.push({ file: key, findings: found })
  }
  summary.scannedEvidenceFiles = scanned.length
  summary.scannedEvidencePaths = scanned
  summary.credentialOrPathFindings = findings

  // 历史归档未被改动（任务 1.3）：只比较 `docs/evidence/` 下非 `_run` 的部分。
  const archiveBeforePath = join(base, 'archive-before.json')
  if (existsSync(archiveBeforePath)) {
    const archiveBefore = JSON.parse(readFileSync(archiveBeforePath, 'utf8')) as Record<string, string>
    const archiveAfter = archiveFingerprint(archiveEvidenceDir)
    const changed = [
      ...Object.keys(archiveAfter).filter(key => archiveBefore[key] !== archiveAfter[key]),
      ...Object.keys(archiveBefore).filter(key => !(key in archiveAfter)),
    ]
    summary.archiveUnchanged = changed.length === 0
    summary.archiveChangedPaths = changed.slice(0, 20)
  }

  cleanupEnvironment(base)
  summary.cleaned = !existsSync(base)
  writeFileSync(acceptanceEnvironmentEvidence, JSON.stringify(
    JSON.parse(sanitizePath(JSON.stringify(summary), base)), null, 2), 'utf8')
  for (const key of ['JIT_ACCEPTANCE_MEMBER_TOKEN', 'JIT_ACCEPTANCE_ADMIN_TOKEN']) delete process.env[key]
  if (findings.length) throw new Error(`证据脱敏检查失败：${JSON.stringify(findings)}`)
  if (summary.archiveUnchanged === false) throw new Error(`本轮验收改动了历史归档：${JSON.stringify(summary.archiveChangedPaths)}`)
}
