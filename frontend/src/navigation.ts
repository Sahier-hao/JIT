import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export type Route =
  | { name: 'my-reviews' }
  | { name: 'pr-work'; owner: string; repositoryName: string; number: number; repositoryId?: string; snapshotId?: string }
  | { name: 'notifications' }
  | { name: 'repositories' }
  | { name: 'sources' }
  | { name: 'repository'; repositoryId: string; tab?: 'overview' | 'prs' | 'trends' | 'analyses'; viewId?: string }
  | { name: 'analysis'; repositoryId: string; viewSyncId: string; view: 'commits' | 'plan'; commitId?: string }
  | { name: 'comparison'; repositoryId: string; baseSyncId: string; targetSyncId: string }
  | { name: 'report'; runId?: string; view: 'overview' | 'commits' | 'trends' }
  | { name: 'admin'; view: 'models' | 'datasets' | 'training' | 'comparisons'; resourceId?: string; version?: string; models?: string[] }
  | { name: 'legacy-sync'; syncId: string; view: 'commits' | 'plan' }
  | { name: 'retired'; hash: string }
  | { name: 'unknown'; hash: string }

/**
 * 外层地址是 `#/projects`、`#/projects/new`、`#/projects/:id`，提交明细沿用分析身份
 * `#/projects/:id/analyses/:syncId/(commits|plan)`。旧的 `#/repositories/...` 与
 * `#/connect` 继续可解析，已有书签不会断。
 */
export function parseHash(hash: string): Route {
  try {
    const [rawPath, query = ''] = hash.replace(/^#/, '').split('?')
    const params = new URLSearchParams(query)
    const snapshotId = params.get('snapshotId') || undefined
    const path = rawPath.replace(/\/+$/, '')
    const parts = path.replace(/^\//, '').split('/').map(decodeURIComponent)
    if (parts.some(part => part.includes('/') || part.includes('\\'))) return { name: 'unknown', hash }
    if (!path || path === '/') return { name: 'repositories' }
    if (path === '/reviews') return { name: 'my-reviews' }
    if (path === '/notifications') return { name: 'notifications' }
    if (parts[0] === 'reviews' && parts.length === 4 && /^[A-Za-z0-9_.-]+$/.test(parts[1]) && /^[A-Za-z0-9_.-]+$/.test(parts[2]) && /^[1-9]\d*$/.test(parts[3])) return { name: 'pr-work', owner: parts[1], repositoryName: parts[2], number: Number(parts[3]), ...(snapshotId ? { snapshotId } : {}) }
    if (['/projects', '/repositories'].includes(path)) return { name: 'repositories' }
    if (['/projects/new', '/connect', '/sources'].includes(path)) return { name: 'sources' }
    const comparisonModels = (params.get('models') ?? '').split(',').map(value => value.trim()).filter(Boolean)
    if (path === '/admin' || path === '/admin/models') return { name: 'admin', view: 'models' }
    if (parts[0] === 'admin' && parts[1] === 'models' && parts.length === 3) return { name: 'admin', view: 'models', resourceId: parts[2] }
    if (path === '/admin/datasets') return { name: 'admin', view: 'datasets' }
    if (parts[0] === 'admin' && parts[1] === 'datasets' && [3, 4].includes(parts.length)) return { name: 'admin', view: 'datasets', resourceId: parts[2], ...(parts[3] ? { version: parts[3] } : {}) }
    if (path === '/admin/training') return { name: 'admin', view: 'training' }
    if (parts[0] === 'admin' && parts[1] === 'training' && parts.length === 3) return { name: 'admin', view: 'training', resourceId: parts[2] }
    if (path === '/admin/comparisons') return { name: 'admin', view: 'comparisons', ...(comparisonModels.length ? { models: comparisonModels } : {}) }
    if (path === '/admin/reports') return { name: 'report', view: 'overview' }
    if (parts[0] === 'admin' && parts[1] === 'reports' && parts.length === 4 && ['overview', 'commits', 'trends'].includes(parts[3])) return { name: 'report', runId: parts[2], view: parts[3] as 'overview' | 'commits' | 'trends' }
    if (['/reports', '/validation', '/trends'].includes(path)) return { name: 'report', view: path === '/trends' ? 'trends' : 'overview' }
    const projectRoot = parts[0] === 'projects' || parts[0] === 'repositories'
    if (projectRoot && parts[2] === 'prs' && parts.length === 6 && /^[A-Za-z0-9_.-]+$/.test(parts[3]) && /^[A-Za-z0-9_.-]+$/.test(parts[4]) && /^[1-9]\d*$/.test(parts[5])) return { name: 'pr-work', repositoryId: parts[1], owner: parts[3], repositoryName: parts[4], number: Number(parts[5]), ...(snapshotId ? { snapshotId } : {}) }
    if (projectRoot && parts.length === 3 && ['overview', 'prs', 'trends', 'analyses'].includes(parts[2])) return { name: 'repository', repositoryId: parts[1], tab: parts[2] as 'overview' | 'prs' | 'trends' | 'analyses' }
    if (projectRoot && parts.length === 4 && parts[2] === 'trends') return { name: 'repository', repositoryId: parts[1], tab: 'trends', viewId: parts[3] }
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
    case 'my-reviews': return '#/reviews'
    case 'pr-work': return `${route.repositoryId ? `#/projects/${encodeURIComponent(route.repositoryId)}/prs` : '#/reviews'}/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repositoryName)}/${route.number}${route.snapshotId ? `?snapshotId=${encodeURIComponent(route.snapshotId)}` : ''}`
    case 'notifications': return '#/notifications'
    case 'repositories': return '#/projects'
    case 'sources': return '#/projects/new'
    case 'repository': return `#/projects/${encodeURIComponent(route.repositoryId)}${route.tab ? `/${route.tab}${route.tab === 'trends' && route.viewId ? `/${encodeURIComponent(route.viewId)}` : ''}` : ''}`
    case 'comparison': return `#/projects/${encodeURIComponent(route.repositoryId)}/compare/${encodeURIComponent(route.baseSyncId)}/${encodeURIComponent(route.targetSyncId)}`
    case 'analysis': return `#/projects/${encodeURIComponent(route.repositoryId)}/analyses/${encodeURIComponent(route.viewSyncId)}/${route.view}${route.commitId ? '/'+encodeURIComponent(route.commitId) : ''}`
    case 'report': return route.runId ? `#/admin/reports/${encodeURIComponent(route.runId)}/${route.view}` : '#/admin/reports'
    case 'admin': {
      const base = `#/admin/${route.view}`
      if (route.view === 'models' && route.resourceId) return `${base}/${encodeURIComponent(route.resourceId)}`
      if (route.view === 'datasets' && route.resourceId) return `${base}/${encodeURIComponent(route.resourceId)}${route.version ? `/${encodeURIComponent(route.version)}` : ''}`
      if (route.view === 'training' && route.resourceId) return `${base}/${encodeURIComponent(route.resourceId)}`
      if (route.view === 'comparisons' && route.models?.length) return `${base}?models=${encodeURIComponent(route.models.join(','))}`
      return base
    }
    case 'legacy-sync': return `#/legacy/sync/${encodeURIComponent(route.syncId)}/${route.view}`
    default: return route.hash
  }
}
export function useRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  // HashRouter 把 `#/projects/...` 解析为 pathname；解析器仍以带 `#` 的地址工作，旧解析逻辑不变。
  const route = parseHash(`#${location.pathname}${location.search}`)
  useEffect(() => {
    if (location.pathname === '/' && !location.search) navigate(hashFor({ name: 'repositories' }).replace(/^#/, ''), { replace: true })
  }, [location.pathname, location.search, navigate])
  const go = useCallback((next: Route, replace = false) => {
    navigate(hashFor(next).replace(/^#/, ''), { replace })
  }, [navigate])
  return { route, navigate: go }
}
