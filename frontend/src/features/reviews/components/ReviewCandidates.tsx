import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { candidateKey, codeSideLabels, type CandidateDecision } from '@/features/reviews/prReview'
import type { PRCandidate, PRCodeLocation } from '@/features/reviews/prReviewClient'

const decisions = { confirmed: '确认', rejected: '驳回', deferred: '暂缓' } as const

export function ReviewCandidates({ candidates, target, onLocate, onAdd, decisionsByKey, onDecision }: {
  candidates: PRCandidate[]
  target?: PRCodeLocation
  onLocate: (location: PRCodeLocation) => void
  onAdd: (candidate: PRCandidate) => void
  decisionsByKey?: Record<string, CandidateDecision>
  onDecision?: (key: string, value: CandidateDecision) => void
}) {
  const positions = new Map(candidates.map(item => [`${item.side}:${item.line}`, item] as const))
  const selected = candidates.filter(item => item.line === target?.line && item.side === target.side)
  return <section aria-label="可疑行与修复建议">
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border-soft px-4 py-3">
      <h3 className="mr-1 text-xs font-medium text-foreground-2">{positions.size} 处规则命中</h3>
      {[...positions.values()].map(item => <Button key={`${item.side}:${item.line}`} size="xs" type="button" variant="ghost"
        className="aria-pressed:bg-amber-soft aria-pressed:text-amber-deep"
        aria-label={`定位${codeSideLabels[item.side]}第 ${item.line} 行`}
        aria-pressed={item.line === target?.line && item.side === target.side}
        onClick={() => onLocate(item)}>{item.line} 行</Button>)}
    </div>
    {!selected.length ? <p className="px-4 py-3 text-sm text-foreground-3">选择行号查看修复建议</p> : null}
    {selected.map(item => <CandidateDetail key={candidateKey(item)} item={item} onAdd={onAdd}
      decision={decisionsByKey?.[candidateKey(item)]} onDecision={onDecision}/>)}
  </section>
}

function CandidateDetail({ item, onAdd, decision, onDecision }: {
  item: PRCandidate
  onAdd: (candidate: PRCandidate) => void
  decision?: CandidateDecision
  onDecision?: (key: string, value: CandidateDecision) => void
}) {
  const reason = decision?.reason ?? ''
  return <article className="grid gap-3 px-4 py-4 text-xs leading-relaxed [&+article]:border-t [&+article]:border-border-soft">
    <p className="text-sm font-medium text-foreground">{item.message}</p>
    {item.evidence ? <code className="block overflow-auto rounded-md border border-border-soft bg-card p-2 font-mono">{item.evidence}</code> : null}
    {item.suggestion ? <div className="grid gap-2">
      <h4 className="text-sm font-semibold text-foreground">{item.suggestion.title}</h4>
      {item.suggestion.rationale !== item.message ? <p className="text-foreground-3">{item.suggestion.rationale}</p> : null}
      <Button size="sm" className="justify-self-start" type="button" onClick={() => onAdd(item)}>加入问题草稿</Button>
      {item.suggestion.example ? <div className="grid gap-1">
        <p className="text-foreground-3">{item.ruleId === 'py-mutable-default' ? '列表参数示例' : '写法示例'}</p>
        <pre className="whitespace-pre-wrap break-words rounded-md border border-border-soft bg-card p-2.5 font-mono">{item.suggestion.example.after}</pre>
      </div> : null}
      {item.suggestion.manualChecks.length ? <ul className="list-disc pl-4 text-foreground-3">
        {item.suggestion.manualChecks.map(check => <li key={check}>{check}</li>)}
      </ul> : null}
    </div> : <Button size="sm" className="justify-self-start" type="button" onClick={() => onAdd(item)}>加入问题草稿</Button>}
    {onDecision ? <div className="flex flex-wrap items-center gap-2">
      <Input className="h-8 min-w-28 flex-1" aria-label="候选处理理由" placeholder="驳回或暂缓时填写理由"
        value={reason} onChange={event => onDecision(candidateKey(item), { status: decision?.status ?? 'deferred', reason: event.target.value })}/>
      {(Object.keys(decisions) as (keyof typeof decisions)[]).map(status => <Button key={status} size="sm" type="button"
        variant={decision?.status === status ? 'secondary' : 'outline'} aria-pressed={decision?.status === status}
        disabled={status !== 'confirmed' && !reason.trim()}
        onClick={() => onDecision(candidateKey(item), { status, reason })}>{decisions[status]}</Button>)}
    </div> : null}
  </article>
}
