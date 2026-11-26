import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, ScanLine, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CodeDiff } from '@/features/reviews/components/CodeDiff'
import { LineRiskPanel } from '@/features/reviews/components/LineRiskPanel'
import { ReviewCandidates } from '@/features/reviews/components/ReviewCandidates'
import { getPRContext, type PRCandidate, type PRCodeLocation, type PRContext, type PRFile, type PRSnapshot } from '@/features/reviews/prReviewClient'
import { codeSideLabels, type CandidateDecision } from '@/features/reviews/prReview'
import { changeLabels } from '@/features/reviews/pages/reviewShared'
import { cn } from '@/lib/utils'
import { useReviewAccount } from '@/features/reviews/reviewAccount'
import type { PRCandidateChecks } from '@/features/reviews/usePRCandidateChecks'
import { lineRiskLanguage } from '@/features/reviews/lineRisk'

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '暂时无法读取'

type DiffView = 'unified' | 'split'

export function ReviewCode({ source, file, checks, view, onViewChange, location, locationRequest = 0, onAnchor, onAdd, decisions, onDecision, actions, drafts, compactInspector = false }: {
  source: PRSnapshot
  file: PRFile
  checks: PRCandidateChecks
  view: DiffView
  onViewChange: (view: DiffView) => void
  location?: PRCodeLocation
  locationRequest?: number
  onAnchor?: (side: PRCodeLocation['side'], line: number) => void
  onAdd: (candidate: PRCandidate) => void
  decisions?: Record<string, CandidateDecision>
  onDecision?: (key: string, value: CandidateDecision) => void
  actions?: (readable: boolean) => ReactNode
  drafts?: ReactNode
  compactInspector?: boolean
}) {
  const account = useReviewAccount()
  const code = useRef<HTMLDivElement>(null)
  const [codeView, setCodeView] = useState<'diff' | PRCodeLocation['side']>('diff')
  const [requestedSources, setRequestedSources] = useState(false)
  const [inspector, setInspector] = useState<'drafts' | 'checks' | 'line-risk'>(drafts ? 'drafts' : 'checks')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const inspectorId = useId()
  const lineRisk = lineRiskLanguage(file.path)

  function openInspector(panel: 'drafts' | 'checks' | 'line-risk') {
    setInspector(panel)
    setInspectorOpen(true)
  }
  const [manualViewAt, setManualViewAt] = useState<string>()
  const [selection, setSelection] = useState<{ location: PRCodeLocation; request: number }>()
  const target = selection?.request === locationRequest ? selection.location : location
  const result = checks.fileResult(file.path)
  const base = useQuery({
    queryKey: ['pr-code', account.account, account.generation, source.snapshotId, file.path, 'base'],
    queryFn: ({ signal }) => getPRContext(source, file.path, 'base', signal),
    enabled: requestedSources || codeView === 'base', retry: false,
  })
  const head = useQuery({
    queryKey: ['pr-code', account.account, account.generation, source.snapshotId, file.path, 'head'],
    queryFn: ({ signal }) => getPRContext(source, file.path, 'head', signal),
    enabled: requestedSources || codeView === 'head', retry: false,
  })
  const targetSide = target?.side, targetLine = target?.line
  const sourceContext = codeView === 'base' ? base : head
  const jumpKey = `${locationRequest}:${targetSide}:${targetLine}`
  useEffect(() => {
    const viewport = code.current
    if (!viewport || !targetSide || !targetLine || manualViewAt === jumpKey) return
    const row = viewport.querySelector<HTMLElement>(`[data-code-line="${targetSide}:${targetLine}"]`)
    if (row) {
      const { top, bottom } = viewport.getBoundingClientRect()
      const line = row.getBoundingClientRect()
      if (line.top < top + 32 || line.bottom > bottom) viewport.scrollTop += line.top - top - viewport.clientHeight / 2
    } else if (codeView !== targetSide) {
      setCodeView(targetSide)
    }
  }, [view, file.patch, targetSide, targetLine, jumpKey, selection, codeView, manualViewAt, base.data, head.data])

  function locate(location: PRCodeLocation) {
    openInspector('checks')
    setManualViewAt(undefined)
    setSelection({ location: { side: location.side, line: location.line }, request: locationRequest })
  }
  function focusLine(line: number) {
    setManualViewAt(undefined)
    setSelection({ location: { side: 'head', line }, request: locationRequest })
  }
  function selectCodeView(value: string) {
    if (value !== 'diff' && value !== 'base' && value !== 'head') return
    setManualViewAt(jumpKey)
    setCodeView(value)
    if (value !== 'diff') setRequestedSources(true)
    if (code.current) code.current.scrollTop = 0
  }
  const readable = file.patchComplete || Boolean(base.data?.complete && head.data?.complete)
  const analysisError = checks.error(file.path)
  const targetUnavailable = target && targetSide === codeView && sourceContext.data &&
    (sourceContext.data.absent || target.line > Math.min(10000, sourceContext.data.totalLines))
  const markedLines = new Set(result.candidates.map(item => `${item.side}:${item.line}`))
  function renderMarker(side: PRCodeLocation['side'], line: number) {
    if (!markedLines.has(`${side}:${line}`)) return null
    return <Button type="button" variant="ghost" size="icon-xs"
      className="size-5 shrink-0 bg-amber-soft text-amber-deep hover:bg-amber-soft hover:text-foreground"
      aria-label={`查看${codeSideLabels[side]}第 ${line} 行的可疑项`} aria-pressed={target?.side === side && target.line === line}
      onClick={() => locate({ side, line })}><TriangleAlert aria-hidden="true"/></Button>
  }

  return <div className="grid min-h-0 min-w-0 flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(250px,31%)]">
    <section className="flex min-h-0 min-w-0 flex-col" aria-label="源码阅读区">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-soft px-4 py-3">
        <div className="min-w-0">
          <code className="block truncate font-mono text-sm font-medium text-foreground" title={file.path}>{file.path}</code>
          <p className="text-xs text-foreground-3">{changeLabels[file.status] ?? file.status}
            {' · '}<span className="text-teal-deep">+{file.additions}</span>{' '}<span className="text-rose-deep">−{file.deletions}</span>
            {file.previousPath ? ` · 重命名自 ${file.previousPath}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lineRisk ? <Button type="button" size="sm" variant="outline" onClick={() => openInspector('line-risk')}>行级排序</Button> : null}
          <Button type="button" size="sm" onClick={() => { openInspector('checks'); checks.run(file.path) }} disabled={!checks.canCheck}>
            {result.label === '正在检查' ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : <ScanLine aria-hidden="true"/>}
            检查当前文件
          </Button>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1.5 border-b border-border-soft bg-sunken px-3 py-1">
        <ToggleGroup type="single" size="sm" value={codeView} onValueChange={selectCodeView} aria-label="代码内容">
          <ToggleGroupItem value="diff">Diff</ToggleGroupItem>
          <ToggleGroupItem value="base">基准源码</ToggleGroupItem>
          <ToggleGroupItem value="head">目标源码</ToggleGroupItem>
        </ToggleGroup>
        {codeView === 'diff' ? <ToggleGroup type="single" size="sm" value={view}
          onValueChange={value => { if (value === 'unified' || value === 'split') onViewChange(value) }} aria-label="Diff 布局">
          <ToggleGroupItem value="unified">统一</ToggleGroupItem><ToggleGroupItem value="split">并排</ToggleGroupItem>
        </ToggleGroup> : null}
      </div>
      <div ref={code} className="max-h-[min(64dvh,600px)] min-h-32 min-w-0 overflow-auto xl:max-h-none xl:min-h-0 xl:flex-1">
        {codeView === 'diff' ? <>
          {file.patchComplete ? null : <p className="border-b border-border-soft px-4 py-2 text-xs text-amber-deep">Diff 未完整提供，可切换到源码。</p>}
          <CodeDiff file={file} view={view} location={target} onAnchor={onAnchor ? (side, line) => { openInspector('drafts'); onAnchor(side, line) } : undefined} renderMarker={renderMarker}/>
        </> : sourceContext.data ? <SourceContext context={sourceContext.data} target={target}
          onAnchor={onAnchor ? (side, line) => { openInspector('drafts'); onAnchor(side, line) } : undefined} renderMarker={renderMarker}/>
          : sourceContext.error ? <div className="flex flex-wrap items-center gap-2 p-4">
            <p role="alert" className="text-xs text-rose-deep">{errorMessage(sourceContext.error)}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void sourceContext.refetch()}>重试读取源码</Button>
          </div> : <p role="status" className="p-4 text-sm text-foreground-3">正在读取源码</p>}
        {targetUnavailable ? <p role="alert" className="px-4 py-2 text-xs text-rose-deep">原位置超出此版本可读取的范围。</p> : null}
      </div>
      {actions || compactInspector ? <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-soft bg-sunken px-3 py-1.5">
        {actions?.(readable)}
        {compactInspector ? <Button type="button" size="sm" variant="outline" className="xl:hidden"
          aria-expanded={inspectorOpen} aria-controls={inspectorId} onClick={() => setInspectorOpen(open => !open)}>
          {inspectorOpen ? '收起问题与检查' : '问题与检查'}
        </Button> : null}
      </div> : null}
    </section>

    <aside id={inspectorId} className={cn('min-h-0 min-w-0 border-t border-border-soft bg-sunken xl:border-t-0 xl:border-l',
      compactInspector && !inspectorOpen && 'hidden xl:block')} aria-label="审查侧栏">
      <Tabs className="min-h-0 gap-0 xl:h-full" value={inspector} onValueChange={value => {
        if (value === 'drafts' || value === 'checks' || value === 'line-risk') setInspector(value)
      }}>
        <TabsList variant="line" aria-label="审查侧栏" className="w-full shrink-0 justify-start border-b border-border-soft px-3">
          <TabsTrigger value="checks" className="flex-none">检查结果</TabsTrigger>
          {drafts ? <TabsTrigger value="drafts" className="flex-none">问题草稿</TabsTrigger> : null}
          {lineRisk ? <TabsTrigger value="line-risk" className="flex-none">行级排序</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="checks" className="min-h-0 overflow-auto">
          {analysisError ? <p className="px-4 py-3 text-xs text-rose-deep" role="alert">{errorMessage(analysisError)}</p> : null}
          {result.candidates.length ? <ReviewCandidates candidates={result.candidates} ruleSet={result.ruleSet} target={target} onLocate={locate}
            onAdd={candidate => { onAdd(candidate); if (drafts) openInspector('drafts') }}
            decisionsByKey={decisions} onDecision={onDecision}/> :
            <p className="px-4 py-4 text-sm text-foreground-3" role="status">{result.reason ??
              (result.label === '无规则命中' ? '未发现当前规则命中' : result.label || '当前文件尚未检查')}</p>}
        </TabsContent>
        {drafts ? <TabsContent value="drafts" className="flex min-h-0 flex-col">{drafts}</TabsContent> : null}
        {lineRisk ? <TabsContent value="line-risk" className="min-h-0 overflow-auto">
          <LineRiskPanel source={source} file={file} onLocate={focusLine}/>
        </TabsContent> : null}
      </Tabs>
    </aside>
  </div>
}

function SourceContext({ context, target, onAnchor, renderMarker }: {
  context: PRContext
  target?: PRCodeLocation
  onAnchor?: (side: PRCodeLocation['side'], line: number) => void
  renderMarker: (side: PRCodeLocation['side'], line: number) => ReactNode
}) {
  const { side, path, content, totalLines, absent, complete } = context
  const lines = content.split(/\r\n|[\n\r]/).slice(0, totalLines)
  return <section aria-label={`${codeSideLabels[side]}源码`} className="min-w-full">
    <h3 className="sticky top-0 z-10 border-b border-border-soft bg-sunken px-3 py-2 text-xs font-medium text-foreground-2">
      {codeSideLabels[side]}源码 · {absent ? '此侧无文件' : complete ? `${totalLines} 行` : `已加载 ${lines.length}/${totalLines} 行`}
    </h3>
    {lines.map((line, index) => {
      const number = index + 1, focused = target?.side === side && target.line === number ? 'true' : undefined
      return <div key={index} data-code-line={`${side}:${number}`} data-focused={focused}
        className="flex min-h-6 w-max min-w-full items-center gap-3 px-2 font-mono text-xs data-[focused=true]:bg-accent-soft">
        <span className="flex w-16 shrink-0 items-center justify-end gap-1 tabular-nums text-foreground-4">
          {renderMarker(side, number)}
          {onAnchor ? <Button type="button" size="xs" variant="ghost" data-focused={focused} aria-label={`关联 ${path}:${side}:${number}`}
            onClick={() => onAnchor(side, number)}>{number}</Button> : number}
        </span>
        <code className="whitespace-pre font-mono text-foreground-2">{line || ' '}</code>
      </div>
    })}
  </section>
}
