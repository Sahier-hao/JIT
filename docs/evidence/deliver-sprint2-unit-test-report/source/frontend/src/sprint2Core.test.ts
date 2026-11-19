import { describe, expect, it } from 'vitest'
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

describe('Sprint2 前端纯函数三场景', () => {
  it('contextKey 正常组合区分数据来源与运行 [AI生成]', () => {
    const first = { mode: 'demo', project: 'a', version: 'v1', runId: 'r1' } as unknown as Dataset
    const second = { ...first, runId: 'r2' } as Dataset
    expect(contextKey(first)).not.toBe(contextKey(second))
  })

  it('contextKey 边界忽略无关可变字段 [AI生成]', () => {
    const base = {
      mode: 'repository',
      project: 'a',
      version: 'v1',
      repository: { syncId: 's1' },
      records: [{ id: 'commit' }],
    } as unknown as Dataset
    expect(contextKey(base)).toBe(contextKey({ ...base, records: [] }))
  })

  it('contextKey 异常数据仍只使用稳定来源字段 [AI生成]', () => {
    const base = { mode: 'demo', project: 'a', version: 'v1' } as unknown as Dataset
    expect(contextKey(base)).toBe(contextKey({ ...base, records: [{ title: 'changed' }] } as unknown as Dataset))
  })

  it('parseDataset 正常保留必填字段与可选度量 [AI生成]', () => {
    const parsed = parseDataset(dataset([{ ...record(), lines: 12, files: 3 }]))
    expect(parsed.records[0]).toMatchObject({ id: 'demo-a', lines: 12, files: 3 })
  })

  it('parseDataset 边界接受空集合 [AI生成]', () => {
    expect(parseDataset(dataset([])).records).toEqual([])
  })

  it('parseDataset 异常拒绝重复提交身份 [AI生成]', () => {
    expect(() => parseDataset(dataset([record(), record()]))).toThrow('提交标识重复')
  })

  it('validRisk 正常接受闭区间内的有限数 [AI生成]', () => {
    expect(validRisk(0.42)).toBe(true)
  })

  it('validRisk 边界接受 0 与 1 [AI生成]', () => {
    expect(validRisk(0)).toBe(true)
    expect(validRisk(1)).toBe(true)
  })

  it('validRisk 异常拒绝 NaN、越界和字符串 [AI生成]', () => {
    expect(validRisk(NaN)).toBe(false)
    expect(validRisk(1.1)).toBe(false)
    expect(validRisk('0.4')).toBe(false)
  })

  it('riskLabel 正常格式化为两位小数 [AI生成]', () => {
    expect(riskLabel(0.725)).toBe('0.72')
  })

  it('riskLabel 边界区分 0 与缺失值 [AI生成]', () => {
    expect(riskLabel(0)).toBe('0.00')
    expect(riskLabel(null)).toBe('暂无预测')
  })

  it('riskLabel 异常不把坏风险显示成数值 [AI生成]', () => {
    expect(riskLabel(NaN)).toBe('风险数据无效')
    expect(riskLabel(1.1)).toBe('风险数据无效')
  })

  it('shanghaiDate 正常把 UTC 转成上海日期 [AI生成]', () => {
    expect(shanghaiDate('2026-10-01T16:00:00Z')).toBe('2026-10-02')
  })

  it('shanghaiDate 边界保留跨日界线前一天 [AI生成]', () => {
    expect(shanghaiDate('2026-10-01T15:59:59Z')).toBe('2026-10-01')
  })

  it('shanghaiDate 异常拒绝不可解析时间 [AI生成]', () => {
    expect(() => shanghaiDate('not-a-time')).toThrow()
  })

  it('displayTime 正常输出带日期的上海时间 [AI生成]', () => {
    expect(displayTime('2026-10-02T01:05:00Z')).toBe('2026-10-02 09:05')
  })

  it('displayTime 边界使用 24 小时制午夜 [AI生成]', () => {
    expect(displayTime('2026-10-01T16:00:00Z')).toBe('2026-10-02 00:00')
  })

  it('displayTime 异常拒绝不可解析时间 [AI生成]', () => {
    expect(() => displayTime('invalid')).toThrow()
  })

  it('queryCommits 正常按风险稳定排序 [AI生成]', () => {
    const records = parseDataset(dataset([
      record('b', '2026-10-01T09:00:00+08:00', 0.4),
      record('a', '2026-10-02T09:00:00+08:00', 0.8),
    ])).records
    expect(queryCommits(records, emptyQuery).map((item) => item.id)).toEqual(['a', 'b'])
  })

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

  it('queryCommits 异常风险数据排在有效风险之后 [AI生成]', () => {
    const records = parseDataset(dataset([
      record('bad', '2026-10-03T09:00:00+08:00', NaN),
      record('good', '2026-10-01T09:00:00+08:00', 0.5),
    ])).records
    expect(queryCommits(records, emptyQuery).map((item) => item.id)).toEqual(['good', 'bad'])
  })

  it('applyQuery 正常接受有效日期范围 [AI生成]', () => {
    const next = { ...emptyQuery, start: '2026-10-01', end: '2026-10-02' }
    expect(applyQuery(emptyQuery, next)).toEqual({ query: next, error: '' })
  })

  it('applyQuery 边界允许清空日期 [AI生成]', () => {
    expect(applyQuery(emptyQuery, { ...emptyQuery, start: '', end: '' })).toEqual({
      query: emptyQuery,
      error: '',
    })
  })

  it('applyQuery 异常保留最近有效查询并解释错误 [AI生成]', () => {
    const previous = { ...emptyQuery, search: 'demo-a' }
    const result = applyQuery(previous, {
      ...emptyQuery,
      start: '2026-10-03',
      end: '2026-10-01',
    })
    expect(result.query).toEqual(previous)
    expect(result.error).toMatch(/日期/)
  })

  it('readSeedQuery 正常读取地址中的日期 [AI生成]', () => {
    expect(readSeedQuery('?start=2026-10-01&end=2026-10-02')).toEqual({
      query: { ...emptyQuery, start: '2026-10-01', end: '2026-10-02' },
      ignored: false,
    })
  })

  it('readSeedQuery 边界忽略无关参数 [AI生成]', () => {
    expect(readSeedQuery('?sort=time')).toEqual({ query: emptyQuery, ignored: false })
  })

  it('readSeedQuery 异常整体忽略非法日期 [AI生成]', () => {
    expect(readSeedQuery('?start=2026-10-03&end=2026-10-01')).toEqual({
      query: emptyQuery,
      ignored: true,
    })
  })

  it('toCommit 正常映射同步提交与度量 [AI生成]', () => {
    expect(toCommit({ ...COMMIT, metrics: COMMIT.features } as never)).toMatchObject({
      id: COMMIT.commitId,
      lines: 34,
      files: 3,
      metrics: COMMIT.features,
      title: '修复边界',
    })
  })

  it('toCommit 边界把 epoch 0 转成可比较时间 [AI生成]', () => {
    expect(toCommit({ ...COMMIT, epoch: 0 } as never).time).toBe('1970-01-01T00:00:00.000Z')
  })

  it('toCommit 异常拒绝不可表示的时间值 [AI生成]', () => {
    expect(() => toCommit({ ...COMMIT, epoch: Number.NaN } as never)).toThrow()
  })

  it('parseRepository 正常返回同步来源与首屏记录 [AI生成]', () => {
    const parsed = parseRepository({ sync: SYNC, page: PAGE })
    expect(parsed.repository).toMatchObject({
      syncId: SYNC.syncId,
      repositoryUrl: SYNC.repositoryUrl,
      labelNote: COMMIT.labelNote,
    })
    expect(parsed.records[0]).toMatchObject({ id: COMMIT.commitId, risk: 0.42 })
  })

  it('parseRepository 边界接受空提交页 [AI生成]', () => {
    expect(parseRepository({
      sync: SYNC,
      page: { ...PAGE, total: 0, commits: [] },
    }).records).toEqual([])
  })

  it('parseRepository 异常拒绝同步与分页身份不一致 [AI生成]', () => {
    expect(() => parseRepository({
      sync: SYNC,
      page: { ...PAGE, syncId: 'bc7e0a31-7e07-4ac9-b076-46c88e260d40' },
    })).toThrow('同步作业身份不一致')
  })
})
