import { expect, it } from 'vitest'
import { previewLegacyPlan, migrateLegacyPlan, restoreShortlist, saveShortlist, storageKey } from './shortlist'
import type { Dataset } from './domain'

const base: Dataset = { mode: 'repository', project: 'repo', version: 'data-A', records: [], repository: { repositoryId: 'repo-A', syncId: 'analysis-A', repositoryUrl: 'local', branch: 'main', datasetVersion: 'data-A', requestedStrategy: 'auto', modelStrategy: null, degradeReason: null, trainRecords: null, trainPositives: null, labelNote: '' } }
function memory() { const map = new Map<string, string>(); const access = () => ({ getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } }); return { map, access } }
it('isolates two repositories and analyses with the same SHA and preserves order across unloaded pages', () => {
  const { access } = memory()
  saveShortlist(base, ['sha-B', 'sha-A', 'sha-B'], access)
  expect(restoreShortlist(base, access).ids).toEqual(['sha-B', 'sha-A'])
  expect(restoreShortlist({ ...base, repository: { ...base.repository!, syncId: 'analysis-B' } }, access).ids).toEqual([])
  expect(restoreShortlist({ ...base, repository: { ...base.repository!, repositoryId: 'repo-B' } }, access).ids).toEqual([])
})
it('previews and explicitly imports the matching legacy key once, retaining old bytes', () => {
  const { map, access } = memory()
  const key = 'jit-review:shortlist:v2:repository:analysis-A'
  map.set(key, JSON.stringify({ schema: 1, ids: ['sha-A', 'sha-B'] }))
  const old = map.get(key)
  expect(restoreShortlist(base, access).ids).toEqual([])
  expect(previewLegacyPlan(base, access).ids).toEqual(['sha-A', 'sha-B'])
  migrateLegacyPlan(base, ['sha-B'], access)
  migrateLegacyPlan(base, ['sha-B'], access)
  expect(restoreShortlist(base, access).ids).toEqual(['sha-B'])
  expect(map.get(key)).toBe(old)
})
it('keeps the existing saved plan when storage rejects a write', () => {
  const { map, access } = memory(); saveShortlist(base, ['sha-A'], access)
  const before = map.get(storageKey(base))
  const warning = saveShortlist(base, ['sha-B'], () => ({ getItem: access().getItem, setItem: () => { throw new Error('denied') } }))
  expect(warning).not.toBe(''); expect(map.get(storageKey(base))).toBe(before)
})
