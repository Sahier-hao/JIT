import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PRCandidate, PRFile, PRSnapshot } from '@/features/reviews/prReviewClient'
import { candidateQuestion, type ReviewRound } from '@/features/reviews/prReview'

/** 代码候选：只作为线索，处理结果与理由写回工作单。 */
export function ReviewCandidates({ source, file, candidates, onError, round, apply, onSelectQuestion }: {
  source: PRSnapshot
  file: PRFile
  candidates: PRCandidate[]
  onError: (value: string) => void
  round: ReviewRound
  apply: (update: (value: ReviewRound) => ReviewRound) => void
  onSelectQuestion: (id: string) => void
}) {
  return <section className="grid max-h-72 gap-2 overflow-auto border-t border-border-soft p-3" aria-label="代码候选">
    <h3 className="text-sm font-semibold text-foreground">代码候选</h3>
    <p className="text-xs text-foreground-3">候选只作线索，不是缺陷概率或行级缺陷结论。</p>
    {candidates.filter(item => item.path === file.path).map((item, index) => {
      const key = `${item.side}:${item.path}:${item.line}:${item.ruleId}:${item.ruleVersion}`
      const decision = round.candidateDecisions?.[key]
      const set = (status: 'confirmed' | 'rejected' | 'deferred') => {
        const reason = decision?.reason ?? ''
        if (status !== 'confirmed' && !reason.trim()) { onError('先填写候选处理理由'); return }
        onError('')
        apply(r => ({ ...r, candidateDecisions: { ...(r.candidateDecisions ?? {}), [key]: { status, reason } } }))
      }
      return <div key={`${key}:${index}`} className="grid gap-1 rounded-sm border border-border-soft p-2 text-xs">
        <code className="font-mono text-foreground-2">{item.path}:{item.line}</code> · {item.ruleId} · {item.message}
        {item.evidence ? <pre className="overflow-auto rounded-sm bg-dark p-2 font-mono text-[11px] text-on-dark">{item.evidence}</pre> : null}
        {item.suggestion ? <div className="grid gap-1 rounded-sm bg-soft p-2">
          <strong className="text-foreground">{item.suggestion.title}</strong>
          <p className="text-foreground-3">{item.suggestion.rationale}</p>
          {item.suggestion.manualChecks.length ? <ul className="list-disc pl-4 text-foreground-3">{item.suggestion.manualChecks.map(check => <li key={check}>{check}</li>)}</ul> : null}
          {item.suggestion.example ? <pre className="overflow-auto rounded-sm bg-dark p-2 font-mono text-[11px] text-on-dark">{`${item.suggestion.example.before}\n→\n${item.suggestion.example.after}`}</pre> : null}
        </div> : null}
        <div className="flex items-center flex-wrap gap-2" style={{gap: 8}}>{(['confirmed', 'rejected', 'deferred'] as const).map(status => <Button key={status} size="sm" variant={decision?.status === status ? 'default' : 'outline'} onClick={() => set(status)} type="button">{status === 'confirmed' ? '确认' : status === 'rejected' ? '驳回' : '暂缓'}</Button>)}<Input className="h-8 flex-1 rounded-sm border border-input bg-card px-2 text-xs text-foreground" aria-label="候选处理理由" value={decision?.reason ?? ''} onChange={event => apply(r => ({ ...r, candidateDecisions: { ...(r.candidateDecisions ?? {}), [key]: { status: decision?.status ?? 'deferred', reason: event.target.value } } }))} placeholder="处理理由"/><Button size="sm" onClick={() => {
          const exists = round.questions.some(question => question.kind === 'suggestion' && question.relatedFiles[0] === item.path && question.body.includes(`${item.ruleId}@${item.ruleVersion}`) && question.body.includes(`${item.path}:${item.line}`))
          if (exists) { onError('该候选建议已在问题草稿中'); return }
          const created = candidateQuestion(source, item)
          apply(r => ({ ...r, questions: [...r.questions, created], selectedQuestionId: created.id }))
          onSelectQuestion(created.id); onError('')
        }} variant="outline" type="button">加入问题草稿</Button></div>
      </div>
    })}
  </section>
}
