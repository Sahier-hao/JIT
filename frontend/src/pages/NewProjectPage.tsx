/**
 * 新建项目：只登记仓库地址，不设分析选项。
 *
 * 分析范围、模型策略属于「一次分析」，放在项目页；这里建完就直接进入项目页，
 * 让人看到下一步该做什么。
 */
import { useRef, useState, type FormEvent } from 'react'
import { FailureNotice } from '../Feedback'
import { Icon } from '../Icon'
import type { Route } from '../navigation'
import { createRepository } from '../projectClient'

export function NewProjectPage({ navigate }: { navigate: (route: Route, replace?: boolean) => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [error, setError] = useState<unknown>(null)
  const [hint, setHint] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (locked.current) return
    const value = url.trim()
    if (!/^https?:\/\//i.test(value)) {
      setHint('请填写公开仓库的 HTTP(S) 地址，例如 https://github.com/owner/repository。')
      return
    }
    setHint('')
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await createRepository(value)
      navigate({ name: 'repository', repositoryId: result.repository.repositoryId }, true)
    } catch (failure) {
      setError(failure)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  return <section className="analysis-setup new-project">
    <header className="page-heading">
      <div>
        <h1>新建项目</h1>
        <p className="page-intro">只需要一个仓库地址。分析范围与模型策略在项目页设置。</p>
      </div>
    </header>
    <form className="repository-form" onSubmit={submit}>
      <div className="form-intro"><span className="project-card-icon"><Icon name="project" size={22}/></span><div><h2>从仓库开始</h2><p>支持公开 HTTP(S) Git 仓库地址，同一地址只会建立一个项目。</p></div></div>
      <label className="repository-url-label">仓库地址<input aria-label="仓库地址" autoComplete="off" required placeholder="https://github.com/owner/repository" value={url} onChange={event => setUrl(event.target.value)}/></label>
      <p className="form-hint">私有仓库与本地路径不会被读取；建立项目不会立即开始分析。</p>
      {hint ? <p className="field-error" role="alert">{hint}</p> : null}
      {error ? <FailureNotice error={error}/> : null}
      <div className="form-submit"><p>建立后进入项目页，在那里选择分支、日期范围与模型策略。</p><button className="primary-button" type="submit" disabled={busy}>{busy ? '正在建立…' : '建立项目'}<Icon name="arrow"/></button></div>
    </form>
    <p className="form-back"><button className="text-button" type="button" onClick={() => navigate({ name: 'repositories' })}>返回项目列表</button></p>
  </section>
}
