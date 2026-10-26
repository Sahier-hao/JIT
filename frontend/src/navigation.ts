import { useCallback, useEffect, useState } from 'react'

export type Route =
  | { name: 'repositories' }
  | { name: 'sources' }
  | { name: 'repository'; repositoryId: string }
  | { name: 'analysis'; repositoryId: string; viewSyncId: string; view: 'commits' | 'plan'; commitId?: string }
  | { name: 'comparison'; repositoryId: string; baseSyncId: string; targetSyncId: string }
  | { name: 'report'; runId?: string; view: 'overview' | 'commits' | 'trends' }
  | { name: 'admin'; view: 'models' | 'datasets' }
  | { name: 'legacy-sync'; syncId: string; view: 'commits' | 'plan' }
  | { name: 'retired'; hash: string }
  | { name: 'unknown'; hash: string }

/**
 * 外层地址是 `#/projects`、`#/projects/new`、`#/projects/:id`，审查页沿用分析身份
 * `#/projects/:id/analyses/:syncId/(commits|plan)`。旧的 `#/repositories/...` 与
 * `#/connect` 继续可解析，已有书签不会断。
 */
export function parseHash(hash: string): Route {
  try {
    const path = hash.replace(/^#/, '').split('?')[0].replace(/\/+$/, '')
    const parts = path.replace(/^\//, '').split('/').map(decodeURIComponent)
    if (parts.some(part => part.includes('/') || part.includes('\\'))) return { name: 'unknown', hash }
    if (!path || path === '/' || ['/projects', '/repositories'].includes(path)) return { name: 'repositories' }
    if (['/projects/new', '/connect', '/sources'].includes(path)) return { name: 'sources' }
    if (path === '/admin' || path === '/admin/models') return { name: 'admin', view: 'models' }
    if (path === '/admin/datasets') return { name: 'admin', view: 'datasets' }
    if (path === '/admin/reports') return { name: 'report', view: 'overview' }
    if (parts[0] === 'admin' && parts[1] === 'reports' && parts.length === 4 && ['overview', 'commits', 'trends'].includes(parts[3])) return { name: 'report', runId: parts[2], view: parts[3] as 'overview' | 'commits' | 'trends' }
    if (['/reports', '/validation', '/trends'].includes(path)) return { name: 'report', view: path === '/trends' ? 'trends' : 'overview' }
    const projectRoot = parts[0] === 'projects' || parts[0] === 'repositories'
    if (projectRoot && parts.length === 2) return { name: 'repository', repositoryId: parts[1] }
    if (projectRoot && parts[2] === 'compare' && parts.length === 5) return { name: 'comparison', repositoryId: parts[1], baseSyncId: parts[3], targetSyncId: parts[4] }
    if (projectRoot && parts[2] === 'analyses' && (parts[4] === 'commits' || parts[4] === 'plan') && [5, 6].includes(parts.length)) return { name: 'analysis', repositoryId: parts[1], viewSyncId: parts[3], view: parts[4], ...(parts[5] ? { commitId: parts[5] } : {}) }
    if (parts[0] === 'legacy' && parts[1] === 'sync' && parts.length === 4 && ['commits', 'plan'].includes(parts[3])) return { name: 'legacy-sync', syncId: parts[2], view: parts[3] as 'commits' | 'plan' }
    if ((parts[0] === 'reports' && parts.length === 3) || (parts[0] === 'lab' && parts[1] === 'history' && parts.length === 4)) {
      const [runId, view] = parts[0] === 'reports' ? parts.slice(1) : parts.slice(2)
      if (['overview', 'commits', 'trends'].includes(view)) return { name: 'report', runId, view: view as 'overview' | 'commits' | 'trends' }
    }
    if (/^\/(?:lab\/(?:models|predict|results|demo)|models|predict|predictions|settings|shortlist)(?:\/|$)/.test(path)) return { name: 'retired', hash }
    return { name: 'unknown', hash }
  } catch { return { name: 'unknown', hash } }
}
export function hashFor(route: Route): string {
  switch (route.name) {
    case 'repositories': return '#/projects'
    case 'sources': return '#/projects/new'
    case 'repository': return `#/projects/${encodeURIComponent(route.repositoryId)}`
    case 'comparison': return `#/projects/${encodeURIComponent(route.repositoryId)}/compare/${encodeURIComponent(route.baseSyncId)}/${encodeURIComponent(route.targetSyncId)}`
    case 'analysis': return `#/projects/${encodeURIComponent(route.repositoryId)}/analyses/${encodeURIComponent(route.viewSyncId)}/${route.view}${route.commitId ? '/'+encodeURIComponent(route.commitId) : ''}`
    case 'report': return route.runId ? `#/admin/reports/${encodeURIComponent(route.runId)}/${route.view}` : '#/admin/reports'
    case 'admin': return `#/admin/${route.view}`
    case 'legacy-sync': return `#/legacy/sync/${encodeURIComponent(route.syncId)}/${route.view}`
    default: return route.hash
  }
}
export function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const sync = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync)
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync) }
  }, [])
  const navigate = useCallback((next: Route, replace = false) => {
    const url = new URL(window.location.href); url.hash = hashFor(next)
    url.searchParams.delete('mode'); url.searchParams.delete('sync')
    window.history[replace ? 'replaceState' : 'pushState']({}, '', url)
    setRoute(parseHash(url.hash))
  }, [])
  return { route, navigate }
}
