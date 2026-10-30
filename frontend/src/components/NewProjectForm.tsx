import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button, Input } from '../ui/controls'
import { FailureNotice } from '../Feedback'
import type { Route } from '../navigation'
import { createRepository } from '../projectClient'

interface NewProjectValues { url: string }

/** 新建项目的表单本体：放在对话框里，避免为一个字段单开一整页。 */
export function NewProjectForm({ navigate, onCancel }: { navigate: (route: Route, replace?: boolean) => void; onCancel?: () => void }) {
  const [error, setError] = useState<unknown>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<NewProjectValues>({ defaultValues: { url: '' } })

  const submit = handleSubmit(async values => {
    setError(null)
    try {
      const result = await createRepository(values.url.trim())
      navigate({ name: 'repository', repositoryId: result.repository.repositoryId }, true)
    } catch (failure) {
      setError(failure)
    }
  })

  return <form className="new-project-form" onSubmit={submit}>
    <label>仓库地址<Input
      aria-label="仓库地址"
      autoComplete="off"
      placeholder="https://github.com/owner/repository"
      {...register('url', { validate: value => /^https?:\/\//i.test(value.trim()) || '请填写公开仓库的 HTTP(S) 地址，例如 https://github.com/owner/repository。' })}
    /></label>
    <p className="form-hint">支持公开 HTTP(S) Git 仓库，同一地址只建立一个项目。建立后自动准备首次分析，之后可在项目页调整跟踪分支、模型与更新频率。</p>
    {errors.url ? <p className="field-error" role="alert">{errors.url.message}</p> : null}
    {error ? <FailureNotice error={error}/> : null}
    <div className="form-actions">
      {onCancel ? <Button type="button" onClick={onCancel}>取消</Button> : null}
      <Button type="submit" variant="primary" loading={isSubmitting}>{isSubmitting ? '正在建立…' : '建立项目'}</Button>
    </div>
  </form>
}
