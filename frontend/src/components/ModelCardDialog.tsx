import { useEffect, useState } from 'react'
import { fetchModelCard, type ModelCard } from '../modelCardClient'
import { FailureNotice, LoadingNotice } from '../Feedback'
import { Button } from '../ui/controls'
import { Dialog } from '../ui/dialog'
import { ModelCardView } from './ModelCardView'

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
  return <Dialog open={open} onOpenChange={onOpenChange} title="模型卡" width={760}
    footer={<Button onClick={() => onOpenChange(false)}>关闭</Button>}>
    {error ? <FailureNotice error={error} onRetry={() => setRevision(value => value + 1)}/> : card
      ? <ModelCardView card={card} retry={() => setRevision(value => value + 1)}/>
      : <LoadingNotice label="正在校验模型与读取诊断"/>}
  </Dialog>
}
