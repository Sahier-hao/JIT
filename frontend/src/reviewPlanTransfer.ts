import { apiRequest } from './apiClient'
import { contractFailed, record, textOrNull, uuidText } from './apiContract'

export interface PlanSource { repositoryId: string; viewSyncId: string; datasetVersion: string | null; modelId: string | null; runId: string | null }
export interface PortablePlan { format: 'jit-review-plan-v1'; source: PlanSource; commitIds: string[] }
export const PLAN_BYTES = 1024 * 1024
const SOURCE_KEYS = ['repositoryId', 'viewSyncId', 'datasetVersion', 'modelId', 'runId'] as const
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) contractFailed('计划备份格式不支持')
}
function decode(value: unknown, expected: PlanSource): PortablePlan {
  const raw = record(value)
  exactKeys(raw, ['format','source','commitIds'])
  if (raw.format !== 'jit-review-plan-v1') contractFailed('计划备份格式不支持')
  const source = record(raw.source); exactKeys(source, SOURCE_KEYS)
  const parsed: PlanSource = { repositoryId: uuidText(source.repositoryId), viewSyncId: uuidText(source.viewSyncId),
    datasetVersion: textOrNull(source.datasetVersion), modelId: textOrNull(source.modelId), runId: textOrNull(source.runId) }
  if (SOURCE_KEYS.some(key => parsed[key] !== expected[key])) contractFailed('备份来源与当前项目、分析、数据或模型不一致，原计划保持不变')
  if (!Array.isArray(raw.commitIds) || raw.commitIds.length > 5000 || raw.commitIds.some(id => typeof id !== 'string' || !id || id.length > 200)) contractFailed('计划备份的提交列表无效或超过 5000 条')
  const ids = raw.commitIds as string[]
  if (new Set(ids).size !== ids.length) contractFailed('计划备份含重复提交，未导入')
  return { format: 'jit-review-plan-v1', source: parsed, commitIds: [...ids] }
}
export function makePlan(source: PlanSource, ids: string[]): PortablePlan {
  return decode({ format: 'jit-review-plan-v1', source, commitIds: ids }, source)
}
export function parsePlan(content: string, source: PlanSource): PortablePlan {
  if (new TextEncoder().encode(content).byteLength > PLAN_BYTES) contractFailed('计划备份超过 1 MiB，未导入')
  let raw: unknown
  try { raw = JSON.parse(content) } catch { return contractFailed('计划备份不是有效 JSON，原计划保持不变') }
  return decode(raw, source)
}
export async function validatePlan(plan: PortablePlan, signal?: AbortSignal): Promise<PortablePlan> {
  const { repositoryId, viewSyncId } = plan.source
  const response = await apiRequest({ path: `/api/v1/repositories/${encodeURIComponent(repositoryId)}/review-plan/validate?viewSyncId=${encodeURIComponent(viewSyncId)}`, method: 'POST', body: plan, signal })
  const verified = decode(response, plan.source)
  if (JSON.stringify(verified.commitIds) !== JSON.stringify(plan.commitIds)) contractFailed('服务返回的计划条目或顺序不一致，未导入')
  return verified
}
export function readPlanFile(file: File, signal: AbortSignal): Promise<string> {
  if (file.size > PLAN_BYTES) return Promise.reject(new Error('计划备份超过 1 MiB，未导入'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const abort = () => { reader.abort(); reject(new Error('请求已取消')) }
    reader.onload = () => { signal.removeEventListener('abort', abort); if (typeof reader.result === 'string') resolve(reader.result); else reject(new Error('计划备份读取失败')) }
    reader.onerror = () => { signal.removeEventListener('abort', abort); reject(new Error('计划备份读取失败，请重新选择')) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    reader.readAsText(file, 'UTF-8')
  })
}
export function downloadPlan(plan: PortablePlan): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)+'\n'], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = `jit-review-plan-${plan.source.viewSyncId}.json`
  document.body.append(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
