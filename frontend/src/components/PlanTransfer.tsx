import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { downloadPlan, makePlan, parsePlan, readPlanFile, validatePlan, type PlanSource, type PortablePlan } from '../reviewPlanTransfer'
import './plan-transfer.css'

type State = { key: string; busy?: boolean; preview?: PortablePlan; error?: string; notice?: string }
export function PlanTransfer({ source, ids, onMerge }: { source: PlanSource; ids: string[]; onMerge: (ids: string[]) => string }) {
  const key = JSON.stringify(source), active = useRef(key)
  const merge = useRef(onMerge)
  useLayoutEffect(() => { active.current = key; merge.current = onMerge }, [key, onMerge])
  const controller = useRef<AbortController | null>(null)
  const locked = useRef(false)
  const [state, setState] = useState<State>({ key: '' })
  useEffect(() => { locked.current = false; return () => { controller.current?.abort() } }, [key])
  const current = state.key === key ? state : undefined
  async function perform(action: (signal: AbortSignal) => Promise<Partial<State>>) {
    if (locked.current) return
    locked.current = true
    const task = new AbortController(); controller.current = task
    setState(previous => ({ ...previous, key, busy: true, error: undefined, notice: undefined }))
    try {
      const result = await action(task.signal)
      if (!task.signal.aborted && active.current === key) setState({ key, ...result })
    } catch (error) {
      if (!task.signal.aborted && active.current === key) setState(previous => ({ ...previous, key, busy: false, error: error instanceof Error ? error.message : '计划操作失败，请重试' }))
    } finally { if (active.current === key) locked.current = false }
  }
  function importFile(file: File) {
    setState({ key })
    void perform(async signal => {
      const plan = parsePlan(await readPlanFile(file, signal), source)
      const verified = await validatePlan(plan, signal)
      return { preview: verified }
    })
  }
  function confirm() {
    const preview = current?.preview
    if (!preview) return
    void perform(async signal => {
      const verified = await validatePlan(preview, signal)
      if (signal.aborted || active.current !== key) return {}
      const warning = merge.current(verified.commitIds)
      return warning ? { preview, error: warning } : { notice: '计划已合并，原有条目和加入顺序保留。' }
    })
  }
  const preview = current?.preview
  const existing = preview?.commitIds.filter(id => ids.includes(id)).length ?? 0
  return <details className="plan-transfer"><summary>计划备份与恢复</summary>
    <p className="muted">计划保存在此浏览器。可导出 JSON 备份；恢复只接受同一项目、分析和模型来源，确认后合并，保留已有条目。</p>
    <div className="plan-transfer-actions"><button className="text-button" disabled={Boolean(current?.busy)} onClick={() => void perform(async signal => { const plan = await validatePlan(makePlan(source, ids), signal); if (!signal.aborted && active.current === key) downloadPlan(plan); return { notice: `已生成 ${plan.commitIds.length} 条计划的备份下载。` } })}>导出计划备份</button>
      <label>选择计划备份<input type="file" accept=".json,application/json" disabled={Boolean(current?.busy)} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) importFile(file) }}/></label></div>
    {current?.busy ? <p role="status">正在核对固定分析与提交…</p> : null}
    {current?.error ? <p role="alert" className="warning">{current.error}</p> : null}
    {current?.notice ? <p role="status">{current.notice}</p> : null}
    {preview ? <div className="plan-transfer-preview"><p>备份有 {preview.commitIds.length} 条，已有 {existing} 条，将新增 {preview.commitIds.length-existing} 条。</p><p className="muted">分析 {preview.source.viewSyncId} · 数据 {preview.source.datasetVersion ?? '未记录'}</p><button className="text-button" disabled={Boolean(current?.busy)} onClick={confirm}>合并到当前计划</button><button className="text-button" disabled={Boolean(current?.busy)} onClick={() => setState({ key })}>取消导入</button></div> : null}
  </details>
}
