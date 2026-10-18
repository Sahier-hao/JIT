import { useEffect, useState } from 'react'
import { parseDataset, parseHistorical, parseRepository, type Dataset, type Mode } from './domain'
import { parseSync } from './repositoryContract'
import { apiRequest } from './apiClient'
export type Loader = () => Promise<unknown>
export type Resource = { state: 'loading' } | { state: 'ready'; data: Dataset } | { state: 'error'; error: string }
export const demoLoader: Loader = async () => { const response = await fetch('/demo-dataset.json'); if (!response.ok) throw new Error('演示数据读取失败'); return response.json() }
export const historicalLoader: Loader = async () => {
  let response: Response
  try { response = await fetch('/api/review-batch', { cache: 'no-store' }) }
  catch { throw new Error('真实服务不可达，请确认本机推理服务已启动后重试。') }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message ? `${body.error.message} (${body.error.code})` : `真实服务不可用 (HTTP ${response.status})`)
  }
  return response.json()
}
/**
 * 仓库来源：先取作业视图（模型来源、降级原因、提交总数），提交本身由工作台按页读取。
 *
 * 一次同步可能有上千个提交，不适合像历史回放那样整包加载；这里只把"这次作业是谁"交给契约层，
 * 列表与清单各自调用 `/commits` 分页接口。空页是占位：数据集形状要求一份提交页，
 * 但界面不会用它渲染列表，只用于来源徽章与说明文案。
 */
export function repositoryLoader(syncId: string, token: string): Loader {
  return async () => {
    if (syncId === '') throw new Error('缺少同步标识，无法读取这批提交')
    const sync = parseSync(await apiRequest({ path: `/api/v1/repository-syncs/${encodeURIComponent(syncId)}`, method: 'GET', token }))
    return { sync, page: { syncId: sync.syncId, status: sync.status, total: 0, limit: 0, offset: 0, commits: [] } }
  }
}
const PARSERS: Record<Mode, (input: unknown) => Dataset> = { demo: parseDataset, historical: parseHistorical, repository: parseRepository }
export function useDataset(loader: Loader = demoLoader, mode: Mode = 'demo'): { resource: Resource; retry: () => void } {
  const [settled, setSettled] = useState<{ loader: Loader; mode: Mode; attempt: number; resource: Resource }>(() => ({ loader, mode, attempt: 0, resource: { state: 'loading' } }))
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    Promise.resolve().then(loader).then(PARSERS[mode]).then(data => {
      if (active) setSettled({ loader, mode, attempt, resource: { state: 'ready', data } })
    }).catch(error => {
      if (active) setSettled({ loader, mode, attempt, resource: { state: 'error', error: error instanceof Error ? error.message : '数据读取失败' } })
    })
    return () => { active = false }
  }, [loader, attempt, mode])
  const resource: Resource = settled.loader === loader && settled.mode === mode && settled.attempt === attempt ? settled.resource : { state: 'loading' }
  return { resource, retry: () => setAttempt(value => value + 1) }
}
