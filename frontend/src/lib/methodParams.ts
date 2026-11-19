const INTERNAL_PARAMETERS = new Set(['threads', 'seed', 'solver', 'tol', 'regularization', 'class_weight'])

/** 只展示用户可理解的受控参数，不重复内部的线程、种子与求解器配置。 */
export function formatMethodParams(parameters: Record<string, unknown> | null): string {
  if (!parameters) return '默认参数'
  return Object.entries(parameters)
    .filter(([key]) => !INTERNAL_PARAMETERS.has(key))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? `[${value.join(',')}]` : value}`)
    .join(' · ')
}
