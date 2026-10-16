/**
 * 浏览器测试的端口与代理目标（任务 1.2）。
 *
 * 两种运行入口共用本模块，避免各自硬编码：
 * - 默认入口保留历史端口 4173（前端）/ 8000（后端）。
 * - 隔离验收入口使用独立端口 4273 / 8123，绝不复用或停止默认服务。
 *
 * 端口与代理目标都可用环境变量覆盖，便于并排运行而不冲突。
 */
export const DEFAULT_FRONTEND_PORT = 4173
export const DEFAULT_SERVICE_PORT = 8000
export const ACCEPTANCE_FRONTEND_PORT = 4273
export const ACCEPTANCE_SERVICE_PORT = 8123

export function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} 不是合法端口：${raw}`)
  return value
}

/** Vite 前端端口；默认入口 4173，隔离入口由配置显式传 4273。 */
export function frontendPort(fallback: number = DEFAULT_FRONTEND_PORT): number {
  return numberFromEnv('JIT_FRONTEND_PORT', fallback)
}

/** 后端服务端口；默认入口 8000，隔离入口由配置显式传 8123。 */
export function servicePort(fallback: number = DEFAULT_SERVICE_PORT): number {
  return numberFromEnv('JIT_SERVICE_PORT', fallback)
}

/** Vite `/api` 代理目标；默认仍指向 127.0.0.1:8000。 */
export function apiTarget(port: number = servicePort()): string {
  return process.env.JIT_API_PROXY_TARGET ?? `http://127.0.0.1:${port}`
}

export function serviceUrl(port: number = servicePort()): string {
  return `http://127.0.0.1:${port}`
}

export function frontendUrl(port: number = frontendPort()): string {
  return `http://127.0.0.1:${port}`
}
