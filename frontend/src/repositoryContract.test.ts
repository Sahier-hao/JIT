/**
 * 仓库同步契约（任务 7.5、RCL-07/08/09）。
 *
 * 契约层立场与其它模块一致：形状不符就拒绝，不做"尽力解释"；失败提示只补充"下一步"，
 * 不改写服务端给出的错误码与原因。
 */

import { describe, expect, it } from 'vitest'
import {
  failHint,
  parseSync,
  parseSyncCommitPage,
  parseSyncPage,
  repositoryName,
  syncBody,
} from './repositoryContract'

const SYNC = {
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
  runId: '9c7d6e5f-4a3b-4c2d-8e1f-0a9b8c7d6e5f',
  modelId: null,
  modelStrategy: 'generic-model',
  degradeReason: 'fewPositives',
  trainRecords: 120,
  trainPositives: 4,
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
  labelNote: '未观测到缺陷引入（简化 SZZ）',
  features: { ns: 1, nd: 2, nf: 3, entropy: 0.5, la: 30, ld: 4 },
}

describe('parseSync', () => {
  it('保留取消状态、排队位置和执行时限，并拒绝无效排队位置', () => {
    expect(parseSync({ ...SYNC, status: 'cancelled', stage: 'scoring', queuePosition: null,
      startedAt: '2026-10-18T06:00:00Z', deadlineAt: '2026-10-18T06:10:00Z',
      cancelRequestedAt: '2026-10-18T06:01:00Z' })).toMatchObject({
      status: 'cancelled', cancelRequestedAt: '2026-10-18T06:01:00Z',
    })
    expect(parseSync({ ...SYNC, status: 'queued', queuePosition: 2 })).toMatchObject({ queuePosition: 2 })
    expect(() => parseSync({ ...SYNC, status: 'queued', queuePosition: 0 })).toThrow()
  })
  it('接受完整作业视图并保留降级原因与训练计数', () => {
    expect(parseSync(SYNC)).toMatchObject({
      syncId: SYNC.syncId,
      status: 'completed',
      modelStrategy: 'generic-model',
      degradeReason: 'fewPositives',
      trainRecords: 120,
      trainPositives: 4,
      error: null,
    })
  })

  it.each([
    ['非 UUID 身份', { syncId: 'sync-1' }],
    ['未知状态', { status: 'running' }],
    ['未知策略', { requestedStrategy: 'train-always' }],
    ['未知模型来源', { modelStrategy: 'something-else' }],
    ['空分支', { branch: '' }],
    ['负数上限', { commitLimit: -1 }],
    ['时间缺时区', { createdAt: '2026-10-18 06:00:00' }],
  ])('拒绝%s', (_label, patch) => {
    expect(() => parseSync({ ...SYNC, ...patch })).toThrow()
  })

  it('失败作业带错误码与原因，提示只补充下一步', () => {
    const sync = parseSync({ ...SYNC, status: 'failed', error: { code: 'REPOSITORY_UNAVAILABLE', message: '仓库不可访问' } })
    expect(failHint(sync.error)).toMatchObject({
      title: '仓库打不开或分支不存在',
      next: expect.stringContaining('HTTP(S)'),
    })
  })
})

describe('parseSyncPage 与 parseSyncCommitPage', () => {
  it('分页计数与作业列表一起解析', () => {
    const page = parseSyncPage({ syncs: [SYNC], total: 1, limit: 20, offset: 0 })
    expect(page.total).toBe(1)
    expect(page.syncs).toHaveLength(1)
  })

  it('提交把 features 投影为 metrics，并保留标签说明', () => {
    const page = parseSyncCommitPage({ syncId: SYNC.syncId, status: 'completed', total: 1, limit: 200, offset: 0, commits: [COMMIT] })
    expect(page.commits[0]).toMatchObject({ commitId: COMMIT.commitId, risk: 0.42, label: 0 })
    expect(page.commits[0].metrics).toEqual(COMMIT.features)
    expect(page.commits[0].labelNote).toContain('简化 SZZ')
  })

  it('拒绝非 0/1 标签与负数度量', () => {
    const base = { syncId: SYNC.syncId, status: 'completed', total: 1, limit: 200, offset: 0 }
    expect(() => parseSyncCommitPage({ ...base, commits: [{ ...COMMIT, label: 2 }] })).toThrow()
    expect(() => parseSyncCommitPage({ ...base, commits: [{ ...COMMIT, features: { la: -1 } }] })).toThrow()
  })
})

describe('syncBody', () => {
  it('留空字段不提交，提交上限转数字', () => {
    expect(
      syncBody({ repositoryUrl: ' https://github.com/octo/example.git ', branch: '', since: '', until: '', commitLimit: ' 300 ', strategy: 'auto' }),
    ).toEqual({ repositoryUrl: 'https://github.com/octo/example.git', commitLimit: 300, strategy: 'auto' })
  })

  it('显式填写的分支与日期原样提交', () => {
    expect(
      syncBody({ repositoryUrl: 'https://github.com/octo/example.git', branch: 'dev', since: '2026-01-01', until: '2026-06-30', commitLimit: '', strategy: 'force-train' }),
    ).toEqual({
      repositoryUrl: 'https://github.com/octo/example.git',
      branch: 'dev',
      since: '2026-01-01',
      until: '2026-06-30',
      strategy: 'force-train',
    })
  })
})

describe('failHint', () => {
  it('模型策略错误说明重新选择或联系管理员', () => {
    expect(failHint({ code: 'MODEL_DISABLED', message: '停用' })?.next).toContain('重新选择')
    expect(failHint({ code: 'DEFAULT_MODEL_REQUIRED', message: '缺少默认' })?.next).toContain('管理员')
  })
  it('未登记错误码保留通用说明，不猜测具体原因', () => {
    expect(failHint({ code: 'SOMETHING_NEW', message: '未知' })).toEqual({
      title: '同步未完成',
      next: expect.stringContaining('错误码'),
    })
  })

  it('没有错误时不给提示', () => {
    expect(failHint(null)).toBeNull()
  })
})

describe('repositoryName', () => {
  it('取末段并去掉 .git 与末尾斜杠', () => {
    expect(repositoryName('https://github.com/octo/example.git')).toBe('example')
    expect(repositoryName('https://github.com/octo/example/')).toBe('example')
    expect(repositoryName('https://github.com/octo/example')).toBe('example')
  })
})
