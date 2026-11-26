// === AI 辅助说明 ===
// 本文件共 52 条测试用例
// [AI生成]：52 条（核心断言待负责人逐条复核）
// [AI生成-人工修改]：0 条
// [手写]：0 条
// 使用工具：OpenAI Codex
// 提示词见：prompts/frontend-sprint2-unit-core.md
//
// 阅读方式：
// 1. 每个 it 标题已经写明“函数 + 场景 + 预期”，注释补充它防的业务错误。
// 2. “正常”验证主流程；“边界”验证空集合、0/1、闭区间和稳定排序；
//    “异常”验证坏输入必须报错或降级，不能静默显示成有效结果。
// 3. 这里只测纯函数和投影结果，不挂 React 组件、不访问网络、不使用真实数据。
import { describe, expect, it } from 'vitest'
import type { ChartColors } from '@/components/shared/EChartCanvas'
import { repositoryModelStatus, repositorySchemaReason } from '@/features/models/modelCompatibility'
import {
  bandsOption,
  histogramOption,
  scoreBand,
  scoreHistogram,
} from '@/features/projects/analysisScore'
import type { SyncCommit } from '@/features/projects/repositoryContract'
import {
  applyQuery,
  contextKey,
  displayTime,
  emptyQuery,
  parseDataset,
  parseRepository,
  queryCommits,
  readSeedQuery,
  riskLabel,
  shanghaiDate,
  toCommit,
  validRisk,
} from './domain'
import type { Dataset } from './domain'

const SYNC = {
  syncId: '5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f',
  repositoryId: '11111111-1111-4111-8111-111111111111',
  repositoryUrl: 'https://github.com/octo/example.git',
  branch: 'main',
  commitLimit: 500,
  requestedStrategy: 'auto',
  status: 'completed',
  stage: 'completed',
  createdAt: '2026-10-18T06:00:00Z',
  updatedAt: '2026-10-18T06:01:00Z',
}

const COMMIT = {
  commitId: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  epoch: 1729200000,
  risk: 0.42,
  addedLines: 30,
  deletedLines: 4,
  files: 3,
  label: 0,
  labelNote: '未观测到缺陷引入（简化 SZZ）',
  subject: '修复边界',
  authorName: 'author',
  originalCommitUrl: 'https://github.com/octo/example/commit/a1b2c3d4',
  features: { ns: 1, nd: 2, nf: 3, entropy: 0.5, la: 30, ld: 4 },
  partition: 'test',
}

const PAGE = {
  syncId: SYNC.syncId,
  status: 'completed',
  total: 1,
  limit: 200,
  offset: 0,
  commits: [COMMIT],
}

const record = (id = 'demo-a', time = '2026-10-02T09:00:00+08:00', risk: unknown = 0.7) =>
  ({ id, time, risk })

const dataset = (records: unknown[] = [record()]) => ({
  project: '演示项目',
  version: 'demo-v1',
  records,
})

const scoredCommits = (risks: number[]) =>
  risks.map((risk, index) => ({ commitId: `c${index}`, risk } as unknown as SyncCommit))

const COLORS: ChartColors = {
  series: '#series',
  seriesInk: '#series-ink',
  grid: '#grid',
  axis: '#axis',
  text: '#text',
  textStrong: '#text-strong',
  surface: '#surface',
  border: '#border',
  categorical: ['#low', '#medium', '#third', '#high'],
  other: '#unknown',
}

interface OptionView {
  tooltip: { formatter: (params: unknown) => string }
  xAxis: { data: string[] }
  yAxis: { max: number }
  series: Array<{ data: Array<{ value: number; itemStyle: { color: string } }> }>
}

// 来源身份与输入解析：这些函数决定页面缓存键、提交身份和日期/风险显示。
// 一旦放宽，最容易出现“不同分析互相覆盖”或“坏风险被显示成低风险”。
describe('Sprint2 前端纯函数三场景', () => {
  // 不同运行必须生成不同缓存键，否则后一次分析会覆盖前一次结果。
  it('contextKey 正常组合区分数据来源与运行 [AI生成]', () => {
    // 不同运行必须得到不同上下文键，否则旧分析结果会覆盖新结果。
    const first = { mode: 'demo', project: 'a', version: 'v1', runId: 'r1' } as unknown as Dataset
    const second = { ...first, runId: 'r2' } as Dataset
    expect(contextKey(first)).not.toBe(contextKey(second))
  })

  // 记录列表变化不是“来源变化”，缓存键不能跟着记录内容抖动。
  it('contextKey 边界忽略无关可变字段 [AI生成]', () => {
    // 记录内容变化不应改变“来源身份”；身份只由模式、项目、版本和运行决定。
    const base = {
      mode: 'repository',
      project: 'a',
      version: 'v1',
      repository: { syncId: 's1' },
      records: [{ id: 'commit' }],
    } as unknown as Dataset
    expect(contextKey(base)).toBe(contextKey({ ...base, records: [] }))
  })

  // 即使记录字段损坏，来源身份也只能由稳定字段组成。
  it('contextKey 异常数据仍只使用稳定来源字段 [AI生成]', () => {
    const base = { mode: 'demo', project: 'a', version: 'v1' } as unknown as Dataset
    expect(contextKey(base)).toBe(contextKey({ ...base, records: [{ title: 'changed' }] } as unknown as Dataset))
  })

  // 解析后必须保留提交身份、变更行数和文件数，页面才能排序和展示。
  it('parseDataset 正常保留必填字段与可选度量 [AI生成]', () => {
    const parsed = parseDataset(dataset([{ ...record(), lines: 12, files: 3 }]))
    expect(parsed.records[0]).toMatchObject({ id: 'demo-a', lines: 12, files: 3 })
  })

  // 空数据集是合法状态，不能报错或伪造一条记录。
  it('parseDataset 边界接受空集合 [AI生成]', () => {
    expect(parseDataset(dataset([])).records).toEqual([])
  })

  // 同一提交重复出现会让排序和计数重复，必须直接拒绝。
  it('parseDataset 异常拒绝重复提交身份 [AI生成]', () => {
    // 同一提交出现两次会让风险排序和审查计数重复，必须直接拒绝。
    expect(() => parseDataset(dataset([record(), record()]))).toThrow('提交标识重复')
  })

  // 0 到 1 之间的有限数是唯一合法的风险输入。
  it('validRisk 正常接受闭区间内的有限数 [AI生成]', () => {
    expect(validRisk(0.42)).toBe(true)
  })

  // 0 和 1 是闭区间端点，不能因为“太小/太大”被排除。
  it('validRisk 边界接受 0 与 1 [AI生成]', () => {
    expect(validRisk(0)).toBe(true)
    expect(validRisk(1)).toBe(true)
  })

  // NaN、越界和字符串都不能被当成风险值。
  it('validRisk 异常拒绝 NaN、越界和字符串 [AI生成]', () => {
    expect(validRisk(NaN)).toBe(false)
    expect(validRisk(1.1)).toBe(false)
    expect(validRisk('0.4')).toBe(false)
  })

  // 正常风险固定显示两位小数，便于横向比较。
  it('riskLabel 正常格式化为两位小数 [AI生成]', () => {
    expect(riskLabel(0.725)).toBe('0.72')
  })

  // 0 是“已知低风险”，null 是“暂无预测”，两者不能混用。
  it('riskLabel 边界区分 0 与缺失值 [AI生成]', () => {
    expect(riskLabel(0)).toBe('0.00')
    expect(riskLabel(null)).toBe('暂无预测')
  })

  // NaN 或越界值必须显示“数据无效”，不能被格式化成 0.00。
  it('riskLabel 异常不把坏风险显示成数值 [AI生成]', () => {
    // NaN 或越界值必须显示“数据无效”，不能被格式化成 0.00 误导用户。
    expect(riskLabel(NaN)).toBe('风险数据无效')
    expect(riskLabel(1.1)).toBe('风险数据无效')
  })

  // UTC 16:00 对应上海次日 00:00，日期必须按上海时区计算。
  it('shanghaiDate 正常把 UTC 转成上海日期 [AI生成]', () => {
    expect(shanghaiDate('2026-10-01T16:00:00Z')).toBe('2026-10-02')
  })

  // UTC 15:59:59 仍是上海前一天，跨日界线不能提前。
  it('shanghaiDate 边界保留跨日界线前一天 [AI生成]', () => {
    // UTC 15:59:59 仍是上海前一天；时区边界错一小时会改变筛选结果。
    expect(shanghaiDate('2026-10-01T15:59:59Z')).toBe('2026-10-01')
  })

  // 无法解析的时间必须报错，不能返回 Invalid Date 继续参与筛选。
  it('shanghaiDate 异常拒绝不可解析时间 [AI生成]', () => {
    expect(() => shanghaiDate('not-a-time')).toThrow()
  })

  // 展示时间统一为上海时区的年月日和 24 小时制。
  it('displayTime 正常输出带日期的上海时间 [AI生成]', () => {
    expect(displayTime('2026-10-02T01:05:00Z')).toBe('2026-10-02 09:05')
  })

  // 午夜必须显示 00:00，不能显示 24:00 或前一天。
  it('displayTime 边界使用 24 小时制午夜 [AI生成]', () => {
    expect(displayTime('2026-10-01T16:00:00Z')).toBe('2026-10-02 00:00')
  })

  // 坏时间字符串必须报错，避免页面出现不可读时间。
  it('displayTime 异常拒绝不可解析时间 [AI生成]', () => {
    expect(() => displayTime('invalid')).toThrow()
  })

  // 默认查询必须按风险从高到低排序，风险相同再按稳定规则处理。
  it('queryCommits 正常按风险稳定排序 [AI生成]', () => {
    const records = parseDataset(dataset([
      record('b', '2026-10-01T09:00:00+08:00', 0.4),
      record('a', '2026-10-02T09:00:00+08:00', 0.8),
    ])).records
    expect(queryCommits(records, emptyQuery).map((item) => item.id)).toEqual(['a', 'b'])
  })

  // 搜索忽略大小写和首尾空格；日期范围包含起止当天。
  it('queryCommits 边界组合搜索与包含端点的日期 [AI生成]', () => {
    const records = parseDataset(dataset([
      record('demo-a', '2026-10-01T16:00:00Z', 0.8),
      record('demo-b', '2026-10-03T09:00:00+08:00', 0.2),
    ])).records
    expect(queryCommits(records, {
      ...emptyQuery,
      search: ' DEMO-A ',
      start: '2026-10-02',
      end: '2026-10-02',
    }).map((item) => item.id)).toEqual(['demo-a'])
  })

  // 同分时先按时间降序、再按提交标识升序，保证每次刷新顺序一致。
  it('queryCommits 边界同分按时间降序再按标识升序 [AI生成]', () => {
    // 同分排序必须稳定；否则同一批数据每次刷新顺序不同，审查记录无法复现。
    const records = parseDataset(dataset([
      record('b', '2026-10-01T09:00:00+08:00', 0.8),
      record('a', '2026-10-01T09:00:00+08:00', 0.8),
      record('c', '2026-10-02T09:00:00+08:00', 0.8),
    ])).records
    expect(queryCommits(records, emptyQuery).map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  // 风险无效的记录不能排到有效记录前面，只能作为未知项排在后面。
  it('queryCommits 异常风险数据排在有效风险之后 [AI生成]', () => {
    const records = parseDataset(dataset([
      record('bad', '2026-10-03T09:00:00+08:00', NaN),
      record('good', '2026-10-01T09:00:00+08:00', 0.5),
    ])).records
    expect(queryCommits(records, emptyQuery).map((item) => item.id)).toEqual(['good', 'bad'])
  })

  // 合法日期范围应被接受，并原样作为新查询条件。
  it('applyQuery 正常接受有效日期范围 [AI生成]', () => {
    const next = { ...emptyQuery, start: '2026-10-01', end: '2026-10-02' }
    expect(applyQuery(emptyQuery, next)).toEqual({ query: next, error: '' })
  })

  // 清空日期应回到无日期筛选，而不是报错。
  it('applyQuery 边界允许清空日期 [AI生成]', () => {
    expect(applyQuery(emptyQuery, { ...emptyQuery, start: '', end: '' })).toEqual({
      query: emptyQuery,
      error: '',
    })
  })

  // 日期范围非法时保留旧查询，并给出可读错误。
  it('applyQuery 异常保留最近有效查询并解释错误 [AI生成]', () => {
    // 日期范围非法时不能清空用户当前筛选，只能拒绝新查询并给出原因。
    const previous = { ...emptyQuery, search: 'demo-a' }
    const result = applyQuery(previous, {
      ...emptyQuery,
      start: '2026-10-03',
      end: '2026-10-01',
    })
    expect(result.query).toEqual(previous)
    expect(result.error).toMatch(/日期/)
  })

  // 地址参数中的合法日期应恢复为页面筛选条件。
  it('readSeedQuery 正常读取地址中的日期 [AI生成]', () => {
    expect(readSeedQuery('?start=2026-10-01&end=2026-10-02')).toEqual({
      query: { ...emptyQuery, start: '2026-10-01', end: '2026-10-02' },
      ignored: false,
    })
  })

  // 与筛选无关的地址参数应被忽略，不影响页面状态。
  it('readSeedQuery 边界忽略无关参数 [AI生成]', () => {
    expect(readSeedQuery('?sort=time')).toEqual({ query: emptyQuery, ignored: false })
  })

  // 地址中的日期整体非法时不能只采用一半，应整体忽略并标记。
  it('readSeedQuery 异常整体忽略非法日期 [AI生成]', () => {
    expect(readSeedQuery('?start=2026-10-03&end=2026-10-01')).toEqual({
      query: emptyQuery,
      ignored: true,
    })
  })

  // 同步提交转换为页面提交时，标题、变更行数和文件数必须保留。
  it('toCommit 正常映射同步提交与度量 [AI生成]', () => {
    expect(toCommit({ ...COMMIT, metrics: COMMIT.features } as never)).toMatchObject({
      id: COMMIT.commitId,
      lines: 34,
      files: 3,
      metrics: COMMIT.features,
      title: '修复边界',
    })
  })

  // epoch 0 是合法时间，应转换成 1970-01-01 而不是被当成缺失。
  it('toCommit 边界把 epoch 0 转成可比较时间 [AI生成]', () => {
    expect(toCommit({ ...COMMIT, epoch: 0 } as never).time).toBe('1970-01-01T00:00:00.000Z')
  })

  // NaN 时间不可表示，必须报错，不能生成 Invalid Date。
  it('toCommit 异常拒绝不可表示的时间值 [AI生成]', () => {
    expect(() => toCommit({ ...COMMIT, epoch: Number.NaN } as never)).toThrow()
  })

  // 解析仓库响应时必须同时保留同步来源和首屏提交记录。
  it('parseRepository 正常返回同步来源与首屏记录 [AI生成]', () => {
    const parsed = parseRepository({ sync: SYNC, page: PAGE })
    expect(parsed.repository).toMatchObject({
      syncId: SYNC.syncId,
      repositoryUrl: SYNC.repositoryUrl,
      labelNote: COMMIT.labelNote,
    })
    expect(parsed.records[0]).toMatchObject({ id: COMMIT.commitId, risk: 0.42 })
  })

  // 空提交页是合法状态，应返回空记录而不是报错。
  it('parseRepository 边界接受空提交页 [AI生成]', () => {
    expect(parseRepository({
      sync: SYNC,
      page: { ...PAGE, total: 0, commits: [] },
    }).records).toEqual([])
  })

  // 同步身份与分页身份不一致说明数据拼错了，必须拒绝。
  it('parseRepository 异常拒绝同步与分页身份不一致 [AI生成]', () => {
    expect(() => parseRepository({
      sync: SYNC,
      page: { ...PAGE, syncId: 'bc7e0a31-7e07-4ac9-b076-46c88e260d40' },
    })).toThrow('同步作业身份不一致')
  })
})

// 风险分档与模型可用性：阈值、空值和 schema/模型状态决定用户看到的结论。
// 这些地方宁可显示“不可用/未评分”，也不能把未知值算成低风险。
describe('Sprint2 风险分档与模型可用性 [AI生成]', () => {
  // 0.25 及以上为高档，0.10–0.25 为中档，低于 0.10 为低档。
  it('scoreBand 正常按 0.25 与 0.10 分档 [AI生成]', () => {
    expect(scoreBand(0.30)).toBe('high')
    expect(scoreBand(0.20)).toBe('medium')
    expect(scoreBand(0.05)).toBe('low')
  })

  // 0.10 和 0.25 本身属于较高一档，阈值必须是包含关系。
  it('scoreBand 边界命中 0.10 与 0.25 阈值 [AI生成]', () => {
    // 0.10 和 0.25 属于较高一档；把 >= 改成 > 会让阈值边界显示错档。
    expect(scoreBand(0.25)).toBe('high')
    expect(scoreBand(0.2499)).toBe('medium')
    expect(scoreBand(0.10)).toBe('medium')
    expect(scoreBand(0.0999)).toBe('low')
    expect(scoreBand(0)).toBe('low')
    expect(scoreBand(1)).toBe('high')
  })

  // NaN 和负分不能进入中/高档，只能落到低档并保留无效语义。
  it('scoreBand 异常 NaN 不进入高或中档 [AI生成]', () => {
    expect(scoreBand(Number.NaN)).toBe('low')
    expect(scoreBand(-0.01)).toBe('low')
  })

  // 直方图必须按 0.05 一档累计，桶边界和页面文案一致。
  it('scoreHistogram 正常按 0.05 一档累计 [AI生成]', () => {
    // 直方图分桶必须和页面展示的 0.05 档一致，避免图表和表格对不上。
    const counts = scoreHistogram(scoredCommits([0.01, 0.04, 0.05, 0.099, 0.10, 0.249, 0.25, 0.99, 1]))
    const expected = Array.from({ length: 20 }, () => 0)
    expected[0] = 2
    expected[1] = 2
    expected[2] = 1
    expected[4] = 1
    expected[5] = 1
    expected[19] = 2
    expect(counts).toEqual(expected)
  })

  // 空集合仍保留 20 个桶；1.0 必须进入最后一档而不是越界。
  it('scoreHistogram 边界空集合与 1.0 都保持 20 档 [AI生成]', () => {
    expect(scoreHistogram([])).toEqual(Array.from({ length: 20 }, () => 0))
    const counts = scoreHistogram(scoredCommits([0, 1]))
    expect(counts).toHaveLength(20)
    expect(counts[0]).toBe(1)
    expect(counts[19]).toBe(1)
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(2)
  })

  // 无效分数不能污染有效桶计数，也不能被算成低风险。
  it('scoreHistogram 异常分数不污染有效档计数 [AI生成]', () => {
    const counts = scoreHistogram(scoredCommits([Number.NaN, 0.4]))
    expect(counts).toHaveLength(20)
    expect(counts[8]).toBe(1)
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(1)
  })

  // 当前可用 schema 不应返回不可用原因。
  it('repositorySchemaReason 正常当前 schema 可用于仓库分析 [AI生成]', () => {
    expect(repositorySchemaReason('openstack-six-v1')).toBeNull()
    expect(repositorySchemaReason('kamei14-git-v2')).toBeNull()
  })

  // 旧版和离线 schema 必须给出不同的具体原因，不能笼统说“不可用”。
  it('repositorySchemaReason 边界区分旧版与离线 schema [AI生成]', () => {
    expect(repositorySchemaReason('kamei14-git-v1')).toContain('旧版')
    expect(repositorySchemaReason('kamei14-git-v1')).toContain('v2')
    expect(repositorySchemaReason('kamei14-2013-v1')).toContain('离线')
  })

  // schema 缺失或未知时必须明确说明，不能放行。
  it('repositorySchemaReason 异常缺失或未知 schema 明确不可用 [AI生成]', () => {
    expect(repositorySchemaReason(null)).toContain('未记录')
    expect(repositorySchemaReason(undefined)).toContain('未记录')
    expect(repositorySchemaReason('custom-schema-v9')).toContain('custom-schema-v9')
  })

  // ready 且启用的兼容模型才能声明“可用于仓库分析”。
  it('repositoryModelStatus 正常 ready 且启用的当前模型可用于仓库分析 [AI生成]', () => {
    expect(repositoryModelStatus({
      state: 'ready',
      enabled: true,
      featureSchemaVersion: 'kamei14-git-v2',
    })).toEqual({ supported: true, label: '可用于仓库分析', reason: null })
  })

  // 未就绪或停用的模型不能进入仓库分析，不能只看是否已登记。
  it('repositoryModelStatus 边界未就绪或停用时不声明可用 [AI生成]', () => {
    // 未就绪或停用的模型不能进入仓库分析，不能只凭“已登记”放行。
    expect(repositoryModelStatus({
      state: 'training',
      enabled: true,
      featureSchemaVersion: 'kamei14-git-v2',
    })).toEqual({ supported: false, label: '模型未就绪', reason: '模型产物尚未通过校验。' })
    expect(repositoryModelStatus({
      state: 'ready',
      enabled: false,
      featureSchemaVersion: 'kamei14-git-v2',
    })).toEqual({ supported: false, label: '已停用', reason: '模型已停用，不能用于新分析。' })
  })

  // schema 不兼容时必须给出具体原因，而不是只返回 false。
  it('repositoryModelStatus 异常 schema 不兼容时给出具体原因 [AI生成]', () => {
    const legacy = repositoryModelStatus({
      state: 'ready',
      enabled: true,
      featureSchemaVersion: 'kamei14-git-v1',
    })
    expect(legacy.supported).toBe(false)
    expect(legacy.label).toBe('不可用于仓库分析')
    expect(legacy.reason).toContain('旧版')
    const missing = repositoryModelStatus({
      state: 'ready',
      enabled: true,
      featureSchemaVersion: null,
    })
    expect(missing.supported).toBe(false)
    expect(missing.reason).toContain('未记录')
  })

  // 图表投影必须保留 20 个桶、分档颜色和可读 tooltip。
  it('histogramOption 正常把风险桶和分档颜色写入图表 [AI生成]', () => {
    // 图表投影必须保留桶值、分档颜色和 tooltip 文案，不能只剩一组裸数字。
    const option = histogramOption(
      scoredCommits([0.01, 0.99]),
      COLORS,
    ) as unknown as OptionView
    expect(option.xAxis.data[0]).toBe('0.00')
    expect(option.series[0].data).toHaveLength(20)
    expect(option.series[0].data[0]).toMatchObject({ value: 1, itemStyle: { color: '#low' } })
    expect(option.series[0].data[19]).toMatchObject({ value: 1, itemStyle: { color: '#high' } })
    expect(option.tooltip.formatter([{ dataIndex: 0 }])).toBe('0.00 – 0.05：1 条')
  })

  // 1.0 必须落在末档，空分档也要保留，保证图表横轴稳定。
  it('histogramOption 边界把 1.0 放入末档并保留空分档 [AI生成]', () => {
    const option = histogramOption(scoredCommits([1]), COLORS) as unknown as OptionView
    expect(option.series[0].data[18]).toMatchObject({ value: 0 })
    expect(option.series[0].data[19]).toMatchObject({ value: 1 })
    expect(option.tooltip.formatter([{ dataIndex: 19 }])).toBe('0.95 – 1.00：1 条')
    expect(option.yAxis.max).toBe(4)
  })

  // tooltip 参数异常时回退首档；分类色缺失时回退主色，不能渲染空图。
  it('histogramOption 异常 tooltip 参数回退到首档且缺省分类色回退到主色 [AI生成]', () => {
    const colors = { ...COLORS, categorical: [] }
    const option = histogramOption(scoredCommits([0.01]), colors) as unknown as OptionView
    expect(option.tooltip.formatter(undefined)).toBe('0.00 – 0.05：1 条')
    expect(option.tooltip.formatter([{ dataIndex: 'bad' }])).toBe('0.00 – 0.05：1 条')
    expect(option.series[0].data[0].itemStyle.color).toBe(COLORS.series)
  })

  // 四档柱图必须同时展示高/中/低/未评分，颜色和顺序固定。
  it('bandsOption 正常包含四档并显示未评分 [AI生成]', () => {
    const option = bandsOption(
      { high: 2, medium: 1, low: 3, unknown: 1 },
      COLORS,
    ) as unknown as OptionView
    expect(option.xAxis.data).toEqual(['0.25 及以上', '0.10 – 0.25', '0.10 以下', '未评分'])
    expect(option.series[0].data.map((item) => item.value)).toEqual([2, 1, 3, 1])
    expect(option.series[0].data.map((item) => item.itemStyle.color))
      .toEqual(['#high', '#medium', '#low', '#unknown'])
    expect(option.tooltip.formatter([{ dataIndex: 3 }])).toBe('未评分：1 条')
  })

  // 未评分为 0 时不渲染该档，但其他三档保持完整。
  it('bandsOption 边界未评分数量为零时不渲染该档 [AI生成]', () => {
    const option = bandsOption(
      { high: 1, medium: 2, low: 3, unknown: 0 },
      COLORS,
    ) as unknown as OptionView
    expect(option.xAxis.data).toEqual(['0.25 及以上', '0.10 – 0.25', '0.10 以下'])
    expect(option.series[0].data.map((item) => item.value)).toEqual([1, 2, 3])
    expect(option.tooltip.formatter([{ dataIndex: 2 }])).toBe('0.10 以下：3 条')
  })

  // tooltip 下标越界时返回空字符串，不能抛错或显示错误档位。
  it('bandsOption 异常 tooltip 下标越界时返回空字符串 [AI生成]', () => {
    const option = bandsOption(
      { high: 1, medium: 0, low: 0, unknown: 0 },
      COLORS,
    ) as unknown as OptionView
    expect(option.tooltip.formatter([{ dataIndex: 99 }])).toBe('')
    expect(option.tooltip.formatter(undefined)).toBe('0.25 及以上：1 条')
  })
})
