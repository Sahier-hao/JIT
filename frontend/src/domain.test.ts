import { describe, expect, it } from 'vitest'
import { parseDataset, riskLabel, queryCommits, applyQuery, emptyQuery, shanghaiDate } from './domain'

const record = (id = 'demo-a', time = '2026-10-02T09:00:00+08:00', risk: unknown = 0.7) => ({ id, time, risk })
const data = (records: unknown[] = [record()]) => ({ project: '演示项目', version: 'demo-v1', records })

describe('CRR-01/02/03/11 数据与风险边界', () => {
  it('接受固定来源、唯一提交及缺失可选度量', () => {
    expect(parseDataset(data()).records[0]).toMatchObject({ id: 'demo-a', time: '2026-10-02T09:00:00+08:00' })
    expect(parseDataset(data()).records[0].lines).toBeUndefined()
  })
  it.each(['project', 'version'])('拒绝缺少来源 %s', (key) => { expect(() => parseDataset({ ...data(), [key]: '' })).toThrow(/来源/) })
  it('拒绝重复标识', () => { expect(() => parseDataset(data([record(), record()]))).toThrow(/重复/) })
  it.each(['', 'nonsense', '2026-10-02T09:00:00', '2026-02-30T09:00:00+08:00'])('拒绝无效或无时区时间 %s', (time) => { expect(() => parseDataset(data([record('a', time)]))).toThrow(/时间/) })
  it('拒绝空标识', () => { expect(() => parseDataset(data([record('')]))).toThrow(/标识/) })
  it('允许空集合', () => { expect(parseDataset(data([])).records).toEqual([]) })
  it.each([[0, '0%'], [1, '100%'], [0.725, '72.5%'], [null, '暂无预测'], [undefined, '暂无预测'], [NaN, '风险数据无效'], [Infinity, '风险数据无效'], [-0.1, '风险数据无效'], [1.1, '风险数据无效'], ['0.7', '风险数据无效']])('风险 %s 显示 %s', (risk, label) => { expect(riskLabel(risk)).toBe(label) })
})

describe('CRR-04/05/06 查询与稳定排序', () => {
  const records = parseDataset(data([
    record('demo-b', '2026-10-01T16:00:00Z', 0.8),
    record('demo-a', '2026-10-01T16:00:00Z', 0.8),
    record('demo-c', '2026-10-02T10:00:00+08:00', 0.8),
    record('demo-d', '2026-10-03T08:00:00+08:00', null),
    record('demo-e', '2026-10-03T09:00:00+08:00', 1.5),
    record('demo-f', '2026-10-01T23:59:59+08:00', 0),
  ])).records
  const ids = (query = emptyQuery) => queryCommits(records, query).map(c => c.id)
  it('风险同分以时间再以标识排序，缺失与无效最后', () => { expect(ids()).toEqual(['demo-c', 'demo-a', 'demo-b', 'demo-f', 'demo-e', 'demo-d']) })
  it('时间排序以标识破同时间，不改写原数据', () => {
    const before = JSON.stringify(records)
    expect(ids({ ...emptyQuery, sort: 'time' })).toEqual(['demo-e', 'demo-d', 'demo-c', 'demo-a', 'demo-b', 'demo-f'])
    expect(JSON.stringify(records)).toBe(before)
  })
  it('搜索忽略大小写首尾空白并可清空', () => {
    expect(ids({ ...emptyQuery, search: ' DEMO-A ' })).toEqual(['demo-a'])
    expect(ids({ ...emptyQuery, search: '' })).toHaveLength(6)
    expect(ids({ ...emptyQuery, search: 'missing' })).toEqual([])
  })
  it('上海日界线与双侧日期包含起止当天', () => {
    expect(shanghaiDate('2026-10-01T16:00:00Z')).toBe('2026-10-02')
    expect(ids({ ...emptyQuery, start: '2026-10-02', end: '2026-10-02' })).toEqual(['demo-c', 'demo-a', 'demo-b'])
  })
  it('单侧与搜索组合、清空搜索保留日期', () => {
    expect(ids({ ...emptyQuery, end: '2026-10-01' })).toEqual(['demo-f'])
    expect(ids({ ...emptyQuery, start: '2026-10-03', search: 'DEMO-D' })).toEqual(['demo-d'])
    expect(ids({ ...emptyQuery, start: '2026-10-03', search: '' })).toEqual(['demo-e', 'demo-d'])
  })
  it.each([['2026-10-03', '2026-10-01'], ['2026-02-30', ''], ['nonsense', '']])('无效日期保留最近有效查询 %s %s', (start, end) => {
    const previous = { ...emptyQuery, search: 'demo-a' }
    const result = applyQuery(previous, { ...emptyQuery, start, end })
    expect(result.query).toEqual(previous)
    expect(result.error).toMatch(/日期/)
  })
  it('修正或清除无效日期后接受新查询', () => { expect(applyQuery(emptyQuery, { ...emptyQuery, start: '2026-10-01' })).toEqual({ query: { ...emptyQuery, start: '2026-10-01' }, error: '' }) })
})
