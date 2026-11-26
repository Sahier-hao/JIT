import { Button } from '@/components/ui/button'
import { LineEvidencePanel } from '@/features/research/components/LineEvidencePanel'
import {
  requestCommitLineEvidence,
  type LineEvidenceContext,
  type LineReviewEvidence,
} from '@/features/research/lineEvidence'
import { ChevronDown, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

export function CommitLineEvidence({ repositoryId, viewSyncId, commitId, filePaths }: {
  repositoryId: string
  viewSyncId: string
  commitId: string
  filePaths: string[]
}) {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState(filePaths[0] ?? '')
  const [state, setState] = useState<{ key: string; loading: boolean; value?: LineReviewEvidence; error?: string }>({
    key: '',
    loading: false,
  })
  const key = `${viewSyncId}:${commitId}:${path}`
  useEffect(() => {
    if (!open || !path) return
    const context: LineEvidenceContext = {
      sourceKind: 'repository-commit',
      resourceId: repositoryId,
      repositoryId,
      commitId,
      path,
      side: 'head',
    }
    const controller = new AbortController()
    setState({ key, loading: true })
    requestCommitLineEvidence(context, viewSyncId, controller.signal).then(value => {
      if (!controller.signal.aborted) setState({ key, loading: false, value })
    }).catch(failure => {
      if (!controller.signal.aborted) setState({
        key,
        loading: false,
        error: failure instanceof Error ? failure.message : '行级研究证据读取失败',
      })
    })
    return () => controller.abort()
  }, [commitId, key, open, path, repositoryId, viewSyncId])
  const current = state.key === key ? state : undefined
  return <details className="rounded-sm border border-border-soft" open={open}
    onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
      <span>行级研究证据 <span className="text-xs font-normal text-foreground-3">研究预览 · 不参与提交风险</span></span>
      <ChevronDown aria-hidden="true" size={14} className={open ? 'rotate-180' : ''}/>
    </summary>
    <div className="grid gap-3 border-t border-border-soft p-3">
      {filePaths.length === 0 ? <p role="status" className="text-xs text-foreground-3">该提交没有保存可分析的文件路径，无法生成行级证据。</p> : <>
        <label className="grid gap-1 text-xs text-foreground-3">
          <span>文件</span>
          <select className="h-9 min-w-0 rounded-md border border-input bg-card px-2 text-foreground"
            value={path} onChange={event => setPath(event.target.value)}>
            {filePaths.map(file => <option key={file} value={file}>{file}</option>)}
          </select>
        </label>
        {current?.loading ? <p role="status" className="flex items-center gap-2 text-xs text-foreground-3">
          <LoaderCircle className="animate-spin" aria-hidden="true" size={14}/>正在读取固定提交的代码候选
        </p> : current?.error ? <div className="grid justify-items-start gap-2" role="alert">
          <p className="text-xs text-rose-deep">{current.error}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => setState({ key: '', loading: false })}>重新展开重试</Button>
        </div> : current?.value ? <LineEvidencePanel result={current.value}/> : <p className="text-xs text-foreground-3">展开后按真实 patch 和固定提交源码生成候选。</p>}
      </>}
    </div>
  </details>
}
