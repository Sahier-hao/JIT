import { expect, it } from 'vitest'
import { restoreShortlist, saveShortlist, storageKey } from './shortlist'
import type { Dataset } from './domain'

const data: Dataset = { mode: 'demo', project: '演示项目', version: 'demo-v1', records: [{ id: 'a', time: '2026-10-01T00:00:00Z' }, { id: 'b', time: '2026-10-02T00:00:00Z' }] }
const entries = new Map<string, string>()
const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) } }
const access = () => storage

it('CRR-09 恢复相同成员与加入顺序，仅保存标识', () => {
  entries.clear()
  expect(saveShortlist(data, ['b', 'a'], access)).toBe('')
  expect(restoreShortlist(data, access)).toEqual({ ids: ['b', 'a'], warning: '' })
  expect(JSON.parse(entries.get(storageKey(data))!)).toEqual({ schema: 1, ids: ['b', 'a'] })
})
it('CRR-09 不同项目和版本隔离，不删除其他记录', () => {  entries.clear(); entries.set('unrelated', 'keep')
  saveShortlist(data, ['a'], access)
  expect(restoreShortlist({ ...data, version: 'demo-v2' }, access).ids).toEqual([])
  expect(restoreShortlist({ ...data, project: '另一个项目' }, access).ids).toEqual([])
  expect(entries.get('unrelated')).toBe('keep')
  expect(restoreShortlist(data, access).ids).toEqual(['a'])
})
it.each(['{', '{}', '{"schema":2,"ids":["a"]}', '{"schema":1,"ids":[1]}', 'null'])('CRR-09 内容损坏或不支持 %s 可重新选择', (raw) => {
  entries.clear(); entries.set(storageKey(data), raw)
  const result = restoreShortlist(data, access)
  expect(result.ids).toEqual([]); expect(result.warning).toMatch(/恢复失败/)
  expect(saveShortlist(data, ['b'], access)).toBe('')
  expect(restoreShortlist(data, access).ids).toEqual(['b'])
})
it('CRR-09 去重且排除未知标识，保留有效加入顺序', () => {
  entries.clear(); entries.set(storageKey(data), JSON.stringify({ schema: 1, ids: ['b', 'ghost', 'a', 'b'] }))
  const result = restoreShortlist(data, access)
  expect(result.ids).toEqual(['b', 'a']); expect(result.warning).toMatch(/恢复失败/)
})
it('CRR-10 无法取得或读取存储时恢复失败，返回可操作空清单', () => {
  const denied = () => { throw new Error('拒绝访问') }
  expect(restoreShortlist(data, denied)).toMatchObject({ ids: [], warning: expect.stringContaining('恢复失败') })
  expect(restoreShortlist(data, () => ({ ...storage, getItem: () => { throw new Error('读失败') } }))).toMatchObject({ ids: [], warning: expect.stringContaining('恢复失败') })
})
it('CRR-10 保存被拒绝必须提示刷新后可能丢失', () => {
  const denied = () => ({ ...storage, setItem: () => { throw new Error('空间不足') } })
  expect(saveShortlist(data, ['a'], denied)).toBe('本次清单未能保存，刷新后可能丢失')
})

it('CRR-09 仓库模式不按当前页过滤清单，交给清单视图逐条确认', () => {
  entries.clear()
  const repository: Dataset = {
    mode: 'repository', project: 'jit', version: 'kamei14-git-v1-jit-2026-10-12_2026-10-18-770c916c', records: [],
    repository: { syncId: 'sync-1', repositoryUrl: 'https://github.com/x/y.git', branch: 'main', datasetVersion: null, requestedStrategy: 'auto', modelStrategy: null, degradeReason: null, trainRecords: null, trainPositives: null, labelNote: '标签由简化 SZZ 生成' },
  }
  saveShortlist(repository, ['a', 'zzz'], access)
  expect(restoreShortlist(repository, access)).toEqual({ ids: ['a', 'zzz'], warning: '' })
  expect(storageKey(repository)).toBe('jit-review:shortlist:v2:repository:sync-1')
})
