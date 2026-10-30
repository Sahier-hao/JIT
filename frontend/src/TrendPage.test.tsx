import { render, screen, within } from './test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TrendPage } from './TrendPage'
import { VerificationReport } from './VerificationReport'
import { DEFAULT_INSIGHTS, type TrendInsight } from './trendInsights'
import { jsonResponse } from './testFixtures'
import {
  sparseBucket,
  trendFixture,
  trendFixtureWithAlignedSplit,
  trendFixtureWithBuckets,
  trendFixtureWithoutAggregate,
} from './trend-fixture'

/** 趋势页复用 historicalLoader，因此这里替换 fetch 而不是注入 loader。 */
function stubBatch(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, payload)))
}

const table = () => screen.getByRole('table', { name: /历史趋势文本视图/ })
/** 行文本以月份开头；不能用 includes，否则上一桶的结束时刻也会命中同一个月。 */
const rowFor = (month: string) =>
  within(table())
    .getAllByRole('row')
    .find((row) => (row.textContent ?? '').startsWith(month))

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState({}, '', '/#/trends')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('分区带与分区清单按时间排序，不跟随 JSON 的键序', async () => {
  // 后端写摘要时用 sort_keys，真实响应里的键是字母序（test、train、validation）；
  // 照搬键序会把分区排成"测试、训练、验证"，因此渲染必须按起始时间排序。
  const payload = trendFixture() as unknown as { summary: { split: Record<string, unknown> } }
  const split = payload.summary.split
  payload.summary.split = { test: split['test'], train: split['train'], validation: split['validation'] }
  stubBatch(payload)
  render(<TrendPage />)
  const list = await screen.findByRole('list', { name: '分区范围' })
  const labels = within(list).getAllByRole('listitem').map((item) => (item.textContent ?? '').slice(0, 2))
  expect(labels).toEqual(['训练', '验证', '测试'])
})

it('DTD-03/05 两类序列分别标注，文本视图逐桶可读', async () => {
  stubBatch(trendFixture())
  render(<TrendPage />)
  await screen.findByRole('heading', { name: '历史趋势' })

  expect(screen.getByText(/提交数 · 历史观测/)).toBeVisible()
  expect(screen.getByText(/观测正标签比例 · 历史观测 · 覆盖全部纳入记录/)).toBeVisible()
  expect(screen.getByText(/模型风险中位数 · 模型估计 · 仅测试区间/)).toBeVisible()
  expect(screen.getByText(/观测比例来自发布者历史标签聚合，不是模型效果/)).toBeVisible()
  expect(screen.getByText(/整体为回顾性评价/)).toBeVisible()

  const rows = within(table()).getAllByRole('row')
  expect(rows).toHaveLength(4)
  expect(rowFor('2012-01')).toHaveTextContent('143')
  expect(rowFor('2012-01')).toHaveTextContent('14.7%')
  expect(rowFor('2013-12')).toHaveTextContent('验证 40 · 测试 56')
  expect(rowFor('2013-12')).toHaveTextContent('15.6%')
  expect(rowFor('2013-12')).toHaveTextContent('0.09（测试记录 56 条）')
  expect(within(table()).getByText(/每月|时区 UTC\+08:00/)).toBeVisible()
})

it('DTD-04 空值桶显示样本不足与原因，不渲染为 0%', async () => {
  stubBatch(trendFixture())
  const view = render(<TrendPage />)
  await screen.findByRole('heading', { name: '历史趋势' })

  const sparse = rowFor('2012-02')
  expect(sparse).toHaveTextContent('样本不足：该桶提交数 8 低于最小样本 20')
  expect(sparse).not.toHaveTextContent('0%')
  // 空值桶不绘制数据点：观测序列只有两个点，缺测处用虚线标出。
  expect(view.container.querySelectorAll('.trend-dot-observed')).toHaveLength(2)
  expect(view.container.querySelectorAll('.trend-gap')).toHaveLength(1)
  // 风险只覆盖含测试记录的那个桶。
  expect(view.container.querySelectorAll('.trend-dot-estimated')).toHaveLength(1)
})

it('DTD-02 缺少聚合键时如实说明，且工作台照常可用', async () => {
  stubBatch(trendFixtureWithoutAggregate())
  const view = render(<TrendPage />)
  await screen.findByText('该运行未提供趋势聚合')
  expect(screen.getByText(/没有可核对的时间桶数据/)).toBeVisible()
  expect(screen.getByText(/其余视图（提交工作台、详情、优先审查清单与基线摘要）不受影响/)).toBeVisible()
  expect(view.container.querySelector('.trend-chart')).toBeNull()
  view.unmount()

  window.history.replaceState({}, '', '/')
  render(<VerificationReport route={{ name: 'report', view: 'commits' }} navigate={vi.fn()} />)
  expect(await screen.findByRole('button', { name: `查看 ${'0'.repeat(40)}` })).toBeVisible()
})

it('DTD-02 聚合不合法时只让趋势视图不可用，不扩大失败范围', async () => {
  const broken = trendFixture()
  const summary = broken.summary as unknown as { trendBuckets: Record<string, unknown> }
  summary.trendBuckets = { ...summary.trendBuckets, minSample: 0 }
  stubBatch(broken)
  const view = render(<TrendPage />)
  await screen.findByText('趋势聚合不可用')
  expect(screen.getByText(/minSample/)).toBeVisible()
  expect(screen.getByText(/工作台、详情、清单与基线摘要不受影响/)).toBeVisible()
  expect(view.container.querySelector('.trend-chart')).toBeNull()
  view.unmount()

  window.history.replaceState({}, '', '/')
  render(<VerificationReport route={{ name: 'report', view: 'commits' }} navigate={vi.fn()} />)
  expect(await screen.findByRole('button', { name: `查看 ${'0'.repeat(40)}` })).toBeVisible()
})

it('DTD-01 加载中先给文字状态，随后显示趋势', async () => {
  // 首次渲染必然处于加载态：响应在下一个宏任务之后才兑现。
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return jsonResponse(200, trendFixture())
    }),
  )
  render(<TrendPage />)
  expect(screen.getByText('正在读取')).toBeVisible()
  expect(screen.getByText(/正在读取真实历史运行的摘要与趋势聚合/)).toBeVisible()
  await screen.findByRole('heading', { name: '历史趋势' })
})

it('DTD-01/06 服务失败时给出可读原因与重试入口', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
  render(<TrendPage />)
  await screen.findByText('数据不可用')
  expect(screen.getByRole('alert')).toHaveTextContent(/真实服务不可达/)
  expect(screen.getByRole('button', { name: '重新加载' })).toBeVisible()
})

/** 直接在趋势页上测：分区带、洞察与下钻都在页面内部，不经 App 的路由。 */
async function renderTrend(payload: unknown, options: { insights?: readonly TrendInsight[]; navigate?: (search: string) => void } = {}) {
  stubBatch(payload)
  const view = render(<TrendPage {...options} />)
  await screen.findByRole('heading', { name: '历史趋势' })
  return view
}

it('DTD-08 分区带按运行摘要绘制，并给出各分区范围文字', async () => {
  const view = await renderTrend(trendFixtureWithAlignedSplit())
  const list = screen.getByRole('list', { name: '分区范围' })
  const items = within(list).getAllByRole('listitem')
  expect(items).toHaveLength(3)
  expect(items[0]).toHaveTextContent('训练：')
  expect(items[0]).toHaveTextContent('2012-01-01T00:00:00Z')
  expect(items[0]).toHaveTextContent('6 条 / 正 1')
  expect(items[1]).toHaveTextContent('验证：')
  expect(items[2]).toHaveTextContent('测试：')
  // 三个分区都与桶域有交集，因此图上画出三条带；标签与顺序来自摘要。
  const bands = view.container.querySelectorAll('g[data-partition]')
  expect(bands).toHaveLength(3)
  expect([...bands].map((band) => band.getAttribute('data-partition'))).toEqual(['train', 'validation', 'test'])
})

it('DTD-08 分区越过桶域时按域裁剪，边界仍落在摘要给出的位置', async () => {
  const view = await renderTrend(trendFixtureWithAlignedSplit())
  const axis = view.container.querySelector('.trend-axis') as SVGLineElement
  const left = Number(axis.getAttribute('x1'))
  const right = Number(axis.getAttribute('x2'))
  const testBand = view.container.querySelector('g[data-partition="test"] rect') as SVGRectElement
  const x = Number(testBand.getAttribute('x'))
  const width = Number(testBand.getAttribute('width'))
  // 摘要里测试分区结束于 2014-01-02，晚于最后一个桶的结束时刻，因此必须被裁到轴的右端。
  expect(x).toBeGreaterThanOrEqual(left - 0.001)
  expect(x + width).toBeLessThanOrEqual(right + 0.001)
  expect(x + width).toBeCloseTo(right, 3)
  // 窄于桶域的分区（训练）不会铺满整条轴，且有自己的起始边界线。
  const trainBand = view.container.querySelector('g[data-partition="train"] rect') as SVGRectElement
  expect(Number(trainBand.getAttribute('width'))).toBeLessThan(right - left)
  expect(view.container.querySelector('g[data-partition="train"] .trend-band-edge')).not.toBeNull()
})

it('DTD-08 分区标签不依赖写死的中文名：未命中的键回退原始键名', async () => {
  const payload = trendFixture() as unknown as { summary: { split: Record<string, unknown> } }
  payload.summary.split = {
    ...(payload.summary.split as Record<string, unknown>),
    holdout: { count: 0, positiveCount: 0, start: '2016-01-01T00:00:00Z', end: '2016-12-31T00:00:00Z' },
  }
  const view = await renderTrend(payload)
  const items = within(screen.getByRole('list', { name: '分区范围' })).getAllByRole('listitem')
  expect(items).toHaveLength(4)
  expect(items[3]).toHaveTextContent('holdout：')
  // 默认夹具里测试分区与 holdout 整段落在桶域之外，因此只画与域相交的两条带。
  expect(view.container.querySelectorAll('g[data-partition]')).toHaveLength(2)
})

it('DTD-08 风险数据点只落在测试分区带内', async () => {
  const view = await renderTrend(trendFixtureWithAlignedSplit())
  const testBand = view.container.querySelector('g[data-partition="test"] rect') as SVGRectElement
  const bandLeft = Number(testBand.getAttribute('x'))
  const bandRight = bandLeft + Number(testBand.getAttribute('width'))
  const dots = view.container.querySelectorAll('.trend-dot-estimated')
  expect(dots.length).toBeGreaterThan(0)
  dots.forEach((dot) => {
    // 估计序列的点是 <rect>，观测序列是 <circle>；这里统一取中心横坐标。
    const center =
      dot.tagName.toLowerCase() === 'circle'
        ? Number(dot.getAttribute('cx'))
        : Number(dot.getAttribute('x')) + Number(dot.getAttribute('width')) / 2
    expect(center).toBeGreaterThanOrEqual(bandLeft - 0.001)
    expect(center).toBeLessThanOrEqual(bandRight + 0.001)
  })
})

it('DTD-09 差异按率差给出结论与数值，并标注近似与语义边界', async () => {
  await renderTrend(trendFixtureWithAlignedSplit())
  const panel = screen.getByRole('region', { name: '趋势洞察' })
  expect(panel).toHaveTextContent('估计与观测的差异')
  expect(panel).toHaveTextContent('2013-12')
  expect(panel).toHaveTextContent('15.6%')
  expect(panel).toHaveTextContent('9.3%')
  expect(panel).toHaveTextContent('+6.3 个百分点')
  expect(panel).toHaveTextContent('观测正例（测试）8')
  expect(panel).toHaveTextContent('估计正例（测试）5.2')
  expect(panel).toHaveTextContent('率差 +6.3 pp')
  expect(panel).toHaveTextContent('近似')
  expect(panel).toHaveTextContent('诊断信号')
  expect(panel).toHaveTextContent('概率校准')
  expect(panel).toHaveTextContent('不代表缺陷率')
  expect(panel).not.toHaveTextContent('校准准确')
})

it('DTD-09 注册表新增一项不改变既有洞察的输出，页面照常渲染新增项', async () => {
  const extra: TrendInsight = {
    id: 'extra',
    kind: 'count',
    label: '额外的检查项',
    compute: () => ({ unavailable: false, headline: '额外结论', approximate: false, ranking: [] }),
  }
  const single = await renderTrend(trendFixtureWithAlignedSplit())
  const singleText = single.container.querySelector('[data-insight="gap"]')?.textContent
  single.unmount()

  const both = await renderTrend(trendFixtureWithAlignedSplit(), { insights: [...DEFAULT_INSIGHTS, extra] })
  const panel = screen.getByRole('region', { name: '趋势洞察' })
  expect(panel).toHaveTextContent('额外的检查项')
  expect(panel).toHaveTextContent('额外结论')
  expect(both.container.querySelector('[data-insight="gap"]')?.textContent).toBe(singleText)
})

it('DTD-07 下钻范围由桶自身端点派生：跨月、跨年与非月粒度都不假定"次月"', async () => {
  const navigate = vi.fn()
  const user = userEvent.setup()

  const month = await renderTrend(trendFixture(), { navigate })
  await user.click(screen.getByRole('button', { name: '查看该桶提交：2013-12-01 至 2013-12-31' }))
  expect(navigate).toHaveBeenCalledWith('/?mode=historical&start=2013-12-01&end=2013-12-31#/validation')
  month.unmount()

  // 跨年、且桶跨过元旦：结束端取"次日零点减一秒"，不把 2014-01-08 那一天纳进来。
  const crossYear = await renderTrend(
    trendFixtureWithBuckets([sparseBucket('2013-12-25T00:00:00+08:00', '2014-01-08T00:00:00+08:00')]),
    { navigate },
  )
  await user.click(screen.getByRole('button', { name: '查看该桶提交：2013-12-25 至 2014-01-07' }))
  expect(navigate).toHaveBeenLastCalledWith('/?mode=historical&start=2013-12-25&end=2014-01-07#/validation')
  crossYear.unmount()

  // 非月粒度（两周的桶）同样只看桶自己的端点。
  await renderTrend(trendFixtureWithBuckets([sparseBucket('2012-01-15T00:00:00+08:00', '2012-01-29T00:00:00+08:00')]), { navigate })
  await user.click(screen.getByRole('button', { name: '查看该桶提交：2012-01-15 至 2012-01-28' }))
  expect(navigate).toHaveBeenLastCalledWith('/?mode=historical&start=2012-01-15&end=2012-01-28#/validation')
})

it('DTD-06 图表为双序列分离：柱有独立纵轴、刻度画在轴外、标记为方块', async () => {
  // 默认夹具的 test 分区落在桶域之外，分区带会被裁成 0 宽并过滤掉，这里用范围对齐的夹具
  stubBatch(trendFixtureWithAlignedSplit())
  render(<TrendPage />)
  await screen.findByRole('table', { name: /历史趋势文本视图/ })

  const chart = document.querySelector('.trend-chart') as SVGSVGElement
  expect(chart).not.toBeNull()

  // 上区放提交数（柱），下区放比例/风险（折线）：同一张图里两套纵轴刻度
  expect(chart.querySelectorAll('.trend-bar').length).toBeGreaterThan(0)
  expect(chart.querySelectorAll('rect.trend-dot-observed').length).toBeGreaterThan(0)

  // 刻度画在轴外：短刻度线的数量应覆盖两套纵轴（3 + 3）与横轴标签
  expect(chart.querySelectorAll('.trend-tick').length).toBeGreaterThanOrEqual(6)

  // 标记为方块而非圆点：观测用实心 rect，估计用空心 rect
  expect(chart.querySelectorAll('rect.trend-dot-observed').length).toBeGreaterThan(0)
  expect(chart.querySelectorAll('rect.trend-dot-estimated').length).toBeGreaterThan(0)
  expect(chart.querySelectorAll('circle.trend-dot').length).toBe(0)

  // 分区带：测试分区实底、其余斜线纹理（纹理承载"不参与估计"的语义）
  expect(chart.querySelector('.trend-band-test')).not.toBeNull()
  expect(chart.querySelector('.trend-band-hatch')).not.toBeNull()
})
