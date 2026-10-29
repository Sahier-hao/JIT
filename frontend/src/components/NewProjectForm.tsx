import { useRef, useState, type FormEvent } from 'react'
import { Button, Input } from '../ui/controls'
import { FailureNotice } from '../Feedback'
import type { Route } from '../navigation'
import { createRepository } from '../projectClient'

/** 新建项目的表单本体：放在对话框里，避免为一个字段单开一整页。 */
export function NewProjectForm({ navigate, onCancel }: { navigate: (route: Route, replace?: boolean) => void; onCancel?: () => void }) {
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

  return <form className="new-project-form" onSubmit={submit}>
    <label>仓库地址<Input aria-label="仓库地址" autoComplete="off" required placeholder="https://github.com/owner/repository" value={url} onChange={event => setUrl(event.target.value)}/></label>
    <p className="form-hint">支持公开 HTTP(S) Git 仓库，同一地址只建立一个项目。建立后自动准备首次分析，之后可在项目页调整跟踪分支、模型与更新频率。</p>
    {hint ? <p className="field-error" role="alert">{hint}</p> : null}
    {error ? <FailureNotice error={error}/> : null}
    <div className="form-actions">
      {onCancel ? <Button type="button" onClick={onCancel}>取消</Button> : null}
      <Button type="submit" variant="primary" loading={busy}>{busy ? '正在建立…' : '建立项目'}</Button>
    </div>
  </form>
}
