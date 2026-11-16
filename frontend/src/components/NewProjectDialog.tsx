import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { NewProjectForm } from './NewProjectForm'
import type { Route } from '../navigation'

/** 新建项目对话框：与发起分析、删除确认使用同一套 Dialog，不再单独占一页。 */
export function NewProjectDialog({ open, onOpenChange, navigate }: { open: boolean; onOpenChange: (open: boolean) => void; navigate: (route: Route, replace?: boolean) => void }) {
  return <Dialog open={open} onOpenChange={next => { if (!next) onOpenChange(false) }}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${520}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{"新建项目"}</DialogTitle></DialogHeader><NewProjectForm navigate={navigate} onCancel={() => onOpenChange(false)}/></DialogContent></Dialog>
}
