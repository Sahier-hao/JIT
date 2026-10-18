/**
 * 一次性视觉证据采集（change restyle-frontend-visual-language 的任务 6.3）。
 *
 * 只在需要冻结证据时手工运行：`npx playwright test e2e/visual-evidence.spec.ts`。
 * 输出写入运行工作区 `docs/evidence/_run/restyle-frontend-visual-language/`，
 * 再由 `jit_baseline.cli freeze-evidence` 冻结到归档目录；测试本身不写归档目录。
 *
 * 模型与结果接口用页面级路由拦截，正文取自 `src/testFixtures.ts`，因此这里不需要真实凭据，
 * 也不会写默认开发库。
 */
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { ensureDir, runEvidenceDir } from '../evidence.ts'
import { BATCH_ID, COMMIT_ID, MODEL_ID, SIX_VALUES, modelPayload, predictionPayload, schemaPayload } from '../src/testFixtures.ts'
import { trendBucketsFixture, trendFixture } from '../src/trend-fixture.ts'

const outDir = `${runEvidenceDir}/restyle-frontend-visual-language`
const ACCESS_TOKEN = 'evidence-only-fake-token'

function writeJson(name: string, value: unknown) {
  ensureDir(outDir)
  writeFileSync(`${outDir}/${name}`, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function shot(page: Page, name: string) {
  ensureDir(outDir)
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true, animations: 'disabled' })
}

/** 等字体与布局稳定：行高依赖字体度量，量行数前必须先等 font 加载完成。 */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await page.waitForTimeout(120)
}

/** 页面级横向溢出：容器右边界越界元素与 scrollWidth 双判。 */
async function overflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
      .slice(0, 5),
  }))
}

/** 表格可视行数：完全落在滚动容器可视区内的行数。 */
async function visibleRows(page: Page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap')
    if (wrap === null) return { rows: 0, wrapHeight: 0 }
    const box = wrap.getBoundingClientRect()
    const rows = Array.from(wrap.querySelectorAll('tbody tr')).filter((row) => {
      const rect = row.getBoundingClientRect()
      return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1
    })
    return { rows: rows.length, wrapHeight: Math.round(box.height) }
  })
}

/** 连量两次取一致值：首帧的字体重排会让行高短暂不同，量一个会漂的数字没有意义。 */
async function stableRows(page: Page) {
  let previous = await visibleRows(page)
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.waitForTimeout(100)
    const current = await visibleRows(page)
    if (current.rows === previous.rows && current.wrapHeight === previous.wrapHeight) return current
    previous = current
  }
  return previous
}

/** 单视口：页面本身不滚，只有表格区滚（工作台 D12）。 */
async function viewportFit(page: Page) {
  return page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    tableScrolls: (() => {
      const wrap = document.querySelector('.table-wrap') as HTMLElement | null
      return wrap === null ? false : wrap.scrollHeight > wrap.clientHeight + 1
    })(),
  }))
}

function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** 读取元素计算后的文字色与其实际背景（向上找到第一个不透明背景），换算 WCAG 对比度。 */
async function contrast(page: Page, selector: string) {
  return page.evaluate((target) => {
    const element = document.querySelector(target)
    if (element === null) return null
    const read = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/)
      if (match === null) return { r: 0, g: 0, b: 0, a: 1 }
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }
    }
    const style = getComputedStyle(element)
    const fg = read(style.color)
    let node: Element | null = element
    let bg = { r: 255, g: 255, b: 255, a: 1 }
    while (node !== null) {
      const candidate = read(getComputedStyle(node).backgroundColor)
      if (candidate.a > 0.95) {
        bg = candidate
        break
      }
      node = node.parentElement
    }
    return {
      fg: `rgba(${fg.r}, ${fg.g}, ${fg.b}, ${fg.a})`,
      bg: `rgba(${bg.r}, ${bg.g}, ${bg.b}, ${bg.a})`,
      fgParts: fg,
      bgParts: bg,
    }
  }, selector)
}

function ratio(fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return Number((((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2))
}

const contrastPairs = [
  { name: '页脚', selector: '.fp-foot' },
  { name: '表尾', selector: '.fp-list-footer' },
  { name: '元信息', selector: '.fp-meta' },
  { name: '风险值', selector: '.fp-risk' },
]

test('视觉证据：工作台两视口布局与对比度', async ({ page }, info) => {
  const viewport = info.project.name
  await page.goto('/')
  await expect(page.getByRole('button', { name: /^查看 [a-f0-9]{40}$/ }).first()).toBeVisible()
  await settle(page)

  const overflowReal = await overflow(page)
  const rowsReal = await stableRows(page)
  const fitReal = await viewportFit(page)
  await shot(page, `workbench-historical-${viewport}`)

  const contrastResult: Record<string, unknown> = {}
  // 用真实存在的元素取样：页脚、表尾、元信息与风险值。
  for (const pair of contrastPairs) {
    const selector =
      pair.selector === '.fp-foot'
        ? '.page-foot'
        : pair.selector === '.fp-list-footer'
          ? '.list-footer'
          : pair.selector === '.fp-meta'
            ? '.page-head .meta'
            : '.risk-number'
    const sample = await contrast(page, selector)
    if (sample === null) continue
    contrastResult[pair.name] = {
      selector,
      fg: sample.fg,
      bg: sample.bg,
      ratio: ratio(sample.fgParts, sample.bgParts),
    }
  }

  await page.goto('/?mode=demo')
  await expect(page.getByRole('button', { name: /^查看 demo-/ }).first()).toBeVisible()
  await settle(page)
  const rowsDemo = await stableRows(page)
  const fitDemo = await viewportFit(page)
  const overflowDemo = await overflow(page)
  await shot(page, `workbench-demo-${viewport}`)

  writeJson(`workbench-${viewport}.json`, {
    viewport,
    url: { historical: '/', demo: '/?mode=demo' },
    historical: { overflow: overflowReal, visibleRows: rowsReal, fit: fitReal },
    demo: { overflow: overflowDemo, visibleRows: rowsDemo, fit: fitDemo },
    contrast: contrastResult,
  })

  for (const check of [overflowReal, overflowDemo]) {
    expect(check.offenders).toEqual([])
    expect(check.scrollWidth).toBeLessThanOrEqual(check.clientWidth + 1)
  }
  // 4.2 记录的下限：1440×900 演示 12 行 / 历史 9 行；1280×720 演示 7 行 / 历史 5 行
  // （提示条与基线记录都在页面上时的实测值）。这里断言不小于这些已知实测值。
  const big = (info.project.use.viewport?.height ?? 0) >= 900
  expect(rowsReal.rows).toBeGreaterThanOrEqual(big ? 9 : 5)
  expect(rowsDemo.rows).toBeGreaterThanOrEqual(big ? 12 : 7)
})

/** 模型与结果接口用页面级路由拦截，正文取自 `src/testFixtures.ts`：不需要真实凭据，也不写默认开发库。 */
async function stubApi(page: Page) {
  await page.route('**/api/v1/models', (route) =>
    route.fulfill({
      json: {
        models: [
          modelPayload(),
          modelPayload({
            modelId: 'cccccccc-2222-4333-8444-555555555555',
            name: '失效模型',
            method: 'decision-tree-v1',
            state: 'invalid',
            error: { code: 'INTEGRITY_ERROR', message: '运行文件校验不匹配，请核验并重新登记' },
          }),
        ],
      },
    }),
  )
  await page.route('**/api/v1/prediction-batches/**', (route) =>
    route.fulfill({ json: predictionPayload() }),
  )
  await page.route('**/api/v1/feature-schemas/**', (route) => route.fulfill({ json: schemaPayload() }))
}

async function enterCredential(page: Page) {
  await page.goto('/')
  await page.locator('#credential-input').fill(ACCESS_TOKEN)
  await page.getByRole('button', { name: '使用凭据' }).click()
}

test('视觉证据：模型中心表格与抽屉、新建预测两栏、结果横幅', async ({ page }, info) => {
  const viewport = info.project.name
  await stubApi(page)

  await enterCredential(page)

  // 模型中心：表格 + 抽屉
  await page.goto('/#/models')
  await expect(page.getByRole('heading', { name: '模型中心' })).toBeVisible()
  await expect(page.locator('.model-card').first()).toBeVisible()
  const modelsOverflow = await overflow(page)
  const cardCount = await page.locator('.model-card').count()
  const columnWidths = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.models-table thead th')).map((cell) => ({
      head: cell.textContent?.trim() ?? '',
      width: Math.round(cell.getBoundingClientRect().width),
    })),
  )
  const tableBox = await page.locator('.models-table').boundingBox()
  const panelBox = await page.locator('.models-panel').boundingBox()
  const actionRects = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button.row-action')).map((button) => {
      const rect = button.getBoundingClientRect()
      const cell = button.closest('td')?.getBoundingClientRect()
      return {
        text: button.textContent?.trim() ?? '',
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        cellLeft: cell === undefined ? null : Math.round(cell.left),
        cellRight: cell === undefined ? null : Math.round(cell.right),
        cellWidth: cell === undefined ? null : Math.round(cell.width),
      }
    }),
  )
  await shot(page, `models-${viewport}`)
  await page.getByRole('button', { name: /的来源与局限$/ }).first().click()
  await expect(page.locator('.model-drawer')).toBeVisible()
  const drawerOverflow = await overflow(page)
  await shot(page, `models-drawer-${viewport}`)
  const drawerBox = await page.evaluate(() => {
    const element = document.querySelector('.model-drawer') as HTMLElement | null
    const rect = element?.getBoundingClientRect()
    return {
      rect: rect === undefined ? null : { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) },
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyOverflow: getComputedStyle(document.body).overflow,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      position: element === null ? null : getComputedStyle(element).position,
    }
  })
  await page.keyboard.press('Escape')
  await expect(page.locator('.model-drawer')).toHaveCount(0)

  // 新建预测：两栏 + aria-invalid 可见态
  await page.goto('/#/predict')
  await expect(page.getByRole('heading', { name: '新建预测' })).toBeVisible()
  await page.locator('input[name="prediction-model"]').first().check()
  await page.locator('#predict-field-project').fill('openstack')
  await page.locator('#predict-field-ns').fill('2.5')
  await page.locator('#predict-field-ns').blur()
  const predictOverflow = await overflow(page)
  const fields = await page.locator('.field-grid input').count()
  const invalidVisible = await page.locator('#predict-field-ns[aria-invalid="true"]').isVisible()
  await shot(page, `predict-${viewport}`)

  // 结果页：顶部风险横幅 + 左身份 / 右来源
  await page.goto(`/#/predictions/${BATCH_ID}`)
  await expect(page.getByRole('heading', { name: '预测结果' })).toBeVisible()
  await expect(page.locator('.risk-banner')).toBeVisible()
  const resultOverflow = await overflow(page)
  const banner = await page.locator('.risk-banner').boundingBox()
  const grid = await page.locator('.result-grid').evaluate((element) => {
    const style = getComputedStyle(element)
    return { columns: style.gridTemplateColumns, width: Math.round(element.getBoundingClientRect().width) }
  })
  await shot(page, `result-${viewport}`)

  writeJson(`pages-${viewport}.json`, {
    viewport,
    models: { overflow: modelsOverflow, drawerOverflow, drawerBox, cardCount, columnWidths, tableBox, panelBox, actionRects },
    predict: { overflow: predictOverflow, fieldInputs: fields, invalidStyleVisible: invalidVisible },
    result: { overflow: resultOverflow, banner, resultGrid: grid },
    fixtures: { modelId: MODEL_ID, batchId: BATCH_ID, commitId: COMMIT_ID, features: SIX_VALUES },
  })

  for (const check of [modelsOverflow, drawerOverflow, predictOverflow, resultOverflow]) {
    expect(check.offenders).toEqual([])
    expect(check.scrollWidth).toBeLessThanOrEqual(check.clientWidth + 1)
  }
  expect(fields).toBe(10)
  expect(invalidVisible).toBe(true)
  // 两栏：结果页在两个目标视口下都是两列。
  expect(grid.columns.split(' ').length).toBe(2)
})

/**
 * 回归守卫：遮罩必须"压暗"，而不是"提亮"。
 *
 * 曾经的实现是 `background: var(--fg)`；浅色主题下 --fg 近黑没问题，炭黑主题下 --fg 近白，
 * 于是遮罩把深色页面提亮了。这里对四套主题逐个核算：遮罩色与画布混合后不得比画布更亮，
 * 同时紧凑密度必须同样作用于模型表（它也是表格）。
 */
test('视觉证据：遮罩跨主题压暗、紧凑密度作用于模型表', async ({ page }, info) => {
  const viewport = info.project.name
  await stubApi(page)
  await page.addInitScript(() => {
    window.localStorage.setItem('jit.theme', 'charcoal')
    window.localStorage.setItem('jit.density', 'comfortable')
  })
  await enterCredential(page)

  await page.goto('/#/models')
  await expect(page.locator('.model-card').first()).toBeVisible()
  const comfortable = (await page.locator('.model-card').first().boundingBox())?.height ?? 0

  // 四套主题的遮罩都是"暗"的，且与画布混合后不会比画布更亮。
  await page.getByRole('button', { name: /的来源与局限$/ }).first().click()
  await expect(page.locator('.model-drawer')).toBeVisible()
  const scrimColor = await page.locator('.scrim').evaluate((element) => getComputedStyle(element).backgroundColor)

  // 遮罩打开时才量：这时 `.scrim` 真的在 DOM 里，才能读到它的 opacity 并在四套主题下核算混合结果。
  const veil = await page.evaluate(() => {
    const read = (value: string) => {
      const hex = value.trim().replace('#', '')
      return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }
    }
    const luminance = (c: { r: number; g: number; b: number }) => {
      const channel = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
    }
    const root = document.documentElement
    const initialTheme = root.dataset.theme ?? ''
    const scrimOpacity = Number.parseFloat(getComputedStyle(document.querySelector('.scrim') as Element).opacity)
    const themes = ['', 'steel', 'charcoal', 'paper']
    const result = themes.map((theme) => {
      if (theme === '') root.removeAttribute('data-theme')
      else root.dataset.theme = theme
      const style = getComputedStyle(root)
      const scrim = read(style.getPropertyValue('--scrim'))
      const canvas = read(style.getPropertyValue('--canvas'))
      const blend = {
        r: scrim.r * scrimOpacity + canvas.r * (1 - scrimOpacity),
        g: scrim.g * scrimOpacity + canvas.g * (1 - scrimOpacity),
        b: scrim.b * scrimOpacity + canvas.b * (1 - scrimOpacity),
      }
      return {
        theme: theme === '' ? 'concrete' : theme,
        opacity: scrimOpacity,
        scrimLuminance: Number(luminance(scrim).toFixed(4)),
        canvasLuminance: Number(luminance(canvas).toFixed(4)),
        blendLuminance: Number(luminance(blend).toFixed(4)),
      }
    })
    // 量完把主题还原：后面还要在炭黑下截图，别让取样把页面留在最后一套主题上。
    if (initialTheme === '') root.removeAttribute('data-theme')
    else root.dataset.theme = initialTheme
    return result
  })
  for (const item of veil) {
    expect(item.scrimLuminance, `${item.theme} 的遮罩必须是暗色`).toBeLessThan(0.05)
    expect(item.blendLuminance, `${item.theme} 的遮罩不得把画布提亮`).toBeLessThan(item.canvasLuminance)
  }

  await shot(page, `theme-charcoal-models-drawer-${viewport}`)
  await page.keyboard.press('Escape')

  // 紧凑密度：同一张模型表的行高必须变矮（密度只管表格与列表）。
  await page.evaluate(() => {
    document.documentElement.dataset.density = 'compact'
  })
  const compact = (await page.locator('.model-card').first().boundingBox())?.height ?? 0

  await page.goto('/#/predict')
  await expect(page.getByRole('heading', { name: '新建预测' })).toBeVisible()
  await page.locator('input[name="prediction-model"]').first().check()
  await page.locator('#predict-field-ns').fill('2.5')
  await page.locator('#predict-field-ns').blur()
  await shot(page, `theme-charcoal-predict-${viewport}`)

  writeJson(`theme-${viewport}.json`, {
    viewport,
    veil,
    scrimColorWhenDrawerOpen: scrimColor,
    modelRowHeight: { comfortable, compact },
  })

  expect(compact).toBeLessThan(comfortable)
})

/**
 * 任务 5.1 的图表：柱色必须与面板底色区分开。
 *
 * 这里不是"截图存档"而已——曾经把柱色写成 var(--fg-inv)（反白文本色），浅色主题下柱与卡片
 * 同色，一张"提交数"图看上去是空的。为了把"柱 + 两条线 + 三种分区带"都画出来，这里用 6 个
 * 连续月份的**行为夹具**（数值是发明的，仅用于看画法，不是真实统计），真实数值见工作台与
 * `accessibility-desktop-*-trends.json`。
 */
function monthlyTrendFixture() {
  type Partition = 'train' | 'validation' | 'test'
  // 四个训练区间的连续月份看"观测线连成线"，两个测试区间的月份带风险分布看"估计线"。
  // 中间有意留空（不连续），图表应断开而不是把 2012 与 2013 连起来。
  const months: [string, string, number, number, Partition][] = [
    ['2012-01-01T00:00:00+08:00', '2012-02-01T00:00:00+08:00', 143, 0.1469, 'train'],
    ['2012-02-01T00:00:00+08:00', '2012-03-01T00:00:00+08:00', 8, 0.125, 'train'],
    ['2012-03-01T00:00:00+08:00', '2012-04-01T00:00:00+08:00', 96, 0.1562, 'train'],
    ['2012-04-01T00:00:00+08:00', '2012-05-01T00:00:00+08:00', 61, 0.1148, 'train'],
    ['2013-12-01T00:00:00+08:00', '2014-01-01T00:00:00+08:00', 88, 0.1705, 'test'],
    ['2014-01-01T00:00:00+08:00', '2014-02-01T00:00:00+08:00', 74, 0.1622, 'test'],
  ]
  const buckets = months.map(([start, end, commits, rate, partition], index) => {
    const positives = Math.round(commits * rate)
    const byPartition = {
      train: { commits: 0, positives: 0 },
      validation: { commits: 0, positives: 0 },
      test: { commits: 0, positives: 0 },
    }
    byPartition[partition] = { commits, positives }
    return {
      start,
      end,
      commits,
      positives,
      // 第 2 桶低于最小样本：比例无值 + 原因，图上应当断开而不是连成一条直线
      observedRate:
        index === 1
          ? { value: null, reason: `该桶提交数 ${commits} 低于最小样本 20` }
          : { value: rate, reason: null },
      byPartition,
      risk:
        partition === 'test'
          ? { count: Math.round(commits * 0.4), median: 0.09 + index * 0.01, p90: 0.4218, reason: null }
          : null,
    }
  })
  // 只换 trendBuckets：summary.split 保持夹具原样，否则工作台侧的批次契约会判"数据不可用"。
  return trendFixture({ ...trendBucketsFixture(), buckets })
}

test('视觉证据：历史趋势图表（柱、双线、分区带、图例）', async ({ page }, info) => {
  const viewport = info.project.name
  await page.route('**/api/review-batch', (route) => route.fulfill({ json: monthlyTrendFixture() }))
  await page.goto('/#/trends')
  await expect(page.locator('.trend-chart')).toBeVisible()
  await settle(page)

  const chart = await page.evaluate(() => {
    const svg = document.querySelector('.trend-chart') as SVGSVGElement | null
    const panel = document.querySelector('.trend-panel') as HTMLElement | null
    if (svg === null || panel === null) return null
    const bars = Array.from(svg.querySelectorAll('.trend-bar'))
    const style = (element: Element) => getComputedStyle(element)
    const fills = [...new Set(bars.map((bar) => style(bar).fill))]
    return {
      barCount: bars.length,
      barFills: fills,
      barHeights: bars.map((bar) => Math.round(bar.getBoundingClientRect().height)),
      panelBackground: style(panel).backgroundColor,
      bands: Array.from(svg.querySelectorAll('.trend-band')).map((band) => band.getAttribute('class') ?? ''),
      lines: Array.from(svg.querySelectorAll('.trend-line')).map((line) => ({
        cls: line.getAttribute('class') ?? '',
        stroke: style(line).stroke,
      })),
      dots: svg.querySelectorAll('.trend-dot').length,
      gaps: svg.querySelectorAll('.trend-gap').length,
      legendSwatches: Array.from(document.querySelectorAll('.trend-swatch')).map((swatch) => ({
        cls: swatch.getAttribute('class') ?? '',
        background: style(swatch).backgroundColor,
      })),
    }
  })
  const chartOverflow = await overflow(page)
  await page.locator('.trend-panel').first().screenshot({ path: `${outDir}/trends-chart-${viewport}.png`, animations: 'disabled' })
  await shot(page, `trends-${viewport}`)

  writeJson(`trends-${viewport}.json`, {
    viewport,
    fixture: 'monthlyTrendFixture（6 个连续月份的行为夹具，数值为发明的画法样本，不是真实统计）',
    chart,
    overflow: chartOverflow,
  })

  expect(chart).not.toBeNull()
  // 柱数与桶数一致，且每根柱都有可见高度
  expect(chart!.barCount).toBe(6)
  expect(chart!.barHeights.every((height) => height > 0)).toBe(true)
  // 柱色只能是 --chart-bar 一种，且必须与面板底色不同（否则柱会被看成"没画"）
  expect(chart!.barFills).toHaveLength(1)
  expect(chart!.barFills[0]).not.toBe(chart!.panelBackground)
  // 两个绘图区各有序列：观测线实线、估计线虚线（估计线只落在测试区间）
  expect(chart!.lines.some((line) => line.cls.includes('trend-line-observed'))).toBe(true)
  expect(chart!.lines.some((line) => line.cls.includes('trend-line-estimated'))).toBe(true)
  // 分区带：训练/验证用斜线纹理，测试区用实底
  expect(chart!.bands.filter((band) => band.includes('trend-band-hatch'))).toHaveLength(2)
  expect(chart!.bands.filter((band) => band.includes('trend-band-test'))).toHaveLength(1)
  // 图例色块与柱/线同色
  expect(chart!.legendSwatches.find((swatch) => swatch.cls.includes('trend-swatch-bar'))?.background).toBe(chart!.barFills[0])
  expect(chartOverflow.offenders).toEqual([])
  expect(chartOverflow.scrollWidth).toBeLessThanOrEqual(chartOverflow.clientWidth + 1)
})
