// 前端首屏加载基线测量：两视口各 10 次，记录导航、批次接口响应与列表渲染完成时间。
// 结果只描述当前本机链路，不是 NFR-01 阈值判定；原始数据写入运行工作区 docs/evidence/_run/。
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const baseURL = 'http://127.0.0.1:4173'
const viewports = [
  { name: 'desktop-1280', width: 1280, height: 720 },
  { name: 'desktop-1440', width: 1440, height: 900 },
]
const runs = 10
const runDir = fileURLToPath(new URL('../../docs/evidence/_run/', import.meta.url))

const p95 = values => {
  if (!values.length) return null
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.ceil(0.95 * ordered.length) - 1]
}

const browser = await chromium.launch({ channel: 'msedge' })
const report = { kind: 'perf-baseline-frontend', measuredAt: new Date().toISOString(), baseURL, channel: 'msedge', method: `${runs} runs per viewport, nearest-rank P95`, viewports: [] }
for (const viewport of viewports) {
  const samples = []
  for (let run = 1; run <= runs; run++) {
    const context = await browser.newContext({ baseURL, viewport: { width: viewport.width, height: viewport.height } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const started = Date.now()
    const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/review-batch'))
    await page.goto('/')
    const response = await responsePromise
    const fetchMs = Date.now() - started
    const commitLink = page.getByRole('button', { name: /^查看 [a-f0-9]{40}$/ })
    let rendered = 0
    try {
      await commitLink.first().waitFor({ timeout: 30000 })
      rendered = await commitLink.count()
    } catch { rendered = -1 }
    const renderMs = Date.now() - started
    const timing = await page.evaluate(() => {
      const t = performance.timing
      return { loadEventEndMs: t.loadEventEnd > 0 ? t.loadEventEnd - t.navigationStart : null }
    })
    samples.push({ run, viewport: viewport.name, status: response.status(), fetchMs, renderMs, renderedCount: rendered, loadEventEndMs: timing.loadEventEndMs, consoleErrors: errors })
    await context.close()
  }
  const ok = samples.filter(s => s.status === 200 && s.renderedCount === 1853 && s.consoleErrors.length === 0)
  report.viewports.push({
    name: viewport.name,
    samples,
    fetchP95Ms: p95(ok.map(s => s.fetchMs)),
    renderP95Ms: p95(ok.map(s => s.renderMs)),
    validSamples: ok.length,
    statement: '本机链路基线，未做阈值判定。',
  })
}
await browser.close()
mkdirSync(runDir, { recursive: true })
const out = `${runDir}/perf-frontend-first-screen.json`
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ viewports: report.viewports.map(v => ({ name: v.name, validSamples: v.validSamples, fetchP95Ms: v.fetchP95Ms, renderP95Ms: v.renderP95Ms })) }, null, 2))
console.log(`raw written to ${out}`)
