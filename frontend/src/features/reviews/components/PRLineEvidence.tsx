import { Button } from '@/components/ui/button'
import { LineEvidencePanel } from '@/features/research/components/LineEvidencePanel'
import {
  requestPRLineEvidence,
  type LineEvidenceContext,
  type LineReviewEvidence,
} from '@/features/research/lineEvidence'
import type { PRFile, PRSnapshot } from '@/features/reviews/prReviewClient'
import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

type State = {
  key: string
  loading: boolean
  value?: LineReviewEvidence
  error?: string
}

export function PRLineEvidence({ source, file, onLocate }: {
  source: PRSnapshot
  file: PRFile
  onLocate?: (line: number) => void
}) {
  const key = `${source.snapshotId}:${source.headSha}:${file.path}`
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<State>({ key: '', loading: true })
  useEffect(() => {
    const controller = new AbortController()
    const context: LineEvidenceContext = {
      sourceKind: 'pr-snapshot',
      resourceId: source.snapshotId,
      repositoryId: source.repositoryId,
      commitId: source.headSha,
      path: file.path,
      side: 'head',
    }
    setState({ key, loading: true })
    requestPRLineEvidence(context, controller.signal).then(value => {
      if (!controller.signal.aborted) setState({ key, loading: false, value })
    }).catch(failure => {
      if (!controller.signal.aborted) setState({
        key,
        loading: false,
        error: failure instanceof Error ? failure.message : '行级研究证据读取失败',
      })
    })
    return () => controller.abort()
  }, [attempt, file.path, key, source.headSha, source.repositoryId, source.snapshotId])
  const current = state.key === key ? state : undefined
  if (!current || current.loading) return <p role="status" className="flex items-center gap-2 p-4 text-xs text-foreground-3">
    <LoaderCircle className="animate-spin" aria-hidden="true" size={14}/>正在读取当前文件的行级研究证据
  </p>
  if (current.error) return <div className="grid justify-items-start gap-2 p-4" role="alert">
    <p className="text-xs text-rose-deep">{current.error}</p>
    <Button type="button" size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}>重新读取</Button>
  </div>
  return <div className="p-4">
    <p className="mb-3 truncate text-xs leading-5 text-foreground-3">
      当前文件：<code className="font-mono text-foreground-2">{file.path}</code>
    </p>
    {current.value ? <LineEvidencePanel result={current.value} onLocate={onLocate}/> : null}
  </div>
}
