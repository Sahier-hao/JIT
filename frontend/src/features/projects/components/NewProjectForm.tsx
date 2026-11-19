import { Button } from '@/components/ui/button'
import { LoaderCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

import { FailureNotice } from '@/components/shared/Feedback'
import { repositoryRoute, type Route } from '@/app/navigation'
import { createRepository } from '@/features/projects/projectClient'
import { ProgressBar } from '@/features/projects/components/JobProgress'

interface NewProjectValues { url: string }

/** 新建项目的表单本体：放在对话框里，避免为一个字段单开一整页。 */
export function NewProjectForm({ navigate, onCancel }: { navigate: (route: Route, replace?: boolean) => void; onCancel?: () => void }) {
  const [error, setError] = useState<unknown>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<NewProjectValues>({ defaultValues: { url: '' } })

  const submit = handleSubmit(async values => {
    setError(null)
    try {
      const result = await createRepository(values.url.trim())
      navigate(repositoryRoute(result.repository.repositoryId), true)
    } catch (failure) {
      setError(failure)
    }
  })

  return <form className="grid gap-3" onSubmit={submit}>
    <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">仓库地址</span><Input aria-label="仓库地址" autoComplete="off" placeholder="https://github.com/owner/repository" {...register('url', { validate: value => /^https?:\/\//i.test(value.trim()) || '请填写公开仓库的 HTTP(S) 地址，例如 https://github.com/owner/repository。' })}/></label>
    {errors.url ? <p className="text-xs text-rose" role="alert">{errors.url.message}</p> : null}
    {error ? <FailureNotice error={error}/> : null}
    {isSubmitting ? <ProgressBar value={null} state="queued" label="正在建立项目"/> : null}
    <div className="flex flex-wrap justify-end gap-2">
      {onCancel ? <Button type="button" onClick={onCancel} variant="outline">取消</Button> : null}
      <Button type="submit" variant='default' disabled={Boolean(isSubmitting)}>{isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}{isSubmitting ? '正在建立…' : '建立项目'}</Button>
    </div>
  </form>
}
