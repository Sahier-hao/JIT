import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useEffect, useRef, useState } from 'react'

import {
  requestRepositoryExplanation,
  requestRepositoryExplanationMethods,
  requestRepositoryExplanations,
  type ExplanationContext,
  type ExplanationMethod,
  type ExplanationUnit,
  type FeatureEffect,
  type RepositoryExplanation as Explanation,
  type RepositoryExplanationMethods,
} from '@/features/projects/repositoryExplanation'

const FEATURE_LABELS: Record<string, string> = {
  ns: '子系统数', nd: '目录数', nf: '文件数', ent: '改动分散度', entropy: '改动分散度',
  la: '新增行数', ld: '删除行数', lt: '变更前规模', fix: '修复标记', ndev: '参与开发者数',
  age: '变更间隔', nuc: '历史变更数', exp: '作者经验', rexp: '作者近期经验', sexp: '子系统经验',
}

const SAVED_METHOD_LABELS: Record<string, string> = {
  'occlusion-mean-v1': '遮挡均值基线',
  'linear-logodds-v1': '逻辑回归 log-odds 分解',
}

function featureLabel(feature: string): string {
  return `${FEATURE_LABELS[feature] ?? feature}（${feature}）`
}

function unitLabel(unit: ExplanationUnit): string {
  return unit === 'probability' ? '概率变化' : 'log-odds 变化'
}

function baselineText(source: Explanation['baselineSource']): string {
  if (source === 'zero') return '零基线：训练分区背景不可用。'
  if (source === 'mixed') return '部分字段使用训练分区均值，其余字段使用零基线。'
  if (source === 'training-partition-mean') return '基线来自原模型训练分区的字段均值。'
  if (source === 'model-dataset-mean') return '基线来自原模型绑定数据集的字段均值。'
  return '基线口径未提供。'
}

function ContributionBars({ items, unit }: { items: FeatureEffect[]; unit: ExplanationUnit }) {
  const max = Math.max(...items.map((item) => Math.abs(item.delta)), 0)
  if (max === 0 || items.length === 0) return null
  return (
    <ol className="grid gap-1.5" aria-label={`特征贡献条形图（${unitLabel(unit)}）`}>
      {items.map((item) => {
        const width = Math.max(4, Math.round((Math.abs(item.delta) / max) * 100))
        return (
          <li key={item.feature} className="grid grid-cols-[minmax(88px,124px)_minmax(0,1fr)_64px] items-center gap-2 text-xs">
            <span className="truncate text-foreground-2" title={item.feature}>{featureLabel(item.feature)}</span>
            <span className="h-1.5 overflow-hidden rounded-sm bg-strong" aria-hidden="true">
              <i className={cn('block h-full', item.delta > 0 ? 'bg-rose' : 'bg-teal')} style={{ width: `${width}%` }} />
            </span>
            <span className="text-right font-mono tabular-nums text-foreground-3">{item.delta > 0 ? '+' : ''}{item.delta.toFixed(3)}</span>
          </li>
        )
      })}
    </ol>
  )
}

function ExplanationTable({ result }: { result: Explanation }) {
  return (
    <div className="explanation-table-scroll">
      <Table className="explanation-table">
        <caption className="sr-only">
          主要特征对模型分数的影响，方法 {result.explanationMethod ?? '未提供'}，单位 {unitLabel(result.explanationUnit)}
        </caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">特征</TableHead>
            <TableHead scope="col">本次值</TableHead>
            <TableHead scope="col">基线值</TableHead>
            <TableHead scope="col">带符号贡献（{unitLabel(result.explanationUnit)}）</TableHead>
            <TableHead scope="col">方向</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.explanation.map((item) => (
            <TableRow key={item.feature}>
              <TableHead scope="row">{featureLabel(item.feature)}</TableHead>
              <TableCell className="tabular-nums">{item.value.toLocaleString(undefined, { maximumFractionDigits: 3 })}</TableCell>
              <TableCell className="tabular-nums">{item.baseline.toLocaleString(undefined, { maximumFractionDigits: 3 })}</TableCell>
              <TableCell className="tabular-nums"><b>{item.delta > 0 ? '+' : ''}{item.delta.toFixed(3)}</b></TableCell>
              <TableCell>{item.direction === 'increases' ? '推高分数' : '拉低分数'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function MethodMetadata({ result, meta, context }: { result: Explanation; meta?: ExplanationMethod; context: ExplanationContext }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => setOpen(true)}>解释方法与来源</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined} className="max-h-[80vh] overflow-auto" style={{ width: 'min(92vw, 520px)', maxWidth: 'none' }}>
        <DialogHeader><DialogTitle>解释方法与来源</DialogTitle></DialogHeader>
        <div className="grid gap-2">
          <dl className="grid gap-1 text-xs [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1 [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">
            <div><dt>方法</dt><dd>{meta?.name ?? SAVED_METHOD_LABELS[result.explanationMethod ?? ''] ?? result.explanationMethod}</dd></div>
            <div><dt>单位</dt><dd>{unitLabel(result.explanationUnit)}</dd></div>
            <div><dt>数据口径</dt><dd>{result.featureSchemaVersion}</dd></div>
            <div><dt>基线数据</dt><dd>{result.baselineDatasetVersion}</dd></div>
            {result.baselineHash ? <div><dt>基线哈希</dt><dd><code>{result.baselineHash}</code></dd></div> : null}
            {result.trainingPartitionSize != null ? <div><dt>训练分区</dt><dd>{result.trainingPartitionSize} 条</dd></div> : null}
            {result.missingBaselineFeatures.length ? <div><dt>零基线字段</dt><dd>{result.missingBaselineFeatures.join('、')}</dd></div> : null}
            <div><dt>模型</dt><dd><code>{context.modelId}</code></dd></div>
          </dl>
          {result.limitations.map((note, index) => <p className="text-xs leading-body text-foreground-3" key={index}>{note}</p>)}
        </div>
      </DialogContent>
    </Dialog>
  </>
}

function Comparison({ explanations, methods }: { explanations: Explanation[]; methods: ExplanationMethod[] }) {
  const supported = explanations.filter((item) => item.explanationStatus === 'supported')
  if (supported.length < 2) return null
  return (
    <section className="grid gap-2" aria-label="多方法并列核对">
      <h4 className="text-sm font-medium text-foreground">多方法并列核对</h4>
      <p className="text-xs text-foreground-3">不同方法单位不同，不求和、不共享排名、不自动选择“最佳解释”。</p>
      <Table>
        <caption className="sr-only">同一提交多种解释方法的主要特征、方向、稳定性与限制</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">方法</TableHead>
            <TableHead scope="col">单位</TableHead>
            <TableHead scope="col">主要特征</TableHead>
            <TableHead scope="col">方向</TableHead>
            <TableHead scope="col">排序稳定性</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {supported.map((item) => {
            const meta = methods.find((method) => method.method === item.explanationMethod)
            return (
              <TableRow key={item.explanationMethod}>
                <TableHead scope="row">{meta?.name ?? SAVED_METHOD_LABELS[item.explanationMethod ?? ''] ?? item.explanationMethod}</TableHead>
                <TableCell>{unitLabel(item.explanationUnit)}</TableCell>
                <TableCell>{item.explanation.slice(0, 3).map((feature) => featureLabel(feature.feature)).join('、')}</TableCell>
                <TableCell>{item.explanation[0]?.direction === 'increases' ? '推高分数' : item.explanation[0] ? '拉低分数' : '—'}</TableCell>
                <TableCell>{item.stability ? (item.stability.status === 'unstable' ? '不稳定' : '稳定') : '未记录'}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {supported.map((item) => (
        <p className="text-xs text-foreground-3" key={item.explanationMethod}>
          {item.explanationMethod}：{item.limitations.slice(0, 2).join('；')}
        </p>
      ))}
    </section>
  )
}

type State = {
  key: string
  loading: boolean
  directory?: RepositoryExplanationMethods
  saved: Explanation[]
  selectedMethod?: string
  error?: string
  busy?: boolean
}

export function RepositoryExplanation({ context, heading = true }: { context: ExplanationContext; heading?: boolean }) {
  const key = JSON.stringify(context)
  const [state, setState] = useState<State>({ key: '', loading: true, saved: [] })
  const [attempt, setAttempt] = useState(0)
  const generation = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      requestRepositoryExplanationMethods(context, controller.signal),
      requestRepositoryExplanations(context, controller.signal),
    ])
      .then(([directory, list]) => {
        if (controller.signal.aborted) return
        const methods = directory.methods
        const selected = list.explanations.find((item) => item.explanationStatus === 'supported')?.explanationMethod
          ?? (methods.some((method) => method.method === directory.defaultMethod) ? directory.defaultMethod : methods[0]?.method)
        setState({ key, loading: false, directory, saved: list.explanations, selectedMethod: selected })
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        const error = failure instanceof Error ? failure.message : '解释读取失败'
        setState({ key, loading: false, saved: [], error })
      })
    return () => {
      controller.abort()
      generation.current?.abort()
      generation.current = null
    }
    // 序列化后的 context 已包含全部来源身份，父组件重渲染不重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])
  const current = state.key === key ? state : undefined
  const loading = !current || current.loading
  const loadError = current && !current.loading && !current.directory ? current.error : undefined
  const methods = current?.directory?.methods ?? []
  const saved = current?.saved ?? []
  const options = methods.map(({ method, name, unit }) => ({ method, name, unit }))
  for (const item of saved) {
    const method = item.explanationMethod
    if (!method || item.explanationStatus !== 'supported' || options.some((option) => option.method === method)) continue
    options.push({ method, name: SAVED_METHOD_LABELS[method] ?? method, unit: item.explanationUnit })
  }
  const selectedMethod = current?.selectedMethod
  const selectedMeta = methods.find((method) => method.method === selectedMethod)
  const selectedSaved = saved.find((item) => item.explanationMethod === selectedMethod)
  async function generate(method: string) {
    if (generation.current || !methods.some((item) => item.method === method)) return
    const controller = new AbortController()
    generation.current = controller
    setState((previous) => ({ ...previous, busy: true, error: undefined }))
    try {
      const result = await requestRepositoryExplanation(context, { generate: true, method, signal: controller.signal })
      if (controller.signal.aborted) return
      setState((previous) => {
        const exists = previous.saved.some((item) => item.explanationMethod === method)
        const nextSaved = exists
          ? previous.saved.map((item) => (item.explanationMethod === method ? result : item))
          : [...previous.saved, result]
        return { ...previous, busy: false, saved: nextSaved }
      })
    } catch (failure) {
      if (controller.signal.aborted) return
      setState((previous) => ({ ...previous, busy: false, error: failure instanceof Error ? failure.message : '解释生成失败' }))
    } finally {
      if (generation.current === controller) generation.current = null
    }
  }
  const noMethods = current?.directory ? methods.length === 0 : false
  const supported = saved.filter((item) => item.explanationStatus === 'supported')
  return (
    <section className="repository-explanation grid gap-3" aria-label="模型解释" aria-busy={loading || current?.busy === true}>
      {heading ? <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3>模型为什么给这个分数</h3>
        <span className="rounded-sm bg-sunken px-2 py-0.5 text-[10px] text-foreground-3">单特征敏感度</span>
      </div> : null}
      <p className="text-xs leading-5 text-foreground-3">看哪些输入把分数推高或拉低；不是缺陷结论、因果解释或代码定位，保存的模型分数不会改变。</p>
      {loading ? <p role="status">正在读取模型解释…</p> : null}
      {loadError ? <div role="alert"><p>{loadError}</p><Button variant="link" size="sm" onClick={() => { setState({ key: '', loading: true, saved: [] }); setAttempt((value) => value + 1) }} type="button">重新读取解释</Button></div> : null}
      {current && !loading && !loadError ? (
        <>
          {options.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-3">
              <span>解释方法</span>
              <NativeSelect
                aria-label="解释方法"
                value={selectedMethod ?? ''}
                disabled={current.busy}
                className="max-w-xs"
                onChange={(event) => setState((previous) => ({ ...previous, selectedMethod: event.target.value, error: undefined }))}
              >
                {options.map((method) => (
                  <NativeSelectOption key={method.method} value={method.method}>
                    {method.name}（{unitLabel(method.unit)}）
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          ) : options.length === 1 ? (
            <p className="text-xs text-foreground-4">方法：{options[0].name}（{unitLabel(options[0].unit)}）</p>
          ) : null}
          {noMethods ? (
            <p role="status">当前分析没有可生成的解释方法{current.directory?.reasonCode ? `：${current.directory.reasonCode}` : ''}，原分数保持不变。</p>
          ) : null}
          {selectedMethod && selectedSaved && selectedSaved.explanationStatus === 'supported' ? (
            <div className="grid gap-2.5 rounded-md border border-border-soft bg-card p-3">
              <p className="text-sm leading-6 text-foreground">{selectedSaved.featureSummary ?? selectedSaved.explanationSummary}</p>
              <ContributionBars items={selectedSaved.explanation} unit={selectedSaved.explanationUnit} />
              <details className="rounded-sm border border-border-soft">
                <summary className="cursor-pointer px-2.5 py-2 text-xs font-medium text-foreground-2">完整依据（{selectedSaved.explanation.length} 项）</summary>
                <div className="grid gap-2 border-t border-border-soft p-2.5">
                  <ExplanationTable result={selectedSaved} />
                  {selectedSaved.contributionTotal != null ? <p className="text-xs text-foreground-2">贡献合计：{selectedSaved.contributionTotal > 0 ? '+' : ''}{selectedSaved.contributionTotal.toFixed(3)}（log-odds）</p> : null}
                  <p className="text-xs leading-5 text-foreground-3">{baselineText(selectedSaved.baselineSource)}</p>
                  {selectedSaved.stability?.status === 'unstable' ? <p className="text-xs text-amber-deep">合法扰动下主要贡献特征排序不稳定，不把首位特征表述为确定的主因。</p> : null}
                  <MethodMetadata result={selectedSaved} meta={selectedMeta} context={context} />
                </div>
              </details>
            </div>
          ) : selectedMethod && selectedSaved && selectedSaved.explanationStatus === 'not-supported' ? (
            <div className="grid gap-1">
              <p role="status">{selectedSaved.explanationReason ?? '本次暂不能提供解释，原分数保持不变。'}</p>
              <Button variant="link" size="sm" className="justify-self-start" onClick={() => void generate(selectedMethod)} disabled={current.busy || !selectedMeta} type="button">{current.busy ? '正在生成模型解释…' : '重新尝试生成'}</Button>
            </div>
          ) : selectedMethod && selectedMeta ? (
            <div className="grid gap-1">
              <p>尚未生成该方法的模型解释，生成后会随此分析独立保存，不会覆盖其他方法的解释。</p>
              <Button variant="link" size="sm" className="justify-self-start" onClick={() => void generate(selectedMethod)} disabled={current.busy || !selectedMeta} type="button">{current.busy ? '正在生成模型解释…' : '生成模型解释'}</Button>
            </div>
          ) : null}
          {current.error ? <p className="text-xs text-rose" role="alert">{current.error}</p> : null}
          {supported.length > 1 ? <details className="rounded-md border border-border-soft">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-foreground-2">与其他已保存方法核对（{supported.length}）</summary>
            <div className="border-t border-border-soft p-3"><Comparison explanations={saved} methods={methods} /></div>
          </details> : null}
        </>
      ) : null}
    </section>
  )
}
