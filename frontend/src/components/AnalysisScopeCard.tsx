import { Button } from '@/components/ui/button'

import type { AnalysisScope } from '../repositoryWorkspace'

const number = (value: number | null) => value == null ? '—' : value.toLocaleString('zh-CN')
const decimal = (value: number | null) => value == null ? '—' : value.toFixed(3)
const date = (value: string | null) => value ? value.slice(0, 10) : '—'
const shortHash = (value: string | null) => value ? value.slice(0, 12) : null
const identityText = (label: string, value: string) => label === '数据' ? value : shortHash(value) ?? value

/** 结果卡顶部的分析口径：谁训练、用哪份数据、哪些提交是模型没见过的。 */
export function AnalysisScopeCard({ scope, onOpenDataset }: {
  scope: AnalysisScope
  onOpenDataset: () => void
}) {
  const trained = scope.strategy === 'repository-trained'
  const split = scope.split
  const coverage = scope.partitionCoverage
  const dataset = scope.dataset
  const metrics = scope.metrics
  const frozen = scope.frozenIdentity
  const identityItems = frozen ? [
    ['模型', frozen.modelSha256], ['运行', frozen.artifactRunId],
    ['数据', frozen.datasetVersion], ['成员', frozen.memberSha256],
  ].filter(([, value]) => value) as [string, string][] : []
  const metricItems = metrics ? [
    ['ROC-AUC', decimal(metrics.rocAuc)],
    ['AP', decimal(metrics.averagePrecision)],
    ['无信息 AP', decimal(metrics.referenceAp)],
    ['F1', decimal(metrics.f1)],
  ] : []
  return <section className="grid gap-3 rounded-md border border-border-soft bg-card p-card" aria-label="分析口径">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        <span className={`rounded-sm px-1.5 py-0.5 text-xs font-medium ${trained ? 'bg-blue-soft text-blue-deep' : 'bg-soft text-foreground-3'}`}>
          {trained ? '项目自训模型' : '现成模型'}
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-title text-foreground">{scope.model.name ?? '模型身份未记录'}</h3>
          <p className="mt-0.5 text-xs text-foreground-3">{[scope.model.algorithmName, scope.model.featureSchemaVersion, scope.model.id?.slice(0, 8)].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      {dataset ? <Button variant="ghost" size="sm" onClick={onOpenDataset} type="button">查看数据集</Button> : null}
    </div>
    {trained && dataset && split ? <>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-0.5 border-t border-border-soft pt-2">
          <dt className="text-xs text-foreground-3">数据集</dt>
          <dd className="text-sm text-foreground">{number(dataset.quality.includedRows)} / {number(dataset.quality.rawRows)} 条纳入</dd>
          <span className="text-xs text-foreground-4">{number(dataset.quality.positiveLabels)} 个正例 · {dataset.labelRule ?? '标签规则未声明'}</span>
        </div>
        <div className="grid gap-0.5 border-t border-border-soft pt-2">
          <dt className="text-xs text-foreground-3">训练 / 验证 / 测试</dt>
          <dd className="text-sm text-foreground">{number(split.train.count)} / {number(split.validation.count)} / {number(split.test.count)}</dd>
          <span className="text-xs text-foreground-4">测试截止 {date(split.test.end)}</span>
        </div>
        <div className="grid gap-0.5 border-t border-border-soft pt-2">
          <dt className="text-xs text-accent">留出（模型没见过）</dt>
          <dd className="text-sm text-foreground">{number(split.holdout.count)} 条 · {number(split.holdout.positives)} 个正例</dd>
          <span className="text-xs text-foreground-4">{date(split.holdout.start)} 起的时间视图，不是模型成员</span>
        </div>
      </dl>
      {metrics ? <p data-testid="scope-metrics" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-foreground-3">
        <b className="text-foreground-2">测试集</b>{number(metrics.records)} 条 / {number(metrics.positives)} 正例
        {metricItems.map(([label, value]) => <span key={label}>{label} <b className="text-foreground">{value}</b></span>)}
      </p> : null}
      {identityItems.length ? <p data-testid="scope-identity" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border-soft pt-2 text-xs text-foreground-3">
        <b className="text-foreground-2">冻结身份</b>
        {identityItems.map(([label, value]) => <span key={label}>{label} <code className="font-mono text-foreground" title={value}>{identityText(label, value)}</code></span>)}
      </p> : null}
    </> : trained && dataset ? <p data-testid="scope-note" className="text-xs leading-body text-foreground-3">
      数据集 {number(dataset.quality.includedRows)} / {number(dataset.quality.rawRows)} 条纳入；{coverage && coverage.status === 'unknown'
        ? `训练成员无法核对（${coverage.reason ?? '模型运行未保存切分谱系'}），提交分区显示为未知。`
        : '模型运行没有保存可核对的冻结成员，无法区分训练、测试与留出。'}
    </p> : trained ? <p data-testid="scope-note" className="text-xs leading-body text-foreground-3">数据集摘要不可用{scope.datasetError ? `（${scope.datasetError}）` : ''}；仍可查看提交分数与分区状态。</p>
      : <p data-testid="scope-note" className="text-xs leading-body text-foreground-3">使用现成模型，没有在本项目训练，也没有本地训练/测试集。</p>}
    <p className="border-t border-border-soft pt-2 text-xs leading-body text-foreground-3">分档只是未校准的模型分数，不是缺陷概率；训练与测试提交不等于“新提交”。</p>
  </section>
}
