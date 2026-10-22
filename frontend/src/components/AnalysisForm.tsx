/**
 * 发起一次分析：项目页里唯一会创建分析记录的入口。
 *
 * 只负责表单与请求，成功后把作业交回给页面；记录列表与「当前结果」由页面刷新，
 * 这样同一个表单既能用于首次分析，也能用于换了设置再分析一次。
 */
import { useRef, useState, type FormEvent } from 'react'
import { createRepositorySync } from '../apiClient'
import { FailureNotice } from '../Feedback'
import { Icon } from '../Icon'
import { STRATEGY_LABELS, type SyncStrategy, type SyncView } from '../repositoryContract'

const STRATEGIES: SyncStrategy[] = ['auto', 'generic-model', 'force-train']

export interface AnalysisFormProps {
  repositoryUrl: string
  /** 系统已知的分支，用作输入框占位。 */
  defaultBranch?: string | null
  onStarted: (job: SyncView) => void
}

export function AnalysisForm({ repositoryUrl, defaultBranch, onStarted }: AnalysisFormProps) {
  const [branch, setBranch] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [commitLimit, setCommitLimit] = useState('500')
  const [strategy, setStrategy] = useState<SyncStrategy>('auto')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [error, setError] = useState<unknown>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      const job = await createRepositorySync({
        repositoryUrl,
        branch,
        since,
        until,
        commitLimit,
        strategy,
      })
      onStarted(job)
    } catch (failure) {
      setError(failure)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  return <form className="repository-form analysis-form" onSubmit={submit}>
    <details className="advanced-options">
      <summary><Icon name="sliders" size={16}/>分析选项 <span>分支、范围与模型策略</span></summary>
      <div className="form-grid">
        <label>分支<input aria-label="分支" placeholder={defaultBranch ? `默认：${defaultBranch}` : '默认分支'} value={branch} onChange={event => setBranch(event.target.value)}/></label>
        <label>提交上限<input aria-label="提交上限" type="number" min="1" max="5000" value={commitLimit} onChange={event => setCommitLimit(event.target.value)}/></label>
        <label>起始日期<input aria-label="起始日期" type="date" value={since} onChange={event => setSince(event.target.value)}/></label>
        <label>结束日期<input aria-label="结束日期" type="date" value={until} onChange={event => setUntil(event.target.value)}/></label>
        <label className="wide-field">模型策略<select aria-label="模型策略" value={strategy} onChange={event => setStrategy(event.target.value as SyncStrategy)}>{STRATEGIES.map(value => <option key={value} value={value}>{STRATEGY_LABELS[value]}</option>)}</select></label>
      </div>
    </details>
    {error ? <FailureNotice error={error}/> : null}
    <div className="form-submit">
      <p>{since || until ? '按所选日期范围分析' : '默认分析最近 90 天'}，最多 {commitLimit || '500'} 个提交。</p>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? '正在发起…' : '开始分析'}<Icon name="arrow"/></button>
    </div>
  </form>
}
