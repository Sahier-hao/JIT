import { useQuery } from '@tanstack/react-query'
import { parseDataset, parseHistorical, parseRepository, type Dataset, type Mode } from './domain'
export type Loader = () => Promise<unknown>
export type Resource = { state: 'loading' } | { state: 'ready'; data: Dataset } | { state: 'error'; error: string }
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
const PARSERS: Record<Mode, (input: unknown) => Dataset> = { demo: parseDataset, historical: parseHistorical, repository: parseRepository }
export function useDataset(loader: Loader = historicalLoader, mode: Mode = 'historical'): { resource: Resource; retry: () => void } {
  const query = useQuery({
    queryKey: ['dataset', mode, loader.name || 'custom'],
    queryFn: async () => PARSERS[mode](await loader()),
    staleTime: 0,
  })
  const resource: Resource = query.isPending
    ? { state: 'loading' }
    : query.isError
      ? { state: 'error', error: query.error instanceof Error ? query.error.message : '数据读取失败' }
      : { state: 'ready', data: query.data as Dataset }
  return { resource, retry: () => { void query.refetch() } }
}
