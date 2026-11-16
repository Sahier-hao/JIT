import { FailureNotice } from '../Feedback'
import type { SnapshotAnalyses } from '../useSnapshotAnalyses'

/** 风险概览：一行摘要 + 旧版绑定说明；提交搜索与逐提交解释在只读详情内完成。 */
export function PRModelClues({ analysis }: { analysis: SnapshotAnalyses }) {
  const { primary, topRisk, coverage, running, modelName, error } = analysis
  return <div className="pr-risk-line" data-state={primary ? 'ready' : running ? 'running' : 'empty'}>
    <span className="pr-risk-label">模型分数</span>
    <span className="pr-risk-value">{primary ? `${coverage} 有分数 · 最高 ${topRisk!.toFixed(3)}` : running ? '分析中' : '尚无分数'}</span>
    {modelName ? <span className="pr-risk-model">{modelName}</span> : null}
    {error ? <span className="pr-risk-error" role="alert"><FailureNotice error={error}/></span> : null}
    {primary?.bindingKind === 'legacy-head-v1' ? <details className="pr-risk-legacy">
      <summary>旧版 HEAD 绑定</summary>
      <p>可读取实际固定 HEAD 与已保存评分；不能据此认定具有新版任务的独占基准版本、提交前模型绑定。</p>
      {primary.bindingLimitations.length ? <ul>{primary.bindingLimitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul> : null}
    </details> : null}
  </div>
}
