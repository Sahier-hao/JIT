import { Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

import { useState } from 'react'
import type { SyncView } from '@/features/projects/repositoryContract'


import { AnalysisForm, type BranchAnalysisSeed } from '@/features/projects/components/AnalysisForm'

export interface AnalysisLauncherProps {
  repositoryUrl: string
  defaultBranch?: string | null
  onStarted: (job: SyncView) => void
  onClose?: () => void
  /** 从某条失败记录带过来的原参数；提供时对话框自动打开并预填。 */
  initial?: BranchAnalysisSeed
}

export function AnalysisLauncher({ repositoryUrl, defaultBranch, onStarted, onClose, initial }: AnalysisLauncherProps) {
  const [open, setOpen] = useState(Boolean(initial))
  const close = () => {
    setOpen(false)
    if (initial) onClose?.()
  }
  return <div>
    <Button variant="default" size="sm" onClick={() => setOpen(true)} type="button"><Plus aria-hidden="true" focusable="false" size={15}/>分析分支提交</Button>
    <Dialog open={open} onOpenChange={next => { if (!next) close() }}><DialogContent className="max-h-[90vh] overflow-auto sm:max-w-[600px]"><DialogHeader>
      <DialogTitle>分析分支提交</DialogTitle>
      <DialogDescription>用已有模型给分支的历史提交打分。结果会与缺陷引入证据并排显示。</DialogDescription>
    </DialogHeader><AnalysisForm
        key={initial ? JSON.stringify(initial) : 'new'}
        repositoryUrl={repositoryUrl}
        defaultBranch={defaultBranch}
        initial={initial}
        onCancel={close}
        onStarted={job => { close(); onStarted(job) }}
      /></DialogContent></Dialog>
  </div>
}
