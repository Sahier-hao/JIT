/** Product space hash routes. Canonical objects include their repository, analysis or run.
 * Legacy aliases resolve identity before entering a workspace; unknown inputs stay visible.
 */
import { useCallback, useEffect, useState } from 'react'

export type Route =
  | { name: 'legacy-sync'; syncId: string; view: 'commits' | 'plan' }
  | { name: 'analysis'; repositoryId: string; viewSyncId: string; view: 'commits' | 'plan'; commitId?: string }
  | { name: 'history'; runId: string; view: 'commits' | 'trends' }
  | { name: 'demo' }
  | { name: 'settings'; page: 'connection' | 'appearance'; returnTo?: string }
  | { name: 'workbench' }
  | { name: 'repositories' }
  | { name: 'repository'; repositoryId: string }
  | { name: 'shortlist' }
  | { name: 'validation' }
  | { name: 'sources' }
  | { name: 'trends' }
  | { name: 'models' }
  | { name: 'predict' }
  | { name: 'open' }
  | { name: 'result'; batchId: string }
  | { name: 'unknown'; hash: string }

export const ROUTE_HASH = {
  workbench: '#/projects',
  repositories: '#/projects',
  shortlist: '#/shortlist',
  validation: '#/validation',
  sources: '#/connect',
  trends: '#/trends',
  models: '#/lab/models',
  predict: '#/lab/predict',
  open: '#/lab/results',
} as const

export function parseHash(hash: string): Route {
  try { return parseSafeHash(hash) } catch { return { name: 'unknown', hash } }
}

function parseSafeHash(hash: string): Route {
  const raw = (hash.startsWith('#') ? hash.slice(1) : hash).trim()
  if (raw === '' || raw === '/') return { name: 'workbench' }
  const [rawPath, query] = raw.split('?')
  const path = rawPath.replace(/\/+$/, '')
  const segments = path.replace(/^\/+/, '').replace(/\/+$/, '').split('/').map(decodeURIComponent)
  if (segments.some(part => !part || part.includes('/') || part.includes('\\'))) return { name: 'unknown', hash }
  if (path === '/projects') return { name: 'repositories' }
  if (path === '/connect') return { name: 'sources' }
  if (path === '/lab/models') return { name: 'models' }
  if (path === '/lab/predict') return { name: 'predict' }
  if (path === '/lab/results') return { name: 'open' }
  if (segments.length === 3 && segments[0] === 'lab' && segments[1] === 'results') return { name: 'result', batchId: segments[2] }
  if (path === '/lab/demo/commits') return { name: 'demo' }
  if (segments.length === 4 && segments[0] === 'legacy' && segments[1] === 'sync' && (segments[3] === 'commits' || segments[3] === 'plan')) return { name: 'legacy-sync', syncId: segments[2], view: segments[3] }
  if (segments.length === 4 && segments[0] === 'lab' && segments[1] === 'history' && (segments[3] === 'commits' || segments[3] === 'trends')) return { name: 'history', runId: segments[2], view: segments[3] }
  if ((segments.length === 5 || segments.length === 6) && segments[0] === 'repositories' && segments[2] === 'analyses' && (segments[4] === 'commits' || segments[4] === 'plan') && (segments.length === 5 || segments[4] === 'commits')) return { name: 'analysis', repositoryId: segments[1], viewSyncId: segments[3], view: segments[4], ...(segments[5] ? { commitId: segments[5] } : {}) }
  if (segments.length === 2 && segments[0] === 'settings' && (segments[1] === 'connection' || segments[1] === 'appearance')) {
    const target = new URLSearchParams(query).get('returnTo')
    return { name: 'settings', page: segments[1], ...(target && target.startsWith('#/') && !target.startsWith('#/settings') ? { returnTo: target } : {}) }
  }
  if (segments.length === 1 && segments[0] === 'sources') return { name: 'sources' }
  if (segments.length === 1 && segments[0] === 'trends') return { name: 'trends' }
  if (segments.length === 1 && segments[0] === 'models') return { name: 'models' }
  if (segments.length === 1 && segments[0] === 'predict') return { name: 'predict' }
  if (segments.length === 1 && segments[0] === 'predictions') return { name: 'open' }
  if (segments.length === 1 && segments[0] === 'repositories') return { name: 'repositories' }
  if (segments.length === 1 && segments[0] === 'shortlist') return { name: 'shortlist' }
  if (segments.length === 1 && segments[0] === 'validation') return { name: 'validation' }
  if (segments.length === 2 && segments[0] === 'repositories' && segments[1] !== '') {
    return { name: 'repository', repositoryId: segments[1] }
  }
  if (segments.length === 2 && segments[0] === 'predictions' && segments[1] !== '') {
    return { name: 'result', batchId: segments[1] }
  }
  return { name: 'unknown', hash }
}

export function hashFor(route: Route): string {
  switch (route.name) {
    case 'legacy-sync': return `#/legacy/sync/${encodeURIComponent(route.syncId)}/${route.view}`
    case 'analysis':
      return `#/repositories/${encodeURIComponent(route.repositoryId)}/analyses/${encodeURIComponent(route.viewSyncId)}/${route.view}${route.commitId ? `/${encodeURIComponent(route.commitId)}` : ''}`
    case 'history': return `#/lab/history/${encodeURIComponent(route.runId)}/${route.view}`
    case 'demo': return '#/lab/demo/commits'
    case 'settings': return `#/settings/${route.page}${route.returnTo ? `?returnTo=${encodeURIComponent(route.returnTo)}` : ''}`
    case 'workbench':
      return ROUTE_HASH.workbench
    case 'repositories':
      return ROUTE_HASH.repositories
    case 'repository':
      return `#/repositories/${encodeURIComponent(route.repositoryId)}`
    case 'shortlist':
      return ROUTE_HASH.shortlist
    case 'validation':
      return ROUTE_HASH.validation
    case 'sources':
      return ROUTE_HASH.sources
    case 'trends':
      return ROUTE_HASH.trends
    case 'models':
      return ROUTE_HASH.models
    case 'predict':
      return ROUTE_HASH.predict
    case 'open':
      return ROUTE_HASH.open
    case 'result':
      return `#/lab/results/${encodeURIComponent(route.batchId)}`
    default:
      return route.hash
  }
}

/** 结果链接：保留 origin 与路径，去掉演示查询串，只带批次身份（MPW-09）。 */
export function resultLink(batchId: string, location: { origin: string; pathname: string }): string {
  return `${location.origin}${location.pathname}#/lab/results/${encodeURIComponent(batchId)}`
}

function applyHash(hash: string, replace = false): void {
  const url = new URL(window.location.href)
  url.hash = hash
  // `sync` 是"上次看的同步作业"的恢复入口，只在仓库同步视图里有效；
  // 换到别的页面就清掉，避免切回旧页面时误恢复。`mode` 保留，演示模式靠它。
  url.searchParams.delete('sync')
  url.searchParams.delete('mode')
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url)
  window.dispatchEvent(new Event('hashchange'))
}

export function legacyParameterError(search: string, route: Route): string {
  const params = new URLSearchParams(search)
  const mode = params.get('mode')
  if (new Set(params.getAll('mode')).size > 1 || new Set(params.getAll('sync')).size > 1) return '地址包含互相冲突的来源参数。'
  if (mode && !['demo', 'historical', 'repository'].includes(mode)) return '地址中的来源模式无法识别。'
  if (params.has('sync') && mode && mode !== 'repository') return '同步分析与历史或演示来源参数冲突。'
  if (route.name === 'analysis' && params.has('sync') && params.get('sync') !== route.viewSyncId) return '地址中的分析身份冲突。'
  return ''
}

export function useRoute(initialHash?: string): { route: Route; navigate: (route: Route, replace?: boolean) => void } {
  const [route, setRoute] = useState<Route>(() => parseHash(initialHash ?? window.location.hash))

  useEffect(() => {
    const sync = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  const navigate = useCallback((next: Route, replace = false) => {
    applyHash(hashFor(next), replace)
    setRoute(parseHash(hashFor(next)))
  }, [])

  return { route, navigate }
}
