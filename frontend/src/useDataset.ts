import { useEffect, useState } from 'react'
import { parseDataset, parseHistorical, type Dataset, type Mode } from './domain'
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
export function useDataset(loader: Loader = demoLoader, mode: Mode = 'demo'): { resource: Resource; retry: () => void } {
  const [settled, setSettled] = useState<{ loader: Loader; mode: Mode; attempt: number; resource: Resource }>(() => ({ loader, mode, attempt: 0, resource: { state: 'loading' } }))
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    Promise.resolve().then(loader).then(mode === 'demo' ? parseDataset : parseHistorical).then(data => {
      if (active) setSettled({ loader, mode, attempt, resource: { state: 'ready', data } })
    }).catch(error => {
      if (active) setSettled({ loader, mode, attempt, resource: { state: 'error', error: error instanceof Error ? error.message : '数据读取失败' } })
    })
    return () => { active = false }
  }, [loader, attempt, mode])
  const resource: Resource = settled.loader === loader && settled.mode === mode && settled.attempt === attempt ? settled.resource : { state: 'loading' }
  return { resource, retry: () => setAttempt(value => value + 1) }
}
