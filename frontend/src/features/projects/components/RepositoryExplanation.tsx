import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { useEffect, useRef, useState } from 'react'

import { requestRepositoryExplanation, type ExplanationContext, type RepositoryExplanation as Explanation } from '@/features/projects/repositoryExplanation'

const LABELS: Record<string, string> = { ns: '子系统数', nd: '目录数', nf: '文件数', ent: '改动分散度', entropy: '改动分散度',
  la: '新增行数', ld: '删除行数', lt: '变更前规模', fix: '修复标记', ndev: '参与开发者数', age: '变更间隔',
  nuc: '历史变更数', exp: '作者经验', rexp: '作者近期经验', sexp: '子系统经验' }
type State = { key: string; result?: Explanation; error?: string; busy?: boolean }

export function RepositoryExplanation({ context, heading = true }: { context: ExplanationContext; heading?: boolean }) {
  const key = JSON.stringify(context)
  const [state, setState] = useState<State>({ key: '' })
  const [attempt, setAttempt] = useState(0)
  const locked = useRef(false)
  const generation = useRef<AbortController | null>(null)
  const activeKey = useRef(key)
  activeKey.current = key
  useEffect(() => {
    const controller = new AbortController()
    generation.current?.abort(); locked.current = false
    requestRepositoryExplanation(context, false, controller.signal)
      .then(result => { if (!controller.signal.aborted) setState({ key, result }) })
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : '解释读取失败' }) })
    return () => { controller.abort(); generation.current?.abort() }
  // The serialized context contains all source identities; parent renders do not refetch it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])
  const current = state.key === key ? state : undefined
  async function generate() {
    if (locked.current) return
    locked.current = true
    const controller = new AbortController(); generation.current = controller
    setState(previous => ({ ...previous, key, busy: true, error: undefined }))
    try {
      const result = await requestRepositoryExplanation(context, true, controller.signal)
      if (!controller.signal.aborted && activeKey.current === key) setState({ key, result })
    } catch (failure) {
      if (!controller.signal.aborted && activeKey.current === key) setState(previous => ({ ...previous, key, busy: false, error: failure instanceof Error ? failure.message : '解释生成失败' }))
    } finally { if (activeKey.current === key) locked.current = false }
  }
  const result = current?.result
  const supported = result?.explanationStatus === 'supported'
  return <section className="repository-explanation" aria-label="模型解释" aria-busy={!current || Boolean(current.busy)}>
    {heading ? <h3>模型解释</h3> : null}
    <p className="text-xs leading-body text-foreground-3">单特征敏感度，不是缺陷结论、因果解释或代码定位；保存的模型分数不会改变。</p>
    {!current ? <p role="status">正在读取模型解释…</p> : null}
    {current?.error ? <div role="alert"><p>{current.error}</p><Button variant="link" size="sm" onClick={() => { setState({ key: '' }); setAttempt(value => value + 1) }} type="button">重新读取解释</Button></div> : null}
    {result?.explanationStatus === 'not-generated' ? <p>尚未生成该提交的模型解释，生成后会随此分析保存。</p> : null}
    {result?.explanationStatus === 'not-supported' ? <p role="status">{result.explanationReason ?? '本次暂不能提供解释，原分数保持不变。'}</p> : null}
    {result && !supported ? <Button variant="link" size="sm" onClick={() => void generate()} type="button">{current?.busy ? '正在生成模型解释…' : result.explanationStatus === 'not-generated' ? '生成模型解释' : '重新尝试生成'}</Button> : null}
    {supported ? <>
      <p>{result.explanationSummary}</p>
      {result.explanation.length ? <div className="explanation-table-scroll"><Table className="explanation-table"><caption className="sr-only">主要特征对模型分数的影响</caption><TableHeader><TableRow><TableHead>特征</TableHead><TableHead>本次值 / 基线</TableHead><TableHead>分数变化</TableHead></TableRow></TableHeader><TableBody>{result.explanation.map(item => <TableRow key={item.feature}><TableHead>{LABELS[item.feature] ?? item.feature}（{item.feature}）</TableHead><TableCell>{item.value.toLocaleString(undefined, { maximumFractionDigits: 6 })} / {item.baseline.toLocaleString(undefined, { maximumFractionDigits: 6 })}</TableCell><TableCell><b>{item.delta > 0 ? '+' : ''}{item.delta.toFixed(6)}</b><span>{item.direction === 'increases' ? '推高分数' : '拉低分数'}</span></TableCell></TableRow>)}</TableBody></Table></div> : null}
      <p className="text-xs leading-body text-foreground-3">{result.baselineSource === 'zero' ? '零基线：训练分区背景不可用。' : result.baselineSource === 'mixed' ? '部分字段使用训练分区均值，其余字段使用零基线。' : result.baselineSource === 'training-partition-mean' ? '基线来自原模型训练分区的字段均值。' : '基线来自原模型绑定数据集的字段均值。'}</p>
      <details className="rounded-sm border border-border-soft"><summary>解释方法与来源</summary><dl className="grid gap-1 text-xs [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1 [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all"><div><dt>方法</dt><dd>{result.explanationMethod}</dd></div><div><dt>数据口径</dt><dd>{result.featureSchemaVersion}</dd></div><div><dt>基线数据</dt><dd>{result.baselineDatasetVersion}</dd></div>{result.missingBaselineFeatures.length ? <div><dt>零基线字段</dt><dd>{result.missingBaselineFeatures.join('、')}</dd></div> : null}<div><dt>模型</dt><dd><code>{context.modelId}</code></dd></div></dl>{result.limitations.map((note, index) => <p className="text-xs leading-body text-foreground-3" key={index}>{note}</p>)}</details>
    </> : null}
  </section>
}
