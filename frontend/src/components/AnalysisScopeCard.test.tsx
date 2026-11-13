import { render, screen } from '../test-utils'
import { expect, it, vi } from 'vitest'
import { AnalysisScopeCard } from './AnalysisScopeCard'
import { parseRepositoryDetail } from '../repositoryWorkspace'
import type { AnalysisScope } from '../repositoryWorkspace'

const scope: AnalysisScope = {
  strategy: 'repository-trained',
  model: {
    id: 'b9b24d11-933d-497f-8a7b-ac976f0150df', name: 'claude-scholar · 逻辑回归 · L2',
    algorithmName: '逻辑回归 · L2', featureSchemaVersion: 'kamei14-git-v2',
  },
  dataset: {
    version: 'kamei14-git-v2-claude-scholar-2026-01-25_2026-10-19',
    quality: { rawRows: 178, includedRows: 161, positiveLabels: 30 },
    labelRule: 'szz-simple-v1',
  },
  datasetError: null,
  frozenIdentity: {
    modelId: 'b9b24d11-933d-497f-8a7b-ac976f0150df',
    artifactRunId: 'a'.repeat(64), modelSha256: 'b'.repeat(64),
    datasetVersion: 'kamei14-git-v2-claude-scholar-2026-01-25_2026-10-19',
    datasetSha256: 'c'.repeat(64), memberVerification: 'digest',
    memberSha256: 'd'.repeat(64), splitPreset: 'temporal-70-15-15',
    holdoutFrom: '2026-07-21T10:05:33+08:00',
  },
  split: {
    preset: 'temporal-70-15-15',
    train: { count: 105, end: '2026-04-01T05:59:28Z', endEpoch: 1775023168, positives: null, start: null },
    validation: { count: 22, end: '2026-05-13T02:13:10Z', endEpoch: 1778638390, positives: null, start: null },
    test: { count: 23, end: '2026-07-02T04:26:27Z', endEpoch: 1782966387, positives: null, start: null },
    holdout: { count: 11, end: null, endEpoch: null, positives: 2, start: '2026-07-21T10:05:33Z' },
  },
  metrics: {
    records: 23, positives: 5, rocAuc: 0.778, averagePrecision: 0.733,
    precision: 0.6, recall: 0.6, f1: 0.6, referenceAp: 0.217,
  },
  distributions: { all: { high: 56, medium: 37, low: 85, unknown: 0 } },
  partitionCoverage: {
    status: 'verified', reason: null, preset: 'temporal-70-15-15',
    holdoutFrom: '2026-07-21T10:05:33+08:00', holdoutCutoffEpoch: 1782966387,
  },
  excludedCommitIds: [],
  limitations: [],
}

it('shows the model, dataset and holdout boundaries before the result', () => {
  render(<AnalysisScopeCard scope={scope} onOpenDataset={vi.fn()}/>)
  expect(screen.getByText('项目自训模型')).toBeVisible()
  expect(screen.getByText('claude-scholar · 逻辑回归 · L2')).toBeVisible()
  expect(screen.getByText('161 / 178 条纳入')).toBeVisible()
  expect(screen.getByText('105 / 22 / 23')).toBeVisible()
  expect(screen.getByText('11 条 · 2 个正例')).toBeVisible()
  const metrics = document.querySelector('.scope-metrics')
  expect(metrics).toHaveTextContent('ROC-AUC 0.778')
  expect(metrics).toHaveTextContent('AP 0.733')
  expect(metrics).toHaveTextContent('无信息 AP 0.217')
  const identity = document.querySelector('.scope-identity')
  expect(identity).toHaveTextContent('冻结身份')
  expect(identity).toHaveTextContent('bbbbbbbbbbbb')
  expect(identity).toHaveTextContent('kamei14-git-v2-claude-scholar-2026-01-25_2026-10-19')
  expect(screen.getByText(/不是缺陷概率/)).toBeVisible()
})

it('does not invent a dataset for a generic model', () => {
  render(<AnalysisScopeCard scope={{
    ...scope, strategy: 'generic-model', dataset: null, split: null, metrics: null,
  }} onOpenDataset={vi.fn()}/>)
  expect(screen.getByText('现成模型')).toBeVisible()
  expect(screen.getByText(/没有在本项目训练/)).toBeVisible()
})

it('shows why partitions are unknown instead of guessing them from time', () => {
  render(<AnalysisScopeCard scope={{
    ...scope, split: null, metrics: null,
    partitionCoverage: {
      status: 'unknown', reason: '模型数据版本或切分成员与本项目分析不一致',
      preset: null, holdoutFrom: null, holdoutCutoffEpoch: null,
    },
  }} onOpenDataset={vi.fn()}/>)
  expect(document.querySelector('.scope-note')).toHaveTextContent('训练成员无法核对')
  expect(document.querySelector('.scope-note')).toHaveTextContent('模型数据版本或切分成员与本项目分析不一致')
})

it('parses the analysis scope without dropping the split', () => {
  const detail = parseRepositoryDetail({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    url: 'https://github.com/example/app', displayName: 'app', defaultBranch: 'main',
    latestSyncId: null, latestSyncAt: null, viewSyncId: '22222222-2222-4222-8222-222222222222',
    headCommit: 'a'.repeat(40), commitCount: 1,
    distribution: { high: 1, medium: 0, low: 0, unknown: 0 },
    distributionRule: 'repo-distribution-v1',
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
    modelStrategy: 'repository-trained', degradeReason: null, runId: null, modelId: null,
    datasetVersion: 'data-1', limitations: [], latestSync: null,
    viewContext: {
      repositoryId: '11111111-1111-4111-8111-111111111111',
      syncId: '22222222-2222-4222-8222-222222222222', branch: 'main',
      completedAt: '2026-10-02T00:00:00Z', headCommit: 'a'.repeat(40),
      datasetVersion: 'data-1', modelId: null, runId: null, missingMetadata: [],
      scope: {
        strategy: 'repository-trained', model: { name: '模型' },
        dataset: { version: 'data-1', quality: { rawRows: 10, includedRows: 8, positiveLabels: 2 }, labelRule: 'szz-simple-v1' },
        datasetError: null, metrics: null,
        split: {
          train: { count: 5, end: '2026-01-01T00:00:00Z' }, validation: { count: 2 },
          test: { count: 1 }, holdout: { count: 2, positives: 1 },
        },
        distributions: { holdout: { high: 1, medium: 1, low: 0, unknown: 0 } },
        partitionCoverage: { status: 'verified', reason: null, preset: 'temporal-70-15-15' },
        excludedCommitIds: [], limitations: [],
      },
    },
  })
  expect(detail.viewContext?.scope?.dataset?.quality.includedRows).toBe(8)
  expect(detail.viewContext?.scope?.split?.holdout.count).toBe(2)
  expect(detail.viewContext?.scope?.distributions.holdout.high).toBe(1)
})
