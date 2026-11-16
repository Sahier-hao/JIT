import { Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

import { useState } from 'react'
import type { SyncForm } from '../apiClient'
import type { SyncView } from '../repositoryContract'


import { AnalysisForm } from './AnalysisForm'

export interface AnalysisLauncherProps {
  repositoryUrl: string
  defaultBranch?: string | null
  onStarted: (job: SyncView) => void
  /** 从某条失败记录带过来的原参数；提供时对话框自动打开并预填。 */
  initial?: Partial<SyncForm>
}

export function AnalysisLauncher({ repositoryUrl, defaultBranch, onStarted, initial }: AnalysisLauncherProps) {
  const [open, setOpen] = useState(Boolean(initial))
  const close = () => setOpen(false)
  return <div>
    <Button variant='default' size="lg" onClick={() => setOpen(true)} type="button">{<Plus aria-hidden="true" focusable="false"  size={17} strokeWidth={2.6}/>}发起分析</Button>
    <Dialog open={open} onOpenChange={next => { if (!next) close() }}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${600}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{"发起分析"}</DialogTitle></DialogHeader><AnalysisForm
        key={initial ? JSON.stringify(initial) : 'new'}
        repositoryUrl={repositoryUrl}
        defaultBranch={defaultBranch}
        initial={initial}
        onCancel={close}
        onStarted={job => { close(); onStarted(job) }}
      /></DialogContent></Dialog>
  </div>
}
