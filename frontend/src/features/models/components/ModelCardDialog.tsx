import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useEffect, useState } from 'react'
import { fetchModelCard, type ModelCard } from '@/features/models/modelCardClient'
import { FailureNotice, LoadingNotice } from '@/components/shared/Feedback'


import { ModelCardView } from '@/features/models/components/ModelCardView'

export function ModelCardDialog({ modelId, open, onOpenChange }: {
  modelId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [card, setCard] = useState<ModelCard | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!open || !modelId) return
    const controller = new AbortController()
    setCard(null)
    setError(null)
    fetchModelCard(modelId, controller.signal)
      .then(value => { if (!controller.signal.aborted) setCard(value) })
      .catch(failure => { if (!controller.signal.aborted) setError(failure) })
    return () => controller.abort()
  }, [modelId, open, revision])
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${760}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{"模型详情"}</DialogTitle></DialogHeader>{error ? <FailureNotice error={error} onRetry={() => setRevision(value => value + 1)}/> : card
      ? <ModelCardView card={card} retry={() => setRevision(value => value + 1)}/>
      : <LoadingNotice label="正在校验模型与读取诊断"/>}<DialogFooter>{<Button onClick={() => onOpenChange(false)} variant="outline" type="button">关闭</Button>}</DialogFooter></DialogContent></Dialog>
}
