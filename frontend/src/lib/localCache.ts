/**
 * 页面级本地快照：进入页面先显示上次成功读取的结果，同时在后台刷新。
 *
 * 只缓存可由后端重新读取的公开数据；个人草稿与偏好仍走各自的存储键。
 * 读取失败、数据过期或结构变化时静默回退到空值，不阻塞页面。
 */
const PREFIX = 'jit.cache.v1:'

export function cacheKey(...parts: (string | number)[]): string {
  return PREFIX + parts.join(':')
}

export function readCache<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const stored = JSON.parse(raw) as { at?: number; value?: T }
    if (typeof stored.at !== 'number' || Date.now() - stored.at > maxAgeMs) return null
    return stored.value ?? null
  } catch {
    return null
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }))
  } catch {
    // 存储空间不足或被禁用时不阻塞页面，下次进入重新读取即可。
  }
}
