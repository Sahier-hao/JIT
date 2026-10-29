/**
 * 新建项目：登记仓库并自动准备首次分析，模型和更新策略可在项目页调整。
 *
 * 分析范围、模型策略属于「一次分析」，放在项目页；这里建完就直接进入项目页，
 * 让人看到下一步该做什么。
 */
import { Button } from 'antd'
import { ArrowRightOutlined } from '@ant-design/icons'
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
        <p className="page-intro">接入仓库后自动准备首次分析，并持续跟进新提交。</p>
      </div>
    </header>
    <form className="repository-form" onSubmit={submit}>
      <div className="form-intro"><span className="project-card-icon"><Icon name="project" size={22}/></span><div><h2>从仓库开始</h2><p>支持公开 HTTP(S) Git 仓库地址，同一地址只会建立一个项目。</p></div></div>
      <label className="repository-url-label">仓库地址<input aria-label="仓库地址" autoComplete="off" required placeholder="https://github.com/owner/repository" value={url} onChange={event => setUrl(event.target.value)}/></label>
      <p className="form-hint">支持公开仓库。首次使用管理员默认模型分析最近 90 天内最多 500 个提交，每 5 分钟检查更新。</p>
      {hint ? <p className="field-error" role="alert">{hint}</p> : null}
      {error ? <FailureNotice error={error}/> : null}
      <div className="form-submit"><p>可在项目页暂停自动更新，或调整跟踪分支与更新模型。</p><Button type="primary" htmlType="submit" aria-label="建立项目" loading={busy}>{busy ? '正在建立…' : '建立项目'}<ArrowRightOutlined/></Button></div>
    </form>
    <p className="form-back"><Button type="link" size="small" onClick={() => navigate({ name: 'repositories' })}>返回项目列表</Button></p>
  </section>
}
