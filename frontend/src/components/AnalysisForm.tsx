/**
 * 发起一次分析：项目页里唯一会创建分析记录的入口。
 *
 * 只负责表单与请求，成功后把作业交回给页面；记录列表与「当前结果」由页面刷新，
 * 这样同一个表单既能用于首次分析，也能用于换了设置再分析一次。
 *
 * 分析选项默认收起，收起时用参数摘要说明这次会用哪些设置。
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
  const [open, setOpen] = useState(false)
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

  const summary = [
    branch ? `分支 ${branch}` : defaultBranch ? `分支默认 ${defaultBranch}` : '默认分支',
    since || until ? `${since || '不限'} 至 ${until || '不限'}` : '最近 90 天',
    `最多 ${commitLimit || '500'} 条`,
    STRATEGY_LABELS[strategy],
  ]

  return <form className="analysis-form" onSubmit={submit}>
    <div className="analysis-card" data-open={open}>
      <button
        type="button"
        className="analysis-disclosure-toggle"
        aria-expanded={open}
        aria-controls="analysis-fields"
        onClick={() => setOpen(value => !value)}
      >
        <span className="analysis-disclosure-title"><Icon name="sliders"/>分析选项</span>
        <span className="analysis-disclosure-chips">{summary.map(item => <span key={item}>{item}</span>)}</span>
        <span className="analysis-disclosure-chevron" aria-hidden><Icon name="chevron"/></span>
      </button>
      <div className="analysis-disclosure-body" id="analysis-fields" hidden={!open}>
        <fieldset className="analysis-options" aria-label="分析选项">
          <p className="analysis-options-hint">不填就按默认：默认分支、最近 90 天、最多 500 个提交、自动选择模型策略。</p>
          <div className="form-grid">
            <label>分支<input aria-label="分支" placeholder={defaultBranch ? `默认：${defaultBranch}` : '默认分支'} value={branch} onChange={event => setBranch(event.target.value)}/></label>
            <label>提交上限<input aria-label="提交上限" type="number" min="1" max="5000" value={commitLimit} onChange={event => setCommitLimit(event.target.value)}/></label>
            <label>起始日期<input aria-label="起始日期" type="date" value={since} onChange={event => setSince(event.target.value)}/></label>
            <label>结束日期<input aria-label="结束日期" type="date" value={until} onChange={event => setUntil(event.target.value)}/></label>
            <label className="wide-field">模型策略<select aria-label="模型策略" value={strategy} onChange={event => setStrategy(event.target.value as SyncStrategy)}>{STRATEGIES.map(value => <option key={value} value={value}>{STRATEGY_LABELS[value]}</option>)}</select></label>
          </div>
        </fieldset>
      </div>
      {error ? <div className="analysis-form-error"><FailureNotice error={error}/></div> : null}
      <div className="form-submit">
        <p>{since || until ? '按所选日期范围分析' : '默认分析最近 90 天'}，最多 {commitLimit || '500'} 个提交。发起后会新增一条记录，当前结果不会被覆盖。</p>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? '正在发起…' : '开始分析'}<Icon name="arrow"/></button>
      </div>
    </div>
  </form>
}
