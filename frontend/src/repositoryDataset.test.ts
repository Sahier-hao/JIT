/**
 * 仓库来源的数据集与清单隔离（任务 7.5、RCL-08、CRR-09）。
 *
 * 两个要点：工作台里看到的"提交"必须来自同一次同步（身份不一致就拒绝），
 * 清单按同步作业隔离——同一个仓库再次同步后风险会变，旧清单不跨作业沿用。
 */

import { describe, expect, it } from 'vitest'
import { parseRepository } from './domain'
import { restoreShortlist, saveShortlist, storageKey } from './state/planStorage'

const SYNC = { repositoryId: '11111111-1111-4111-8111-111111111111',
  syncId: '5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f',
  repositoryUrl: 'https://github.com/octo/example.git',
  branch: 'main',
  since: null,
  until: null,
  commitLimit: 500,
  requestedStrategy: 'auto',
  status: 'completed',
  stage: 'completed',
  datasetVersion: 'kamei14-git-v1-example-100_200',
  runId: null,
  modelId: null,
  modelStrategy: 'repository-trained',
  degradeReason: null,
  trainRecords: 120,
  trainPositives: 24,
  createdAt: '2026-10-18T06:00:00Z',
  updatedAt: '2026-10-18T06:01:00Z',
  requestId: null,
  error: null,
}

const COMMIT = {
  commitId: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  epoch: 1729200000,
  risk: 0.42,
  addedLines: 30,
  deletedLines: 4,
  files: 3,
  label: 0,
  labelNote: '未观测到缺陷引入（简化 SZZ），不等于已证实无缺陷',
  features: { ns: 1, nd: 2, nf: 3, entropy: 0.5, la: 30, ld: 4 },
}

function page(overrides: Record<string, unknown> = {}) {
  return { syncId: SYNC.syncId, status: 'completed', total: 1, limit: 200, offset: 0, commits: [COMMIT], ...overrides }
}

describe('parseRepository', () => {
  it('把一页同步提交转成工作台数据集，并保留来源与标签说明', () => {
    const data = parseRepository({ sync: SYNC, page: page() })
    expect(data).toMatchObject({ mode: 'repository', project: 'example', version: SYNC.datasetVersion, total: 1 })
    expect(data.records[0]).toMatchObject({
      id: COMMIT.commitId,
      time: new Date(COMMIT.epoch * 1000).toISOString(),
      risk: 0.42,
      lines: 34,
      files: 3,
      metrics: COMMIT.features,
    })
    expect(data.repository).toMatchObject({
      syncId: SYNC.syncId,
      repositoryUrl: SYNC.repositoryUrl,
      modelStrategy: 'repository-trained',
      trainRecords: 120,
      labelNote: COMMIT.labelNote,
    })
  })

  it('数据集未登记时如实显示，不编造版本号', () => {
    expect(parseRepository({ sync: { ...SYNC, datasetVersion: null }, page: page() }).version).toBe('未登记数据集')
  })

  it('作业与提交页身份不一致时拒绝，避免把两次同步混在一起', () => {
    expect(() => parseRepository({ sync: SYNC, page: page({ syncId: '00000000-1111-4222-8333-444444444444' }) })).toThrow(/身份不一致/)
  })

  it('缺少任一来源时拒绝', () => {
    expect(() => parseRepository({ page: page() })).toThrow()
    expect(() => parseRepository({ sync: SYNC })).toThrow()
  })
})

describe('仓库清单隔离', () => {
  const entries = new Map<string, string>()
  const access = () => ({ getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) } })

  it('按同步作业隔离；同一仓库再次同步不继承旧清单', () => {
    entries.clear()
    const first = parseRepository({ sync: SYNC, page: page() })
    const second = parseRepository({
      sync: { ...SYNC, syncId: '00000000-1111-4222-8333-444444444444' },
      page: page({ syncId: '00000000-1111-4222-8333-444444444444' }),
    })
    saveShortlist(first, [COMMIT.commitId], access)
    expect(restoreShortlist(first, access).ids).toEqual([COMMIT.commitId])
    expect(restoreShortlist(second, access).ids).toEqual([])
    expect(storageKey(first)).not.toBe(storageKey(second))
    expect(storageKey(first)).toContain('repository')
  })
})
