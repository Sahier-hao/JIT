import { Button } from '../ui/controls'
import type { AnalysisScope } from '../repositoryWorkspace'

const number = (value: number | null) => value == null ? '—' : value.toLocaleString('zh-CN')
const decimal = (value: number | null) => value == null ? '—' : value.toFixed(3)
const date = (value: string | null) => value ? value.slice(0, 10) : '—'

/** 结果卡顶部的分析口径：谁训练、用哪份数据、哪些提交是模型没见过的。 */
export function AnalysisScopeCard({ scope, onOpenDataset }: {
  scope: AnalysisScope
  onOpenDataset: () => void
}) {
  const trained = scope.strategy === 'repository-trained'
  const split = scope.split
  const dataset = scope.dataset
  const metrics = scope.metrics
  const metricItems = metrics ? [
    ['ROC-AUC', decimal(metrics.rocAuc)],
    ['AP', decimal(metrics.averagePrecision)],
    ['无信息 AP', decimal(metrics.referenceAp)],
    ['F1', decimal(metrics.f1)],
  ] : []
  return <section className="analysis-scope" aria-label="分析口径">
    <div className="scope-head">
      <div className="scope-title">
        <span className={`scope-tag ${trained ? 'is-trained' : 'is-generic'}`}>
          {trained ? '项目自训模型' : '现成模型'}
        </span>
        <div>
          <h3>{scope.model.name ?? '模型身份未记录'}</h3>
          <p>{[scope.model.algorithmName, scope.model.featureSchemaVersion, scope.model.id?.slice(0, 8)].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      {dataset ? <Button variant="ghost" size="sm" onClick={onOpenDataset}>查看数据集</Button> : null}
    </div>
    {trained && dataset && split ? <>
      <dl className="scope-grid">
        <div>
          <dt>数据集</dt>
          <dd>{number(dataset.quality.includedRows)} / {number(dataset.quality.rawRows)} 条纳入</dd>
          <span>{number(dataset.quality.positiveLabels)} 个正例 · {dataset.labelRule ?? '标签规则未声明'}</span>
        </div>
        <div>
          <dt>训练 / 验证 / 测试</dt>
          <dd>{number(split.train.count)} / {number(split.validation.count)} / {number(split.test.count)}</dd>
          <span>测试截止 {date(split.test.end)}</span>
        </div>
        <div className="is-holdout">
          <dt>留出（模型没见过）</dt>
          <dd>{number(split.holdout.count)} 条 · {number(split.holdout.positives)} 个正例</dd>
          <span>{date(split.holdout.start)} 起只打分</span>
        </div>
      </dl>
      {metrics ? <p className="scope-metrics">
        <b>测试集</b>{number(metrics.records)} 条 / {number(metrics.positives)} 正例
        {metricItems.map(([label, value]) => <span key={label}>{label} <b>{value}</b></span>)}
      </p> : null}
    </> : trained && dataset ? <p className="scope-note">
      数据集 {number(dataset.quality.includedRows)} / {number(dataset.quality.rawRows)} 条纳入；本次分析没有可用的时间切分产物，无法区分训练、测试与留出。
    </p> : trained ? <p className="scope-note">数据集摘要不可用{scope.datasetError ? `（${scope.datasetError}）` : ''}；仍可查看提交分数与分区。</p>
      : <p className="scope-note">使用现成模型，没有在本项目训练，也没有本地训练/测试集。</p>}
    <p className="scope-boundary">分档只是未校准的模型分数，不是缺陷概率；训练与测试提交不等于“新提交”。</p>
  </section>
}
