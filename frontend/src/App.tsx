import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { contextKey, displayTime, emptyQuery, applyQuery, queryCommits, readSeedQuery, type Commit, type Dataset, type Mode } from './domain'
import { demoLoader, historicalLoader, useDataset, type Loader } from './useDataset'
import { AppShell, UnknownRoute, type ShellProps } from './AppShell'
import { CredentialProvider } from './credentials'
import { useCredential } from './credentialContext'
import { ModelsPage } from './ModelsPage'
import { PredictPage } from './PredictPage'
import { PredictionsPage } from './PredictionsPage'
import { TrendPage } from './TrendPage'
import type { PredictionResult } from './predictionContract'
import { useRoute } from './navigation'
import { BaselineRecord } from './BaselineRecord'
import { CommitDetail } from './CommitDetail'
import { Risk } from './Risk'
import { Icon } from './Icon'
import { restoreShortlist, saveShortlist } from './shortlist'
import './App.css'

function Empty({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark"><Icon name="list" size={28} /></div><h2>{title}</h2><p>{description}</p>{children}</div>
}

function CommitTable({ records, selected, shortlist, listView, onOpen, onAdd, onRemove, historical }: {
  records: Commit[]; selected: string | null; shortlist: string[]; listView: boolean; historical: boolean;
  onOpen: (id: string, trigger: HTMLButtonElement) => void; onAdd: (id: string) => void; onRemove: (id: string) => void;
}) {
  return <div className="table-wrap"><table>
    <caption className="sr-only">{listView ? '提交风险列表' : '优先审查清单提交'}</caption>
    <thead><tr><th>提交 / 改动</th><th>{historical ? '模型风险' : '示例风险'}</th><th>提交时间</th><th className="numeric">变更行</th><th className="numeric">文件</th><th className="action-head">审查选择</th></tr></thead>
    <tbody>{records.map(record => {
      const time = displayTime(record.time)
      return <tr key={record.id} className={selected === record.id ? 'selected-row' : ''}>
      <td className="commit-cell"><button className="commit-link" title={record.id} aria-label={`查看 ${record.id}`} onClick={event => onOpen(record.id, event.currentTarget)}>{historical ? record.id.slice(0, 12) + '…' : record.id}<Icon name="arrow" size={14} /></button><span className="commit-title" title={record.title}>{record.title || '未提供'}</span></td>
      <td><Risk risk={record.risk} /></td>
      <td className="time-cell"><time dateTime={record.time}>{time.slice(0, 10)}<span>{time.slice(11)}</span></time></td>
      <td className="numeric">{record.lines ?? '未提供'}</td><td className="numeric">{record.files ?? '未提供'}</td>
      <td className="action-cell">{listView ? <button className="row-action" aria-label={shortlist.includes(record.id) ? `${record.id} 已在清单` : `加入 ${record.id} 到清单`} disabled={shortlist.includes(record.id)} onClick={() => onAdd(record.id)}><Icon name={shortlist.includes(record.id) ? 'check' : 'plus'} size={14} />{shortlist.includes(record.id) ? '已加入' : '加入'}</button> : <button className="row-action remove" aria-label={`移除 ${record.id}`} onClick={() => onRemove(record.id)}>移除</button>}</td>
    </tr>})}</tbody>
  </table></div>
}

function Workbench({ data, view, onView, selection, onSelection }: {
  data: Dataset
  view: string
  onView: (view: string) => void
  selection: { ids: string[]; warning: string | null }
  onSelection: (selection: { ids: string[]; warning: string | null }) => void
}) {
  const historical = data.mode === 'historical'
  // 地址上的日期是"查询种子"（CRR-05）：只在挂载时读一次，之后手动修改不写回地址。
  const [seed] = useState(() => readSeedQuery(window.location.search))
  const [queryState, setQueryState] = useState({ draft: seed.query, applied: seed.query, error: '' })
  const shortlist = selection.ids
  const [selected, setSelected] = useState<string | null>(null)
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const listView = view === 'list'
  const visible = listView ? queryCommits(data.records, queryState.applied) : shortlist.flatMap(id => data.records.filter(record => record.id === id))
  // 清单按数据上下文恢复：状态由 Workspace 持有（侧栏计数要用），所以在这里同步而不是用 useState 初始化。
  // 用 layout 效果是为了保持「首屏就是已恢复的清单」这一原有表现。
  const restored = useRef<string | null>(null)
  const context = contextKey(data)
  useLayoutEffect(() => {
    if (restored.current === context) return
    restored.current = context
    onSelection(restoreShortlist(data))
  }, [context, data, onSelection])
  function updateQuery(patch: Partial<typeof emptyQuery>) {
    setQueryState(previous => {
      const draft = { ...previous.draft, ...patch }
      const result = applyQuery(previous.applied, draft)
      return { draft, applied: result.query, error: result.error }
    })
  }
  function clearQuery() { setQueryState({ draft: emptyQuery, applied: emptyQuery, error: '' }) }
  function closeDetail() { setSelected(null); returnFocus.current?.focus() }
  function changeView(next: string) { onView(next); setSelected(null) }
  function changeShortlist(ids: string[]) { onSelection({ ids, warning: saveShortlist(data, ids) }) }
  function add(id: string) { if (!shortlist.includes(id) && data.records.some(record => record.id === id)) changeShortlist([...shortlist, id]) }
  return <>
      <header className="topbar"><div><span className="project-symbol"><Icon name="project" /></span><strong>{data.project}</strong><Icon name="chevron" size={14} /><span>{listView ? '提交工作台' : '审查清单'}</span></div><div className="source-meta"><span className={historical ? 'demo-badge historical-badge' : 'demo-badge'}><span />{historical ? '真实历史回放' : '演示模式'}</span><code title={data.version}>{data.version}</code></div></header>
      {historical ? <div className="run-context"><span>{data.model?.name}</span><span>运行 <code title={data.runId}>{data.runId}</code></span></div> : null}
      <div className="page-heading"><div><h1>{listView ? '提交评审' : '优先审查清单'}</h1><p className="page-intro">{listView ? '从提交风险出发，确定下一次审查的重点。' : '保留值得优先核对的改动，按加入顺序安排审查。'}</p></div><div className="record-count"><Icon name={listView ? 'list' : 'shortlist'} size={20} /><div><strong>{listView ? data.records.length.toLocaleString() : shortlist.length}</strong><span>{listView ? (historical ? '条测试提交' : '条演示提交') : '条审查选择'}</span></div></div></div>
      <div className={historical ? 'demo-notice historical-notice' : 'demo-notice'}><Icon name="info" size={17} /><div><strong>{historical ? '公开历史数据 · 模型估计' : '当前为演示数据'}</strong><span>{historical ? '回顾性评价；发布者历史观测标签，未验证当时标签可获得性。风险不等于已确认缺陷。' : '风险分数和解释均为人工示例，不表示真实预测或已确认缺陷。'}</span></div></div>
      <BaselineRecord data={data} />
      {selection.warning ? <p className="warning storage-warning" role="alert">{selection.warning}</p> : null}
      {seed.ignored && listView ? <p className="status-note status-warn" role="status">地址中的日期范围无效，已忽略；当前按未设置日期显示。</p> : null}
      {listView ? <section className="toolbar" aria-label="提交查询">
        <label className="search-field">提交标识搜索<span className="input-wrap"><Icon name="search" size={17} /><input aria-label="提交标识搜索" placeholder={historical ? '搜索完整标识或片段' : '搜索提交标识，如 demo-0001'} value={queryState.draft.search} onChange={event => updateQuery({ search: event.target.value })} /></span></label>
        <label>起始日期<input aria-label="起始日期" inputMode="numeric" placeholder="YYYY-MM-DD" value={queryState.draft.start} aria-invalid={!!queryState.error} aria-describedby={queryState.error ? 'date-error' : undefined} onChange={event => updateQuery({ start: event.target.value })} /></label>
        <label>结束日期<input aria-label="结束日期" inputMode="numeric" placeholder="YYYY-MM-DD" value={queryState.draft.end} aria-invalid={!!queryState.error} aria-describedby={queryState.error ? 'date-error' : undefined} onChange={event => updateQuery({ end: event.target.value })} /></label>
        <label>排序<select aria-label="排序" value={queryState.draft.sort} onChange={event => updateQuery({ sort: event.target.value })}><option value="risk">风险从高到低</option><option value="time">时间从新到旧</option></select></label>
        <button className="clear-button" onClick={clearQuery}>清除筛选</button>
      </section> : null}
      {queryState.error && listView ? <p className="warning" id="date-error" role="alert">{queryState.error} 当前保留最近一次有效结果。</p> : null}
      <div className="section-caption"><span>{listView ? '提交风险列表' : '个人优先审查清单'}<b>{visible.length}</b></span><span>时间：Asia/Shanghai (UTC+08:00){listView ? (queryState.applied.sort === 'risk' ? (historical ? ' · 按模型风险排序' : ' · 按示例风险排序') : ' · 按时间排序') : ' · 按加入顺序'}</span></div>
      <div className={selected ? 'workbench-grid with-detail' : 'workbench-grid'}>
        <section className="list-panel" aria-label={listView ? '提交列表' : '清单列表'}>
          {visible.length ? <CommitTable historical={historical} records={visible} selected={selected} shortlist={shortlist} listView={listView} onOpen={(id, trigger) => { returnFocus.current = trigger; setSelected(id) }} onAdd={add} onRemove={id => changeShortlist(shortlist.filter(value => value !== id))} /> : <Empty title={listView ? (data.records.length ? '没有符合条件的提交' : '暂无提交') : '清单为空'} description={listView ? (data.records.length ? '使用上方「清除筛选」恢复列表，或尝试其他查询条件。' : '当前数据没有提交记录。') : '从工作台加入你想优先核对的提交。'}>{!listView ? <button className="primary-button" onClick={() => changeView('list')}>返回列表选择提交</button> : null}</Empty>}
          <footer className="list-footer"><span>{listView ? (historical ? '点击标识查看原始度量；预测解释未提供' : '点击提交标识，查看改动与示例解释') : '加入清单仅代表你的审查计划'}</span><span><Icon name={listView ? 'list' : 'shortlist'} size={14} />{visible.length} 条记录</span></footer>
        </section>
        {selected ? <CommitDetail data={data} id={selected} added={shortlist.includes(selected)} onAdd={() => add(selected)} onClose={closeDetail} /> : null}
      </div>
      <footer className="page-foot"><span>JIT Review</span><span>{historical ? (data.summary?.featureSchema ? `历史测试批次 · ${data.summary.featureSchema.name} 基线` : '历史测试批次 · 六字段基线') : '示例数据'} · 个人审查选择</span></footer>
  </>
}

function ModeResource({ loader, mode, workbench }: { loader: Loader; mode: Mode; workbench: WorkbenchState }) {
  const { resource, retry } = useDataset(loader, mode)
  if (resource.state === 'ready') return <Workbench key={contextKey(resource.data)} data={resource.data} {...workbench} />
  return <>
    <header className="topbar">JIT · 提交评审 · {mode === 'historical' ? '真实历史回放' : '演示模式'}</header>
    {resource.state === 'loading' ? <div role="status"><Empty title={mode === 'historical' ? '正在读取真实历史提交' : '正在读取演示提交'} description="请稍候，读取完成后显示项目与数据版本。" /></div> : <div role="alert"><Empty title="数据不可用" description={resource.error}><button className="primary-button" onClick={retry}>重新加载</button></Empty></div>}
  </>
}

interface WorkbenchState {
  view: string
  onView: (view: string) => void
  selection: { ids: string[]; warning: string | null }
  onSelection: (selection: { ids: string[]; warning: string | null }) => void
}

function Workspace({ loader, initialMode, loaders }: { loader?: Loader; initialMode?: Mode; loaders?: Partial<Record<Mode, Loader>> }) {
  const { route, navigate } = useRoute()
  const [mode, setMode] = useState<Mode>(() => initialMode ?? (new URLSearchParams(window.location.search).get('mode') === 'demo' ? 'demo' : 'historical'))
  const [created, setCreated] = useState<{ generation: number; result: PredictionResult } | null>(null)
  // 视图与清单由工作区持有：侧栏要显示清单数量，而侧栏在整个应用生命周期里只渲染一次。
  const [view, setView] = useState('list')
  const [selection, setSelection] = useState<{ ids: string[]; warning: string | null }>({ ids: [], warning: null })
  const { generation } = useCredential()
  // 更换或清除凭据后，上一份凭据下取得的受保护结果不再属于当前上下文（design D2）：在渲染时派生，
  // 而不是用副作用清空。
  const snapshot = created !== null && created.generation === generation ? created.result : null

  function changeMode(next: Mode) {
    const url = new URL(window.location.href)
    if (next === 'demo') url.searchParams.set('mode', 'demo'); else url.searchParams.delete('mode')
    window.history.replaceState({}, '', url)
    setMode(next)
  }

  const shell: ShellProps = { route, navigate, mode, onMode: changeMode, view, count: selection.ids.length, onView: setView }
  const workbench: WorkbenchState = { view, onView: setView, selection, onSelection: setSelection }

  let body: ReactNode
  if (route.name === 'models') body = <ModelsPage />
  else if (route.name === 'trends') body = <TrendPage />
  else if (route.name === 'predict') body = <PredictPage onCreated={result => { setCreated({ generation, result }); navigate({ name: 'result', batchId: result.batchId }) }} />
  else if (route.name === 'open') body = <PredictionsPage navigate={navigate} batchId={null} snapshot={null} />
  else if (route.name === 'result') body = <PredictionsPage navigate={navigate} batchId={route.batchId} snapshot={snapshot} />
  else if (route.name === 'unknown') body = <UnknownRoute hash={route.hash} navigate={navigate} />
  else {
    const selectedLoader = loaders?.[mode] ?? (mode === 'demo' ? (loader ?? demoLoader) : historicalLoader)
    body = <ModeResource key={mode} mode={mode} loader={selectedLoader} workbench={workbench} />
  }

  // 应用壳只在这里渲染一次：路由切换与数据加载都不会重建侧栏，凭据输入与键盘焦点因此保持稳定。
  return <AppShell {...shell}>{body}</AppShell>
}

export default function App({ loader, initialMode, loaders }: { loader?: Loader; initialMode?: Mode; loaders?: Partial<Record<Mode, Loader>> }) {
  return <CredentialProvider><Workspace loader={loader} initialMode={initialMode} loaders={loaders} /></CredentialProvider>
}
