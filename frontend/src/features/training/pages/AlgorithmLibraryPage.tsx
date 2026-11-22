import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LoadingNotice } from '@/components/shared/Feedback'
import { ApiError } from '@/lib/apiContract'
import { cn } from '@/lib/utils'
import {
  BookOpenText, Boxes, CheckCircle2, Cpu, RefreshCw, ShieldCheck, TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { trainingMethods, type MethodChoice } from '@/features/models/modelClient'
import { AlgorithmDiagram } from '@/features/training/components/AlgorithmDiagram'

const CATEGORY_LABELS: Record<string, string> = { classic: '经典模型', deep: '深度模型' }
const PREPROCESS_LABELS: Record<string, string> = { scale: '特征标准化' }
const EXPLANATION_LABELS: Record<string, string> = { 'occlusion-mean-v1': '遮挡式均值归因' }

function valueText(values: string[], labels: Record<string, string>, empty: string): string {
  if (!values.length) return empty
  return values.map(value => labels[value] ?? value).join('、')
}

function MethodListItem({ method, selected, onSelect }: {
  method: MethodChoice
  selected: boolean
  onSelect: () => void
}) {
  return <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined}
    className={cn('grid min-w-0 gap-1 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      selected ? 'border-accent/35 bg-accent-soft' : 'border-transparent hover:bg-sunken')}>
    <span className="flex min-w-0 items-start justify-between gap-2">
      <strong className="min-w-0 text-sm font-medium text-foreground">{method.name}</strong>
      <span className={cn('shrink-0 rounded-sm px-1.5 py-0.5 text-[10px]', method.available ? 'bg-teal-soft text-teal-deep' : 'bg-amber-soft text-amber-deep')}>
        {method.available ? '可训练' : '不可用'}
      </span>
    </span>
    <span className="truncate text-[11px] text-foreground-3">{method.guide.summary}</span>
  </button>
}

export function AlgorithmLibraryPage({ onLoginRequired }: { onLoginRequired: () => void }) {
  const [methods, setMethods] = useState<MethodChoice[] | null>(null)
  const [schema, setSchema] = useState('')
  const [category, setCategory] = useState<'all' | 'classic' | 'deep'>('all')
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    trainingMethods(undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setMethods(result.methods)
      setSchema(result.schema)
      setSelected(current => result.methods.some(item => item.method === current)
        ? current : result.methods[0]?.method ?? '')
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '算法目录读取失败')
    })
    return () => controller.abort()
  }, [onLoginRequired, reload])

  const visible = useMemo(() => (methods ?? []).filter(method => category === 'all' || method.category === category),
    [category, methods])
  const selectedMethod = visible.find(method => method.method === selected) ?? visible[0] ?? null
  const counts = useMemo(() => ({
    all: methods?.length ?? 0,
    classic: methods?.filter(method => method.category === 'classic').length ?? 0,
    deep: methods?.filter(method => method.category === 'deep').length ?? 0,
  }), [methods])

  if (methods === null && !error) return <LoadingNotice label="正在读取算法库"/>

  return <section className="flex min-h-0 flex-col gap-5 lg:h-[calc(100dvh-8.25rem)] lg:overflow-hidden">
    <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-border-soft pb-4">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight text-foreground">
          <BookOpenText aria-hidden="true" size={22}/>算法库
        </h1>
        <p className="mt-1 text-xs text-foreground-3">按训练方法查看结构、适用边界与参数。</p>
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] text-foreground-3">
        <span className="rounded-md bg-sunken px-2 py-1 font-mono">{schema || '特征 schema'}</span>
        <span className="rounded-md bg-sunken px-2 py-1">{counts.all} 个方法</span>
      </div>
    </header>

    {error ? <div className="flex shrink-0 flex-wrap items-center gap-2 border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep">
      <p role="alert">{error}</p>
      <Button type="button" size="sm" variant="outline" onClick={() => {
        setMethods(null)
        setError('')
        setReload(value => value + 1)
      }}><RefreshCw aria-hidden="true"/>重试</Button>
    </div> : null}

    <div className="grid min-w-0 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-stretch xl:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-soft bg-card lg:h-full">
        <div className="border-b border-border-soft p-3">
          <ToggleGroup type="single" value={category} aria-label="算法分类"
            onValueChange={value => { if (value) setCategory(value as typeof category) }}>
            <ToggleGroupItem value="all" size="sm">全部 {counts.all}</ToggleGroupItem>
            <ToggleGroupItem value="classic" size="sm">经典 {counts.classic}</ToggleGroupItem>
            <ToggleGroupItem value="deep" size="sm">深度 {counts.deep}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="grid max-h-[460px] min-h-0 flex-1 content-start auto-rows-max gap-1 overflow-y-auto p-2 lg:max-h-none">
          {visible.length ? visible.map(method => <MethodListItem key={method.method} method={method}
            selected={selectedMethod?.method === method.method}
            onSelect={() => setSelected(method.method)}/>) : <p className="px-3 py-5 text-center text-xs text-foreground-3">该分类没有方法。</p>}
        </div>
      </aside>

      {selectedMethod ? <article className="grid min-w-0 content-start gap-4 rounded-lg border border-border-soft bg-card p-4 sm:p-5 lg:h-full lg:overflow-y-auto lg:overscroll-contain">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[10px] font-medium uppercase tracking-[.12em] text-foreground-4">{CATEGORY_LABELS[selectedMethod.category] ?? selectedMethod.category}</span>
            <h2 className="mt-1 text-xl font-semibold text-foreground">{selectedMethod.name}</h2>
            <p className="mt-1 max-w-[720px] text-sm leading-6 text-foreground-3">{selectedMethod.guide.summary}</p>
          </div>
          <span className={cn('shrink-0 rounded-md px-2.5 py-1 text-[11px]', selectedMethod.available ? 'bg-teal-soft text-teal-deep' : 'bg-amber-soft text-amber-deep')}>
            {selectedMethod.available ? '当前可训练' : selectedMethod.reason ?? '当前不可用'}
          </span>
        </div>

        <section className="grid gap-2" aria-labelledby="algorithm-structure">
          <h3 id="algorithm-structure" className="text-xs font-medium text-foreground-2">算法结构</h3>
          <AlgorithmDiagram methodName={selectedMethod.name} visual={selectedMethod.guide.visual}/>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="grid content-start gap-2 border-t border-border-soft pt-3">
            <h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground-2"><CheckCircle2 aria-hidden="true" className="text-teal-deep" size={14}/>适合</h3>
            <ul className="grid gap-1.5 text-xs leading-5 text-foreground-3">
              {selectedMethod.guide.strengths.map(item => <li key={item}>{item}</li>)}
            </ul>
          </section>
          <section className="grid content-start gap-2 border-t border-border-soft pt-3">
            <h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground-2"><TriangleAlert aria-hidden="true" className="text-amber-deep" size={14}/>代价</h3>
            <ul className="grid gap-1.5 text-xs leading-5 text-foreground-3">
              {selectedMethod.guide.tradeoffs.map(item => <li key={item}>{item}</li>)}
            </ul>
          </section>
        </div>

        <section className="grid gap-2 border-t border-border-soft pt-3">
          <h3 className="text-xs font-medium text-foreground-2">使用边界</h3>
          <p className="text-xs leading-5 text-foreground-3">{selectedMethod.guide.whenToUse}</p>
        </section>

        <section className="grid gap-2 border-t border-border-soft pt-3" aria-labelledby="algorithm-runtime">
          <h3 id="algorithm-runtime" className="text-xs font-medium text-foreground-2">运行口径</h3>
          <dl className="grid gap-1 text-xs [&>div]:grid [&>div]:grid-cols-[92px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1.5 [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-words [&_dd]:text-foreground-2">
            <div><dt>依赖</dt><dd>{selectedMethod.requires.length ? selectedMethod.requires.join('、') : '无额外依赖'}</dd></div>
            <div><dt>预处理</dt><dd>{valueText(selectedMethod.preprocess, PREPROCESS_LABELS, '按 schema 计数变换')}</dd></div>
            <div><dt>解释</dt><dd>{selectedMethod.explanation?.reason ?? (selectedMethod.explanation?.method ? EXPLANATION_LABELS[selectedMethod.explanation.method] ?? selectedMethod.explanation.method : '未声明')}</dd></div>
            <div><dt>冻结声明</dt><dd className="font-mono text-[10px] leading-4">{selectedMethod.detail || '未提供'}</dd></div>
          </dl>
        </section>

        <section className="grid gap-2 border-t border-border-soft pt-3" aria-labelledby="algorithm-parameters">
          <div className="flex items-center justify-between gap-2">
            <h3 id="algorithm-parameters" className="text-xs font-medium text-foreground-2">可配置参数</h3>
            <span className="text-[10px] text-foreground-4">{selectedMethod.params.length ? `${selectedMethod.params.length} 项` : '使用冻结声明'}</span>
          </div>
          {selectedMethod.params.length ? <div className="grid gap-2 sm:grid-cols-2">
            {selectedMethod.params.map(param => <div key={param.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border border-border-soft px-3 py-2">
              <div className="min-w-0">
                <strong className="block text-xs font-medium text-foreground-2">{param.label} <code className="font-mono text-[10px] text-foreground-4">{param.name}</code></strong>
                <p className="mt-0.5 text-[11px] leading-4 text-foreground-4">{param.description}</p>
              </div>
              <div className="text-right font-mono text-[10px] text-foreground-3">
                <span>{param.default ?? '—'}</span>
                <span className="mt-0.5 block text-foreground-4">{param.min}–{param.max}</span>
              </div>
            </div>)}
          </div> : <p className="text-xs text-foreground-3">当前不开放自定义参数，训练使用方法冻结声明。</p>}
        </section>

        <div className="flex flex-wrap gap-3 border-t border-border-soft pt-3 text-[11px] text-foreground-4">
          <span className="inline-flex items-center gap-1"><Boxes aria-hidden="true" size={12}/>{selectedMethod.category === 'deep' ? '神经网络结构' : '经典表格模型'}</span>
          <span className="inline-flex items-center gap-1"><Cpu aria-hidden="true" size={12}/>{selectedMethod.requires.length ? '需要额外运行依赖' : '当前环境可直接运行'}</span>
          <span className="inline-flex items-center gap-1"><ShieldCheck aria-hidden="true" size={12}/>图示不代表已验证性能</span>
        </div>
      </article> : null}
    </div>
  </section>
}
