/**
 * 发起分析的入口：窄栏里只放一段紧凑的参数摘要和一个主按钮，
 * 真正的表单放进对话框——分析选项字段多，内联展开会把项目页拉得很长。
 *
 * 摘要读的是表单写下的同一份草稿，所以它显示的就是「现在点开始分析会用什么参数」，
 * 而不是一组写死的默认值。
 */
import { Button, Modal } from 'antd'
import { useEffect, useState } from 'react'
import type { SyncForm } from '../apiClient'
import { STRATEGY_LABELS, type SyncView } from '../repositoryContract'
import { AnalysisForm } from './AnalysisForm'

export interface AnalysisLauncherProps {
  repositoryUrl: string
  defaultBranch?: string | null
  onStarted: (job: SyncView) => void
  /** 从某条失败记录带过来的原参数；提供时对话框自动打开并预填。 */
  initial?: Partial<SyncForm>
}

export function AnalysisLauncher({ repositoryUrl, defaultBranch, onStarted, initial }: AnalysisLauncherProps) {
  const draftKey = `jit:analysis-draft:${repositoryUrl}`
  const [open, setOpen] = useState(Boolean(initial))
  const [draft, setDraft] = useState<Partial<SyncForm>>(() => initial ?? readDraft(draftKey))
  useEffect(() => { if (initial) setOpen(true) }, [initial])
  const close = () => { setOpen(false); setDraft(readDraft(draftKey)) }
  const range = draft.since || draft.until ? `${draft.since || '不限'} 至 ${draft.until || '不限'}` : '最近 90 天'
  const model = draft.modelId ? '指定模型' : STRATEGY_LABELS[draft.strategy ?? 'auto']
  return <div className="analysis-launcher">
    <dl className="analysis-facts">
      <div><dt>分支</dt><dd>{draft.branch || defaultBranch || '默认分支'}</dd></div>
      <div><dt>时间范围</dt><dd>{range}</dd></div>
      <div><dt>提交上限</dt><dd>{draft.commitLimit || '500'} 条</dd></div>
      <div><dt>模型</dt><dd>{model}</dd></div>
    </dl>
    <Button type="primary" block onClick={() => setOpen(true)}>发起分析</Button>
    <p className="analysis-note">对话框里可以改分支、日期范围与模型，改过的设置会留到下一次。每次发起都会新增一条记录，当前结果不受影响。</p>
    <Modal
      open={open}
      title="发起分析"
      width={600}
      footer={null}
      onCancel={close}
      destroyOnHidden
      className="analysis-dialog"
    >
      <AnalysisForm
        key={initial ? JSON.stringify(initial) : 'new'}
        repositoryUrl={repositoryUrl}
        defaultBranch={defaultBranch}
        initial={initial}
        onCancel={close}
        onStarted={job => { close(); onStarted(job) }}
      />
    </Modal>
  </div>
}

function readDraft(key: string): Partial<SyncForm> {
  try { return JSON.parse(sessionStorage.getItem(key) ?? '{}') as Partial<SyncForm> } catch { return {} }
}
