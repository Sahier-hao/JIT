/**
 * 轻量 hash 导航（design D1）。
 *
 * 旧工作台继续使用无 hash 的地址与 `?mode=demo` 查询串，新页面挂在下面四个路由上：
 * `#/models`、`#/predict`、`#/predictions`、`#/predictions/{batchId}`。未知路由不静默
 * 回落到首页，而是给出可返回的提示。
 */

import { useCallback, useEffect, useState } from 'react'

export type Route =
  | { name: 'workbench' }
  | { name: 'models' }
  | { name: 'predict' }
  | { name: 'open' }
  | { name: 'result'; batchId: string }
  | { name: 'unknown'; hash: string }

export const ROUTE_HASH = {
  workbench: '',
  models: '#/models',
  predict: '#/predict',
  open: '#/predictions',
} as const

export function parseHash(hash: string): Route {
  const raw = (hash.startsWith('#') ? hash.slice(1) : hash).trim()
  if (raw === '' || raw === '/') return { name: 'workbench' }
  const segments = raw.replace(/^\/+/, '').replace(/\/+$/, '').split('/')
  if (segments.length === 1 && segments[0] === 'models') return { name: 'models' }
  if (segments.length === 1 && segments[0] === 'predict') return { name: 'predict' }
  if (segments.length === 1 && segments[0] === 'predictions') return { name: 'open' }
  if (segments.length === 2 && segments[0] === 'predictions' && segments[1] !== '') {
    return { name: 'result', batchId: decodeURIComponent(segments[1]) }
  }
  return { name: 'unknown', hash }
}

export function hashFor(route: Route): string {
  switch (route.name) {
    case 'workbench':
      return ROUTE_HASH.workbench
    case 'models':
      return ROUTE_HASH.models
    case 'predict':
      return ROUTE_HASH.predict
    case 'open':
      return ROUTE_HASH.open
    case 'result':
      return `#/predictions/${encodeURIComponent(route.batchId)}`
    default:
      return route.hash
  }
}

/** 结果链接：保留 origin 与路径，去掉演示查询串，只带批次身份（MPW-09）。 */
export function resultLink(batchId: string, location: { origin: string; pathname: string }): string {
  return `${location.origin}${location.pathname}#/predictions/${encodeURIComponent(batchId)}`
}

function applyHash(hash: string): void {
  const url = new URL(window.location.href)
  url.hash = hash
  window.history.pushState({}, '', url)
  window.dispatchEvent(new Event('hashchange'))
}

export function useRoute(initialHash?: string): { route: Route; navigate: (route: Route) => void } {
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

  const navigate = useCallback((next: Route) => {
    applyHash(hashFor(next))
    setRoute(next)
  }, [])

  return { route, navigate }
}
