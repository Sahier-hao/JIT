import type { Route } from '@/app/navigation'

const PROJECT_NAV_ROUTES: ReadonlySet<Route['name']> = new Set([
  'repositories', 'sources', 'repository', 'analysis', 'comparison', 'my-reviews',
])

/** 侧栏「项目」只在项目与审查相关路由高亮；用户数据、训练、模型和个人中心不得误亮。 */
export function projectsNavActive(route: Route): boolean {
  if (route.name === 'pr-work') return Boolean(route.repositoryId)
  return PROJECT_NAV_ROUTES.has(route.name)
}
