import { useEffect, useState } from 'react'
import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/Feedback'
import { CardListSkeleton } from '@/components/shared/Skeletons'
import { ApiError } from '@/lib/apiContract'
import { userDatasets, type UserDataset } from '@/features/account/userClient'
import { DatasetCurationDialog } from '@/features/datasets/components/DatasetCurationDialog'
import { numberText, numeric } from '@/features/datasets/mydata/format'
import type { Route } from '@/app/navigation'

/** 独立的清洗页：选版本、配规则、看逐步结果、生成新版本，再交给训练或预测。 */
export function CurationPage({ version, navigate, onLoginRequired }: {
  version?: string
  navigate: (route: Route) => void
  onLoginRequired: () => void
}) {
  const [datasets, setDatasets] = useState<UserDataset[] | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [derived, setDerived] = useState<{ version: string; source: string } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    userDatasets('usable', controller.signal)
      .then(({ datasets: value }) => { if (!controller.signal.aborted) setDatasets(value) })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
        else setError(failure instanceof Error ? failure.message : '数据版本读取失败')
      })
    return () => controller.abort()
  }, [attempt, onLoginRequired])

  const seed = datasets?.find(item => item.version === version) ?? null

  return <section className="mx-auto grid w-full max-w-[68rem] min-w-0 gap-4">
    <WorkspacePageHeader title="清洗与预处理" meta={datasets ? `可清洗 ${datasets.length} 个版本` : undefined}
      actions={<Button variant="ghost" onClick={() => navigate({ name: 'my-data' })} type="button">返回我的数据</Button>}/>

    {error ? <EmptyState title="数据版本读取失败" description={error}>
      <Button variant="outline" onClick={() => setAttempt(value => value + 1)} type="button">重新读取</Button>
    </EmptyState> : null}

    {!datasets && !error ? <section className="grid gap-4" aria-label="清洗页"><CardListSkeleton label="正在读取可清洗的数据版本" rows={2}/></section> : null}

    {datasets && datasets.length === 0 ? <EmptyState title="还没有可清洗的数据版本" description="先导入或构建一个数据版本，再回到这里清洗。">
      <Button variant="default" onClick={() => navigate({ name: 'my-data' })} type="button">打开我的数据</Button>
    </EmptyState> : null}

    {datasets && datasets.length > 0 && derived ? <section className="grid gap-3 rounded-xl border border-border-soft bg-card p-5" aria-label="清洗完成">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold text-foreground">已生成新版本</h2>
        <p className="break-all font-mono text-xs text-foreground-3">{derived.version}</p>
        <p className="text-xs text-foreground-3">来源 {derived.source}，原版本仍保留在「我的数据」。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => navigate({ name: 'my-data', datasetVersion: derived.version })}>查看新版本</Button>
        <Button type="button" variant="outline" onClick={() => navigate({ name: 'my-training', datasetVersion: derived.version })}>去训练</Button>
        <Button type="button" variant="outline" onClick={() => navigate({ name: 'my-predictions', datasetVersion: derived.version })}>去预测</Button>
        <Button type="button" variant="ghost" onClick={() => { setDerived(null); setAttempt(value => value + 1) }}>继续清洗</Button>
      </div>
    </section> : null}

    {datasets && datasets.length > 0 && !derived ? <>
      <p className="text-xs leading-body text-foreground-3">
        {numberText(datasets.reduce((sum, item) => sum + (numeric(item.quality.includedRows) ?? 0), 0))} 行可清洗；操作按顺序执行，修改规则后需要重新预览，确认后生成不可变的新版本。
      </p>
      <DatasetCurationDialog inline open dataset={seed} datasets={datasets} onOpenChange={() => {}}
        onDerived={value => setDerived({ version: value, source: seed?.version ?? datasets[0]?.version ?? '' })}
        onLoginRequired={onLoginRequired}/>
    </> : null}
  </section>
}
