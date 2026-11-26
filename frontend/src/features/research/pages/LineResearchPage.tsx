import { Textarea } from '@/components/ui/textarea'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { LoaderCircle, AlertTriangle, ChevronDown } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '@/lib/apiContract'
import type { Route } from '@/app/navigation'
import {
  lineFeatureLabel, lineResearchMetadata, scoreLineResearch,
  type LineResearchMetadata, type LineScoreResult,
} from '@/features/research/lineResearch'


import { EntryHeader, EntryPage } from '@/components/layout/EntryChrome'

const LANGUAGE_LABELS: Record<string, string> = { typescript: 'TypeScript', javascript: 'JavaScript' }

function number(value: number | null, digits = 3): string {
  return value === null ? '—' : value.toFixed(digits)
}

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

function count(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('zh-CN')
}

function signed(value: number | null): string {
  if (value === null) return '—'
  const normalized = Math.abs(value) < 0.0005 ? 0 : value
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(3)}`
}

/** 独立的行级模型研究预览：只读口径 + 请求内按行打分，不进入项目分析。 */
export function LineResearchPage({ navigate }: { navigate: (route: Route) => void }) {
  const [meta, setMeta] = useState<LineResearchMetadata | null>(null)
  const [metaError, setMetaError] = useState('')
  const [reload, setReload] = useState(0)
  const [language, setLanguage] = useState('')
  const [code, setCode] = useState('')
  const [result, setResult] = useState<LineScoreResult | null>(null)
  const [expandedLine, setExpandedLine] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const resultRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    lineResearchMetadata(controller.signal).then(value => {
      if (controller.signal.aborted) return
      setMeta(value)
      setLanguage(current => current && value.languages.includes(current)
        ? current
        : value.languages.includes('typescript') ? 'typescript' : value.languages[0] ?? '')
    }).catch(failure => {
      if (!controller.signal.aborted) setMetaError(failure instanceof Error ? failure.message : '研究模型读取失败')
    })
    return () => controller.abort()
  }, [reload])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!code.trim()) return
    setBusy(true); setError('')
    try {
      const value = await scoreLineResearch(code, language)
      setResult(value)
      setExpandedLine(null)
      window.requestAnimationFrame(() => resultRef.current?.scrollIntoView?.({ block: 'nearest' }))
    } catch (failure) {
      setError(failure instanceof ApiError || failure instanceof Error ? failure.message : '分析失败')
    } finally { setBusy(false) }
  }

  const lines = code ? code.split('\n').length : 0
  return <EntryPage>
    <EntryHeader
      onHome={() => navigate({ name: 'landing' })}
      right={<>
        <span className="hidden rounded-full border border-border-strong px-2.5 py-1 text-xs font-semibold text-foreground-2 sm:inline">研究预览</span>
        <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'landing' })} type="button">返回首页</Button>
      </>}
    />
    <main className="mx-auto grid w-full max-w-[1180px] flex-1 gap-6 px-5 py-10 sm:px-8 sm:py-12">
      <section className="grid max-w-[860px] gap-3.5">
        <p className="text-xs uppercase tracking-[.14em] text-foreground-3">行级模型 · 实验性</p>
        <h1 className="font-display text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">按行查看研究模型的排序分数</h1>
        <p className="flex items-start gap-2 rounded-sm border border-border border-l-[3px] border-l-risk-mid bg-card p-3 text-sm leading-body text-foreground-2" role="note">
          <AlertTriangle aria-hidden="true" focusable="false" strokeWidth={1.5} size={16} className="mt-0.5 shrink-0"/>
          分数来自弱标签抽样，未做概率校准，不是缺陷概率；不参与项目分析、PR 审查或默认模型。
        </p>
      </section>
      {metaError ? <div className="grid justify-items-start gap-3 rounded-md border border-dashed border-border p-6" role="alert">
        <p className="text-sm text-foreground-2">{metaError}</p>
        <Button onClick={() => { setMetaError(''); setReload(value => value + 1) }} variant="outline" type="button">重试</Button>
      </div> : <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <section className="grid gap-3.5 rounded-lg border border-border bg-card p-5" aria-label="行级打分">
          <div className="flex flex-wrap items-baseline justify-between gap-2.5">
            <h2 className="text-base font-semibold text-foreground">提交代码</h2>
            <Select value={language == null ? '' : String(language)} onValueChange={nextValue => (setLanguage)(nextValue === '__jit_empty__' ? '' : nextValue)} disabled={!meta}><SelectTrigger aria-label="代码语言"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{((meta?.languages ?? []).map(value => ({ value, label: LANGUAGE_LABELS[value] ?? value }))).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select>
          </div>
          <form onSubmit={submit}>
            <label className="mb-1.5 block text-xs text-foreground-3" htmlFor="research-code">代码</label>
            <Textarea className="w-full resize-y rounded-md border border-input bg-sunken p-3 font-mono text-xs leading-relaxed text-foreground focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" id="research-code" value={code} onChange={event => setCode(event.target.value)}
              placeholder="粘贴 TypeScript 或 JavaScript 代码" rows={14} spellCheck={false}/>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant='default' type="submit" disabled={Boolean(!meta || !code.trim()) || Boolean(busy)}>{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}分析这些行</Button>
              <span className="text-xs text-foreground-3">{lines} 行{meta ? ` · 上限 ${meta.limits.maxLines.toLocaleString('zh-CN')} 行` : ''}</span>
            </div>
            {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
          </form>
        </section>
        <aside className="grid gap-3.5 rounded-lg border border-border bg-card p-5" aria-label="模型口径">
          {meta ? <>
            <div className="flex flex-wrap items-baseline justify-between gap-2.5"><h2 className="text-base font-semibold text-foreground">模型口径</h2><span className="text-xs text-foreground-3">{meta.languages.map(value => LANGUAGE_LABELS[value] ?? value).join(' / ')}</span></div>
            <dl className="grid gap-0 text-xs [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2.5 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-2 [&_dt]:text-foreground-3 [&_dd]:m-0">
              <div><dt>训练</dt><dd>{meta.training.repos.join('、')} · {count(meta.training.commits)} 提交 · {count(meta.training.samples)} 行</dd></div>
              <div><dt>留出</dt><dd>{meta.holdout.repo ?? '—'} · {count(meta.holdout.commits)} 提交 · {count(meta.holdout.samples)} 行</dd></div>
              <div><dt>ROC-AUC</dt><dd>{number(meta.metrics.rocAuc)}</dd></div>
              <div><dt>PR-AUC</dt><dd>{number(meta.metrics.prAuc)} · 随机基线 {number(meta.metrics.randomPrAuc)}</dd></div>
              <div><dt>Brier</dt><dd>{number(meta.metrics.brier)}</dd></div>
              <div><dt>Top-5 命中</dt><dd>{percent(meta.localization.top5)} · 抽样代理</dd></div>
              <div><dt>20% 行预算召回</dt><dd>{percent(meta.localization.recallAt20PercentLines)} · 抽样代理</dd></div>
            </dl>
            <ul className="grid list-disc gap-1.5 pl-4 text-xs leading-body text-foreground-3">{meta.limitations.map(item => <li key={item}>{item}</li>)}</ul>
          </> : <p className="text-xs text-foreground-3">正在读取研究模型…</p>}
        </aside>
      </div>}
      {result ? <section className="grid gap-3.5 rounded-lg border border-border bg-card p-5" ref={resultRef} aria-live="polite">
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          <h2 className="text-base font-semibold text-foreground">排序结果</h2>
          <span className="text-xs text-foreground-3">{result.count} 行{result.skippedBlank ? ` · 跳过 ${result.skippedBlank} 个空行` : ''}</span>
        </div>
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-xs [&_caption]:pb-2 [&_caption]:text-left [&_caption]:text-xs [&_caption]:text-foreground-3 [&_th]:border-b [&_th]:border-border-soft [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_th]:whitespace-nowrap [&_td]:border-b [&_td]:border-border-soft [&_td]:px-2.5 [&_td]:py-2 [&_td]:align-top [&_td:first-child]:tabular-nums [&_td:first-child]:text-foreground-3">
            <caption>按分数降序；分数不是缺陷概率。</caption>
            <TableHeader><TableRow><TableHead scope="col">排名</TableHead><TableHead scope="col">行</TableHead><TableHead scope="col">代码</TableHead><TableHead scope="col">分数</TableHead></TableRow></TableHeader>
            <TableBody>{result.lines.map(row => {
              const isExpanded = expandedLine === row.line
              return <Fragment key={row.line}>
                <TableRow>
                  <TableCell>{row.rank}</TableCell>
                  <TableCell>{row.line}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="flex min-w-0 max-w-[560px] items-center gap-2 text-left"
                      aria-expanded={isExpanded}
                      aria-label={`第 ${row.line} 行，${isExpanded ? '收起' : '展开'}特征贡献`}
                      disabled={!row.contributions.length}
                      onClick={() => setExpandedLine(isExpanded ? null : row.line)}
                    >
                      <code className="block min-w-0 flex-1 truncate font-mono" title={row.text}>{row.text || ' '}</code>
                      {row.contributions.length ? <ChevronDown aria-hidden="true" size={14} className={`shrink-0 text-foreground-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}/> : null}
                    </button>
                  </TableCell>
                  <TableCell><span className="flex items-center gap-2"><span className="block h-1 w-20 overflow-hidden rounded-full bg-strong"><span className="block h-full bg-accent" style={{ width: `${row.score * 100}%` }}/></span><b className="font-semibold tabular-nums text-foreground">{row.score.toFixed(3)}</b></span></TableCell>
                </TableRow>
                {isExpanded ? <TableRow>
                  <TableCell colSpan={4} className="bg-sunken/60">
                    <div className="grid gap-2 py-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium text-foreground">{result.contributionCaveat}</p>
                        <span className="text-foreground-3">截距 {number(result.intercept)} · 其余特征 {signed(row.otherContribution)}</span>
                      </div>
                      <div className="grid gap-1.5 sm:grid-cols-3">
                        {row.contributions.map(item => <div key={item.feature} className="rounded-sm border border-border-soft px-2.5 py-2">
                          <p className="font-medium text-foreground">{lineFeatureLabel(item.feature)}</p>
                          <p className="mt-0.5 text-foreground-3">本次值 {number(item.value, 2)} · 权重 {signed(item.weight)}</p>
                          <p className="tabular-nums text-foreground-2">贡献 {signed(item.contribution)}</p>
                        </div>)}
                      </div>
                    </div>
                  </TableCell>
                </TableRow> : null}
              </Fragment>
            })}</TableBody>
          </Table>
        </div>
      </section> : null}
    </main>
  </EntryPage>
}
