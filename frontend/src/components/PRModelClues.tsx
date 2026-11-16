import { FailureNotice } from '../Feedback'
import type { SnapshotAnalyses } from '../useSnapshotAnalyses'
import { cn } from '../lib/utils'

/** 风险概览：一行摘要 + 旧版绑定说明；提交搜索与逐提交解释在只读详情内完成。 */
export function PRModelClues({ analysis }: { analysis: SnapshotAnalyses }) {
  const { primary, topRisk, coverage, running, modelName, error } = analysis
  const tone = primary ? 'bg-teal' : running ? 'bg-blue' : 'bg-foreground-4'
  return <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border-soft bg-soft px-3 py-2 text-xs" data-testid="pr-risk-line" data-state={primary ? 'ready' : running ? 'running' : 'empty'}>
    <span className={cn('size-1.5 rounded-full', tone)} aria-hidden="true"/>
    <span className="text-foreground-3">模型分数</span>
    <span className="text-sm font-medium text-foreground">{primary ? `${coverage} 有分数 · 最高 ${topRisk!.toFixed(3)}` : running ? '分析中' : '尚无分数'}</span>
    {modelName ? <span className="text-foreground-3">{modelName}</span> : null}
    {error ? <span className="w-full" role="alert"><FailureNotice error={error}/></span> : null}
    {primary?.bindingKind === 'legacy-head-v1' ? <details className="w-full rounded-sm border border-border-soft">
      <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-foreground-2">旧版 HEAD 绑定</summary>
      <div className="border-t border-border-soft p-2.5">
        <p className="text-xs leading-body text-foreground-3">可读取实际固定 HEAD 与已保存评分；不能据此认定具有新版任务的独占基准版本、提交前模型绑定。</p>
        {primary.bindingLimitations.length ? <ul className="mt-1 list-disc pl-5 text-xs text-foreground-3">{primary.bindingLimitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul> : null}
      </div>
    </details> : null}
  </div>
}
