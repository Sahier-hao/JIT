import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 端口与 `/api` 代理目标参数化（任务 1.2，设计 D8）。
// 默认仍是历史行为：前端 4173、代理 127.0.0.1:8000。
// 隔离浏览器验收入口通过 JIT_FRONTEND_PORT / JIT_API_PROXY_TARGET 把代理指向自有后端，
// 因此隔离运行既不复用、也不会停止正在运行的默认预览或开发服务。
const port = Number(process.env.JIT_FRONTEND_PORT ?? 4173)
const apiTarget = process.env.JIT_API_PROXY_TARGET ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': apiTarget } },
  preview: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': apiTarget } },
})
