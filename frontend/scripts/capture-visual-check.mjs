/**
 * 视觉核对截图：按路由、视口与主题批量截取整页，作为每批迁移的证据。
 *
 * 用法：
 *   node scripts/capture-visual-check.mjs <输出目录> [路由 ...]
 *   JIT_PREVIEW_URL=http://127.0.0.1:5174 node scripts/capture-visual-check.mjs ../docs/evidence/... "/#/"
 *
 * 主题与密度通过 localStorage 预置，与 index.html 首帧脚本读取同一组键。
 * 页面只是截图与观察，不做断言；断言仍由 Vitest 与 Playwright 用例承担。
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const base = process.env.JIT_PREVIEW_URL ?? 'http://127.0.0.1:5174'
const outDir = resolve(process.argv[2] ?? 'visual-check')
const routes = process.argv.slice(3)
if (!routes.length) routes.push('/#/')

const viewports = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1440x900', width: 1440, height: 900 },
]
const themes = ['concrete', 'charcoal']
const densities = ['comfortable', 'compact']

mkdirSync(outDir, { recursive: true })

function slug(route) {
  return route.replace(/^\/?#?\/?/, '').replace(/[/?=&]+/g, '-').replace(/^-|-$/g, '') || 'root'
}

const browser = await chromium.launch({ channel: 'msedge' })
const failures = []
try {
  for (const route of routes) {
    for (const theme of themes) {
      for (const density of densities) {
        for (const viewport of viewports) {
          // 紧凑密度只额外核对列表页，避免同屏重复。
          if (density === 'compact' && !['/#/projects', '/#/my-reviews', '/#/admin/models'].includes(route)) continue
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 1,
          })
          await context.addInitScript(({ theme, density }) => {
            try {
              localStorage.setItem('jit.theme', theme)
              localStorage.setItem('jit.density', density)
            } catch {}
          }, { theme, density })
          const page = await context.newPage()
          page.on('pageerror', (error) => failures.push(`${route} ${theme}: ${error.message}`))
          await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 30_000 }).catch((error) => {
            failures.push(`${route} 加载失败：${error.message}`)
          })
          await page.waitForTimeout(800)
          const file = `${outDir}/${slug(route)}-${viewport.name}-${theme}-${density}.png`
          await page.screenshot({ path: file, fullPage: true })
          console.log(file)
          await context.close()
        }
      }
    }
  }
} finally {
  await browser.close()
}

if (failures.length) {
  console.error('\n页面错误：')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
}
