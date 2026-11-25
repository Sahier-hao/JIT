import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ArrowRight, BookOpenText, CheckCircle2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MethodChoice } from '@/features/models/modelClient'

const CATEGORY: Record<string, string> = { classic: '经典模型', deep: '深度模型' }

export function AlgorithmLibraryDialog({ open, onOpenChange, methods, schema, initialMethod }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  methods: MethodChoice[]
  schema: string
  initialMethod?: string
}) {
  const [category, setCategory] = useState<'all' | 'classic' | 'deep'>('all')
  const [focused, setFocused] = useState<string>()

  useEffect(() => {
    if (!open) { setFocused(undefined); return }
    const target = initialMethod ? methods.find(item => item.method === initialMethod) : undefined
    setFocused(target?.method)
    if (target) setCategory(target.category === 'deep' ? 'deep' : target.category === 'classic' ? 'classic' : 'all')
  }, [open, initialMethod, methods])

  const visible = methods
    .filter(item => category === 'all' || item.category === category)
    .sort((a, b) => (a.method === focused ? -1 : b.method === focused ? 1 : 0))
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} className="max-h-[92vh] overflow-y-auto" style={{ width: 'min(96vw, 980px)', maxWidth: 'none' }}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><BookOpenText aria-hidden="true" size={18}/>算法库</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4">
        <section className="grid gap-2 rounded-xl border border-border-soft bg-sunken p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-2">
            {[['特征规范', schema], ['预处理', '按 schema 计数变换 / 按方法标准化'], ['模型', '训练并登记运行'], ['输出', '提交风险分'], ['解释', '遮挡式特征归因']].map(([label, value], index) =>
              <div key={label} className="contents">
                {index ? <ArrowRight aria-hidden="true" className="text-foreground-4" size={14}/> : null}
                <span className="rounded-lg border border-border-soft bg-card px-3 py-2"><b className="block text-[10px] font-medium uppercase tracking-[.1em] text-foreground-4">{label}</b><span className="mt-0.5 block max-w-[190px] break-words font-mono text-[11px] text-foreground-2">{value}</span></span>
              </div>)}
          </div>
          <p className="text-[11px] leading-5 text-foreground-3">算法只改变风险分的学习方式；数据版本、切分、标签口径与解释边界不会随方法静默改变。</p>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 rounded-lg bg-sunken p-1" role="group" aria-label="算法分类">
            {([['all', '全部'], ['classic', '经典'], ['deep', '深度']] as const).map(([id, label]) =>
              <button key={id} type="button" onClick={() => setCategory(id)}
                className={cn('rounded-md px-3 py-1.5 text-xs', category === id ? 'bg-card font-medium text-foreground shadow-sm' : 'text-foreground-3')}>{label}</button>)}
          </div>
          <span className="text-[11px] text-foreground-4">{visible.length} 个方法</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {visible.map(item => <article key={item.method} className={cn('grid gap-3 rounded-xl border border-border-soft p-4', !item.available && 'bg-sunken/60', item.method === focused && 'border-accent/40 bg-accent-soft/30')}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[10px] font-medium uppercase tracking-[.12em] text-foreground-4">{CATEGORY[item.category] ?? item.category}</span>
                <h3 className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                  {item.name}
                  {item.method === focused ? <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10px] font-normal text-accent">本次所选</span> : null}
                </h3>
                <p className="mt-1 text-xs leading-5 text-foreground-3">{item.guide.summary}</p>
              </div>
              <span className={cn('shrink-0 rounded-full px-2 py-1 text-[10px]', item.available ? 'bg-teal-soft text-teal-deep' : 'bg-amber-soft text-amber-deep')}>
                {item.available ? '可用' : item.reason ?? '不可用'}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <span className="text-[10px] font-medium text-foreground-4">适合</span>
                <ul className="mt-1 grid gap-1 text-[11px] leading-4 text-foreground-2">
                  {item.guide.strengths.map(value => <li key={value} className="flex gap-1.5"><CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0 text-teal-deep" size={12}/><span>{value}</span></li>)}
                </ul>
              </div>
              <div>
                <span className="text-[10px] font-medium text-foreground-4">代价</span>
                <ul className="mt-1 grid gap-1 text-[11px] leading-4 text-foreground-2">
                  {item.guide.tradeoffs.map(value => <li key={value} className="flex gap-1.5"><TriangleAlert aria-hidden="true" className="mt-0.5 shrink-0 text-amber-deep" size={12}/><span>{value}</span></li>)}
                </ul>
              </div>
            </div>
            <p className="rounded-lg bg-sunken px-3 py-2 text-[11px] leading-5 text-foreground-3">{item.guide.whenToUse}</p>
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-foreground-2">参数与冻结声明</summary>
              <p className="mt-2 break-words font-mono text-[10px] leading-4 text-foreground-4">{item.detail}</p>
              {item.params.length ? <dl className="mt-2 grid gap-2">
                {item.params.map(param => <div key={param.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border border-border-soft px-2.5 py-2">
                  <div><dt className="text-xs font-medium text-foreground-2">{param.label} <code className="font-mono text-[10px] text-foreground-4">{param.name}</code></dt><dd className="mt-0.5 text-[11px] leading-4 text-foreground-4">{param.description}</dd></div>
                  <dd className="text-right font-mono text-[10px] text-foreground-3">{param.default ?? '—'}<span className="mt-0.5 block text-foreground-4">{param.min}–{param.max}</span></dd>
                </div>)}
              </dl> : <p className="mt-2 text-[11px] text-foreground-4">当前不开放自定义参数，使用冻结声明。</p>}
            </details>
          </article>)}
        </div>
      </div>
      <div className="flex justify-end"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button></div>
    </DialogContent>
  </Dialog>
}
