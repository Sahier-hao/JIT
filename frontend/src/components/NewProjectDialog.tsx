import { Dialog } from '../ui/dialog'
import { NewProjectForm } from './NewProjectForm'
import type { Route } from '../navigation'

/** 新建项目对话框：与发起分析、删除确认使用同一套 Dialog，不再单独占一页。 */
export function NewProjectDialog({ open, onOpenChange, navigate }: { open: boolean; onOpenChange: (open: boolean) => void; navigate: (route: Route, replace?: boolean) => void }) {
  return <Dialog
    open={open}
    onOpenChange={next => { if (!next) onOpenChange(false) }}
    title="新建项目"
    description="接入一个公开仓库，建立后自动准备首次分析。"
    width={520}
  >
    <NewProjectForm navigate={navigate} onCancel={() => onOpenChange(false)}/>
  </Dialog>
}
