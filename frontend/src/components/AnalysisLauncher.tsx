/**
 * 发起分析的入口：窄栏里只留一个主按钮，参数在对话框里改。
 * 表单字段多，内联展开会把项目页拉得很长；摘要和说明都收进对话框。
 */
import { useState } from 'react'
import type { SyncForm } from '../apiClient'
import type { SyncView } from '../repositoryContract'
import { Plus } from 'lucide-react'
import { Button } from '../ui/controls'
import { Dialog } from '../ui/dialog'
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
  return <div className="analysis-launcher">
    <Button variant="primary" size="lg" icon={<Plus size={17} strokeWidth={2.6}/>} onClick={() => setOpen(true)}>发起分析</Button>
    <Dialog
      open={open}
      onOpenChange={next => { if (!next) close() }}
      title="发起分析"
      description="用固定版本的数据重新分析这个仓库。每次发起都会新增一条记录，旧记录保留；分析成功后，新结果会接替当前结果。"
      width={600}
    >
      <AnalysisForm
        key={initial ? JSON.stringify(initial) : 'new'}
        repositoryUrl={repositoryUrl}
        defaultBranch={defaultBranch}
        initial={initial}
        onCancel={close}
        onStarted={job => { close(); onStarted(job) }}
      />
    </Dialog>
  </div>
}
