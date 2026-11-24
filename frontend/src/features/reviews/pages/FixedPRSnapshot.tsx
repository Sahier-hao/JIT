import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NativeSelect } from '@/components/ui/native-select'
import { repositoryRoute } from '@/app/navigation'
import { ReviewCode } from '@/features/reviews/components/ReviewCode'
import { LoadingNotice } from '@/components/shared/Feedback'
import { PRModelClues } from '@/features/reviews/components/PRModelClues'
import { useSnapshotAnalyses } from '@/features/projects/useSnapshotAnalyses'
import { displayTime } from '@/lib/domain'
import { getPRSnapshot, type PRCandidate, type PRSnapshot } from '@/features/reviews/prReviewClient'
import { addCandidateToRound, openReviewVersion, readWorks, saveWork, workKey } from '@/features/reviews/prReview'
import { requireAccount, useReviewAccount } from '@/features/reviews/reviewAccount'
import { usePRCandidateChecks } from '@/features/reviews/usePRCandidateChecks'
import { message, validateProjectSource, type Navigate } from '@/features/reviews/pages/reviewShared'

/** 提醒只读打开固定快照，进入工作必须由用户明确执行。 */
export function FixedPRSnapshot({ owner, repositoryName, number, repositoryId, snapshotId, navigate }: { owner: string; repositoryName: string; number: number; repositoryId?: string; snapshotId: string; navigate: Navigate }) {
  const reviewAccount = useReviewAccount()
  const account = reviewAccount.account
  const [source, setSource] = useState<PRSnapshot | null>(null), [error, setError] = useState<unknown>(null), [attempt, setAttempt] = useState(0), [fileIndex, setFileIndex] = useState(0)
  const [diffView, setDiffView] = useState<'unified' | 'split'>('unified')
  const analysis = useSnapshotAnalyses(snapshotId)
  const checks = usePRCandidateChecks(source?.snapshotId ?? '')
  const [personal] = useState(() => { try { return { works: account ? readWorks(account) : [], error: '' } } catch (failure) { return { works: [], error: message(failure) } } })
  const existing = personal.works.find(w => w.key === workKey(owner, repositoryName, number))
  useEffect(() => {
    const controller = new AbortController()
    setSource(null); setError(null)
    getPRSnapshot(snapshotId, controller.signal).then(value => { if (controller.signal.aborted) return; validateProjectSource(value, owner, repositoryName, number, repositoryId); setSource(value) }).catch(failure => { if (!controller.signal.aborted) setError(failure) })
    return () => controller.abort()
  }, [snapshotId, owner, repositoryName, number, repositoryId, attempt])
  function enter(candidate?: PRCandidate) {
    if (!source) return
    try {
      const account = requireAccount(reviewAccount)
      const current = readWorks(account).find(w => w.key === workKey(owner, repositoryName, number))
      const next = openReviewVersion(current, source)
      if (candidate) next.rounds = { ...next.rounds, [snapshotId]: addCandidateToRound(next.rounds[snapshotId], candidate) }
      saveWork(account, next)
      navigate({ name: 'pr-work', repositoryId: repositoryId ?? source.repositoryId, owner, repositoryName, number })
    } catch (failure) { setError(failure) }
  }
  const file = source?.files[fileIndex]
  return <section className="grid gap-4 pr-fixed-preview" data-testid="pr-fixed-preview">
    <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => navigate(repositoryId ? repositoryRoute(repositoryId, 'prs') : { name: 'notifications' })} type="button">{<ArrowLeft aria-hidden="true" focusable="false" strokeWidth={1.5} />}返回{repositoryId ? '项目 PR' : '站内提醒'}</Button>
    <WorkspacePageHeader title={`固定快照 · PR #${number}`} meta={`${owner}/${repositoryName} · 版本 ${snapshotId}`}/>
    <div className="grid gap-1 rounded-sm border border-amber/30 bg-amber-soft p-3 text-xs text-amber-deep">
      <strong className="text-sm">固定来源只读预览</strong>
      <p>开始审查或加入问题草稿后，进入此版本的个人工作单。</p>
      {existing ? <p>本浏览器原阅读轮次 {existing.viewedSnapshotId.slice(0, 12)}；最近已知轮次 {existing.latestSnapshotId.slice(0, 12)}。</p> : null}
    </div>
    {personal.error ? <p className="text-xs text-rose" role="alert">{personal.error}；现有存储未清空。</p> : null}
    {error ? <Alert variant="destructive"><AlertTitle>{message(error)}</AlertTitle><div className="col-start-2 flex flex-wrap gap-2">{<Button size="sm" onClick={() => setAttempt(v => v + 1)} variant="outline" type="button">重新读取</Button>}</div></Alert> : null}
    {!source && !error ? <LoadingNotice label="读取提醒绑定的固定快照"/> : null}
    {source ? <>
      <h2 className="text-base font-semibold text-foreground">{source.title}</h2>
      <p className="text-xs text-foreground-3">{source.author} · 保存于 {displayTime(source.capturedAt)} · 基准 {source.baseSha.slice(0, 12)} / 目标 {source.headSha.slice(0, 12)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant='default' disabled={Boolean(personal.error)} onClick={() => enter()} type="button">{existing ? existing.rounds[snapshotId] ? '明确进入此保存轮次' : Date.parse(source.capturedAt) < Date.parse(existing.rounds[existing.latestSnapshotId].source.capturedAt) ? '明确进入历史复盘轮次' : '明确开始此版本新一轮' : '开始审查此固定版本'}</Button>
        {existing ? <Button onClick={() => navigate({ name: 'pr-work', repositoryId, owner, repositoryName, number })} variant="outline" type="button">返回原阅读轮次</Button> : null}
        <a className="text-xs text-accent underline-offset-2 hover:underline" href={source.url} target="_blank" rel="noreferrer">核对远端 PR</a>
      </div>
      <PRModelClues analysis={analysis}/>
      <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">预览文件</span><NativeSelect aria-label="固定快照预览文件" value={fileIndex} onChange={e => setFileIndex(Number(e.target.value))}>{source.files.map((f, i) => <option key={f.path} value={i}>{f.path}</option>)}</NativeSelect></label>
      {file ? <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border-soft bg-card xl:h-[clamp(436px,calc(100dvh-280px),790px)]">
        <ReviewCode key={JSON.stringify([snapshotId, file.path])} source={source} file={file} checks={checks}
          view={diffView} onViewChange={setDiffView} onAdd={enter}/>
      </div> : <p className="text-xs text-foreground-3">此版本没有可展示的文件。</p>}
      {!source.filesComplete ? <p className="text-xs text-amber-deep">文件范围未完整加载，已获取 {source.files.length}/{source.totalFiles}；未覆盖不等于没有问题。</p> : null}
    </> : null}
  </section>
}
