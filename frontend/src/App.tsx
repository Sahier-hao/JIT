import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { contextKey, displayTime, emptyQuery, applyQuery, queryCommits, readSeedQuery, toCommit, type Commit, type Dataset, type Mode } from './domain'
import { demoLoader, historicalLoader, repositoryLoader, useDataset, type Loader } from './useDataset'
import { useCommitPage, useShortlistRecords } from './repositoryPage'
import { AppShell, UnknownRoute, type ShellProps } from './AppShell'
import { RepositorySourcesPage } from './RepositorySourcesPage'
import { CredentialProvider } from './credentials'
import { useCredential } from './credentialContext'
import { EmptyState, LoadingNotice } from './Feedback'
import { ModelsPage } from './ModelsPage'
import { PredictPage } from './PredictPage'
import { PredictionsPage } from './PredictionsPage'
import { TrendPage } from './TrendPage'
import type { PredictionResult } from './predictionContract'
import { useRoute, type Route } from './navigation'
import { BaselineRecord } from './BaselineRecord'
import { CommitDetail } from './CommitDetail'
import { Risk } from './Risk'
import { Icon } from './Icon'
import { restoreShortlist, saveShortlist } from './shortlist'
import './App.css'

function Empty({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <EmptyState title={title} description={description}>{children}</EmptyState>
}

function CommitTable({ records, selected, shortlist, listView, onOpen, onAdd, onRemove, modelRisk, truncate }: {
  records: Commit[]; selected: string | null; shortlist: string[]; listView: boolean; modelRisk: boolean; truncate: boolean;
  onOpen: (id: string, trigger: HTMLButtonElement) => void; onAdd: (id: string) => void; onRemove: (id: string) => void;
}) {
  return <div className="table-wrap"><table>
    <caption className="sr-only">{listView ? '提交风险列表' : '优先审查清单提交'}</caption>
    <thead><tr><th>提交 / 改动</th><th className="th-risk">{modelRisk ? '模型风险' : '示例风险'}</th><th>提交时间</th><th className="numeric">变更行</th><th className="numeric">文件</th><th className="action-head">审查选择</th></tr></thead>
    <tbody>{records.map(record => {
      const time = displayTime(record.time)
      return <tr key={record.id} className={selected === record.id ? 'selected-row' : ''}>
      <td className="commit-cell"><button className="commit-link" title={record.id} aria-label={`查看 ${record.id}`} onClick={event => onOpen(record.id, event.currentTarget)}>{truncate ? record.id.slice(0, 12) + '…' : record.id}<Icon name="arrow" size={14} /></button><span className="commit-title" title={record.title}>{record.title || '未提供'}</span></td>
      <td><Risk risk={record.risk} /></td>
      <td className="time-cell"><time dateTime={record.time}>{time.slice(0, 10)}<span>{time.slice(11)}</span></time></td>
      <td className="numeric">{record.lines ?? '未提供'}</td><td className="numeric">{record.files ?? '未提供'}</td>
      <td className="action-cell">{listView ? <button className="row-action" aria-label={shortlist.includes(record.id) ? `${record.id} 已在清单` : `加入 ${record.id} 到清单`} disabled={shortlist.includes(record.id)} onClick={() => onAdd(record.id)}><Icon name={shortlist.includes(record.id) ? 'check' : 'plus'} size={14} />{shortlist.includes(record.id) ? '已加入' : '加入'}</button> : <button className="row-action remove" aria-label={`移除 ${record.id}`} onClick={() => onRemove(record.id)}>移除</button>}</td>
    </tr>})}</tbody>
  </table></div>
}

/** 页面头部：元信息行 + 标题 + 导语 + 右侧计数，与内容之间用 2px 粗线分隔。 */
function PageHead({ data, listView, count, total }: { data: Dataset; listView: boolean; count: number; total: number }) {
  const historical = data.mode === 'historical'
  const repository = data.mode === 'repository'
  const real = data.mode !== 'demo'
  const label = repository ? '仓库同步数据' : historical ? '真实历史回放' : '演示模式'
  const strategy = data.repository?.modelStrategy === 'repository-trained' ? '本仓库数据训练' : data.repository?.modelStrategy === 'generic-model' ? '现成通用模型' : '模型来源未记录'
  return <header className="page-head">
    <div className="page-head-main">
      <p className="meta">
        <span className="meta-item">{data.project}</span>
        <span className="meta-sep" aria-hidden="true">/</span>
        <span className="mode-tag" data-tone={real ? 'info' : 'warn'}><i className="status-dot" />{label}</span>
        <span className="meta-sep" aria-hidden="true">/</span>
        <code className="meta-item">{data.version}</code>
      </p>
      <h1>{listView ? '提交评审' : '优先审查清单'}</h1>
      <p className="lede">{listView ? (repository ? '本次同步的提交按模型风险排序；最近一段提交还没有标签，只能打分、不能立刻验准。' : '从提交风险出发，确定下一次审查的重点。') : '保留值得优先核对的改动，按加入顺序安排审查。'}</p>
      {repository
        ? <p className="run-context"><strong>{strategy}</strong><span>{data.repository?.degradeReason ? ' · 已降级' : ''}同步 <code>{data.repository?.syncId}</code></span></p>
        : historical ? <p className="run-context"><strong>{data.model?.name}</strong><span>运行 <code>{data.runId}</code></span></p> : null}
    </div>
    <p className="stat"><strong>{listView ? total.toLocaleString() : count.toLocaleString()}</strong><span>{listView ? (repository ? '条同步提交' : historical ? '条测试提交' : '条演示提交') : '条审查选择'}</span></p>
  </header>
}

/** 数据来源说明：真实数据（历史回放或仓库同步）与演示数据的二分决定语气与图标。 */
function SourceNotice({ data }: { data: Dataset }) {
  const historical = data.mode === 'historical'
  const repository = data.mode === 'repository'
  return <div className="notice" data-tone={historical || repository ? 'info' : 'warn'}>
    <Icon name={historical || repository ? 'info' : 'warning'} size={16} />
    <div>
      <strong>{repository ? '仓库同步数据 · 模型估计' : historical ? '公开历史数据 · 模型估计' : '当前为演示数据'}</strong>
      <span>{repository ? '标签由简化 SZZ 从后续修复提交倒推；最近一段提交没有被修复过，因此没有标签。风险不等于已确认缺陷。' : historical ? '回顾性评价；发布者历史观测标签，未验证当时标签可获得性。风险不等于已确认缺陷。' : '风险分数和解释均为人工示例，不表示真实预测或已确认缺陷。'}</span>
    </div>
  </div>
}

function Workbench({ data, view, onView, selection, onSelection, syncId, token }: {
  data: Dataset
  view: string
  onView: (view: string) => void
  selection: { ids: string[]; warning: string | null }
  onSelection: (selection: { ids: string[]; warning: string | null }) => void
  syncId: string | null
  token: string
}) {
  const historical = data.mode === 'historical'
  const repository = data.mode === 'repository'
  // 真实数据（历史回放或仓库同步）与演示数据的二分：决定风险列标题、标识截断与来源徽章基调。
  const real = data.mode !== 'demo'
  // 地址上的日期是"查询种子"（CRR-05）：只在挂载时读一次，之后手动修改不写回地址。
  const [seed] = useState(() => readSeedQuery(window.location.search))
  const [queryState, setQueryState] = useState({ draft: seed.query, applied: seed.query, error: '' })
  const shortlist = selection.ids
  const [selected, setSelected] = useState<string | null>(null)
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const listView = view === 'list'
  // 仓库模式的一次同步可能有上千个提交：列表按查询条件向服务端要一页，搜索与日期筛选也在服务端做。
  const [offset, setOffset] = useState(0)
  const pageSize = 50
  const page = useCommitPage(repository ? syncId ?? '' : '', token, queryState.applied, offset, pageSize)
  // 清单是本地标识集合，不属于任何一页；仓库模式逐条取详情，取不到的单独提示而不是悄悄消失。
  const shortlistRecords = useShortlistRecords(repository ? syncId ?? '' : '', token, listView ? [] : shortlist)
  const visible: Commit[] = listView
    ? (repository ? page.commits.map(toCommit) : queryCommits(data.records, queryState.applied))
    : shortlist.flatMap(id => {
        if (!repository) return data.records.filter(record => record.id === id)
        const record = shortlistRecords.records.get(id)
        return record ? [record] : []
      })
  const total = listView ? (repository ? page.total : data.records.length) : shortlist.length
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
    setOffset(0)
    setQueryState(previous => {
      const draft = { ...previous.draft, ...patch }
      const result = applyQuery(previous.applied, draft)
      return { draft, applied: result.query, error: result.error }
    })
  }
  function clearQuery() { setOffset(0); setQueryState({ draft: emptyQuery, applied: emptyQuery, error: '' }) }
  function closeDetail() { setSelected(null); returnFocus.current?.focus() }
  function changeView(next: string) { onView(next); setSelected(null) }
  function changeShortlist(ids: string[]) { onSelection({ ids, warning: saveShortlist(data, ids) }) }
  // 仓库模式的列表只装着一页，加入清单不能拿当前页判断存在；服务端能取到就说明这条还在。
  function add(id: string) { if (!shortlist.includes(id) && (repository || data.records.some(record => record.id === id))) changeShortlist([...shortlist, id]) }
  return <div className="workbench">
      <PageHead data={data} listView={listView} count={shortlist.length} total={total} />

      <SourceNotice data={data} />

      <BaselineRecord data={data} />
      {listView && repository && total > 0 ? <nav className="pager" aria-label="提交分页">
        <button className="clear-button" disabled={offset === 0 || page.state === 'loading'} onClick={() => setOffset(Math.max(0, offset - pageSize))}>上一页</button>
        <span role="status">第 {(offset + 1).toLocaleString()}–{Math.min(offset + pageSize, total).toLocaleString()} 条，共 {total.toLocaleString()} 条</span>
        <button className="clear-button" disabled={offset + pageSize >= total || page.state === 'loading'} onClick={() => setOffset(offset + pageSize)}>下一页</button>
      </nav> : null}
      {!listView && repository && shortlistRecords.failed.length > 0 ? <p className="warning" role="alert">清单中有 {shortlistRecords.failed.length.toLocaleString()} 条记录不在这次同步里（可能来自其他作业），已跳过显示；可在清单中移除。</p> : null}
      {selection.warning ? <p className="warning storage-warning" role="alert">{selection.warning}</p> : null}
      {seed.ignored && listView ? <p className="status-note status-warn" role="status">地址中的日期范围无效，已忽略；当前按未设置日期显示。</p> : null}
      {listView ? <section className="toolbar" aria-label="提交查询">
        <label className="search-field">提交标识搜索<span className="input-wrap"><Icon name="search" size={16} /><input aria-label="提交标识搜索" placeholder={real ? '搜索完整标识或片段' : '搜索提交标识，如 demo-0001'} value={queryState.draft.search} onChange={event => updateQuery({ search: event.target.value })} /></span></label>
        <label>起始日期<input aria-label="起始日期" inputMode="numeric" placeholder="YYYY-MM-DD" value={queryState.draft.start} aria-invalid={!!queryState.error} aria-describedby={queryState.error ? 'date-error' : undefined} onChange={event => updateQuery({ start: event.target.value })} /></label>
        <label>结束日期<input aria-label="结束日期" inputMode="numeric" placeholder="YYYY-MM-DD" value={queryState.draft.end} aria-invalid={!!queryState.error} aria-describedby={queryState.error ? 'date-error' : undefined} onChange={event => updateQuery({ end: event.target.value })} /></label>
        <label>排序<select aria-label="排序" value={queryState.draft.sort} onChange={event => updateQuery({ sort: event.target.value })}><option value="risk">风险从高到低</option><option value="time">时间从新到旧</option></select></label>
        <button className="clear-button" onClick={clearQuery}>清除筛选</button>
      </section> : null}
      {queryState.error && listView ? <p className="warning" id="date-error" role="alert">{queryState.error} 当前保留最近一次有效结果。</p> : null}
      <div className="section-caption"><span>{listView ? '提交风险列表' : '个人优先审查清单'}<b>{total}</b></span><span>时间：Asia/Shanghai (UTC+08:00){listView ? (queryState.applied.sort === 'risk' ? (real ? ' · 按模型风险排序' : ' · 按示例风险排序') : ' · 按时间排序') : ' · 按加入顺序'}</span></div>
      <div className={selected ? 'workbench-grid with-detail' : 'workbench-grid'}>
        <section className="list-panel" aria-label={listView ? '提交列表' : '清单列表'}>
          {listView && repository && page.state === 'loading' && visible.length === 0
            ? <div role="status"><Empty title="正在读取提交" description="按当前筛选条件从服务端读取这一页。" /></div>
            : listView && repository && page.state === 'error'
              ? <div role="alert"><Empty title="提交读取失败" description={page.error}><button className="primary-button" onClick={page.retry}>重新加载</button></Empty></div>
              : visible.length
                ? <CommitTable modelRisk={real} truncate={historical} records={visible} selected={selected} shortlist={shortlist} listView={listView} onOpen={(id, trigger) => { returnFocus.current = trigger; setSelected(id) }} onAdd={add} onRemove={id => changeShortlist(shortlist.filter(value => value !== id))} />
                : <Empty title={listView ? (total ? '没有符合条件的提交' : '暂无提交') : '清单为空'} description={listView ? (total ? '使用上方「清除筛选」恢复列表，或尝试其他查询条件。' : '当前数据没有提交记录。') : '从工作台加入你想优先核对的提交。'}>{!listView ? <button className="primary-button" onClick={() => changeView('list')}>返回列表选择提交</button> : null}</Empty>}
          <footer className="list-footer"><span>{listView ? (repository ? '点击标识查看 14 个原始度量；预测解释未提供' : historical ? '点击标识查看原始度量；预测解释未提供' : '点击提交标识，查看改动与示例解释') : '加入清单仅代表你的审查计划'}</span><span><Icon name={listView ? 'list' : 'shortlist'} size={14} />{total} 条记录</span></footer>
        </section>
        {selected ? <CommitDetail data={data} id={selected} record={visible.find(record => record.id === selected)} added={shortlist.includes(selected)} onAdd={() => add(selected)} onClose={closeDetail} /> : null}
      </div>
      <p className="page-foot foot">{repository ? `仓库同步批次 · 模型估计` : historical ? (data.summary?.featureSchema ? `历史测试批次 · ${data.summary.featureSchema.name} 基线` : '历史测试批次 · 六字段基线') : '示例数据'} · 个人审查选择</p>
  </div>
}

function ModeResource({ loader, mode, workbench, syncId, token }: { loader: Loader; mode: Mode; workbench: WorkbenchState; syncId: string | null; token: string }) {
  const { resource, retry } = useDataset(loader, mode)
  const label = mode === 'repository' ? '仓库同步数据' : mode === 'historical' ? '真实历史回放' : '演示模式'
  if (resource.state === 'ready') return <Workbench key={contextKey(resource.data)} data={resource.data} {...workbench} syncId={syncId} token={token} />
  return <>
    <header className="page-head"><div className="page-head-main"><p className="meta"><span className="meta-item">JIT · 提交评审</span></p><h1>{label}</h1></div></header>
    {resource.state === 'loading'
      ? <LoadingNotice prefix={false} label={mode === 'repository' ? '正在读取同步作业与风险列表' : mode === 'historical' ? '正在读取真实历史提交' : '正在读取演示提交'} note="请稍候，读取完成后显示项目与数据版本。" />
      : <EmptyState tone="alert" title="数据不可用" description={resource.error}><button className="primary-button" onClick={retry}>重新加载</button></EmptyState>}
  </>
}

/**
 * 仓库模式缺少前提时的说明页：没有凭据或还没有选中同步作业时，宁可说清楚，
 * 也不要用空列表冒充"这次同步没有风险提交"。
 */
function RepositoryGate({ reason, navigate }: { reason: 'credential' | 'sync'; navigate: (route: Route) => void }) {
  return <>
    <header className="page-head"><div className="page-head-main"><p className="meta"><span className="meta-item">JIT · 提交评审</span></p><h1>仓库同步数据</h1></div></header>
    <EmptyState
      title={reason === 'credential' ? '需要团队凭据' : '还没有选择同步作业'}
      description={reason === 'credential' ? '仓库同步的提交与风险受成员凭据保护；在左侧输入凭据后再回到这里。' : '先同步一个公开仓库，或在数据来源页选择一个已完成的同步。'}
    >
      <button className="primary-button" onClick={() => navigate({ name: 'sources' })}>去数据来源</button>
    </EmptyState>
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
  const params = new URLSearchParams(window.location.search)
  const [mode, setMode] = useState<Mode>(() => initialMode ?? (params.get('mode') === 'demo' ? 'demo' : params.get('mode') === 'repository' ? 'repository' : 'historical'))
  // 仓库模式指向一次具体同步：地址上的 `sync` 是恢复入口（刷新后仍看同一批提交）。
  const [syncId, setSyncId] = useState<string | null>(() => params.get('sync'))
  const [created, setCreated] = useState<{ generation: number; result: PredictionResult } | null>(null)
  // 视图与清单由工作区持有：侧栏要显示清单数量，而侧栏在整个应用生命周期里只渲染一次。
  const [view, setView] = useState('list')
  const [selection, setSelection] = useState<{ ids: string[]; warning: string | null }>({ ids: [], warning: null })
  const { generation, token } = useCredential()
  // 更换或清除凭据后，上一份凭据下取得的受保护结果不再属于当前上下文（design D2）：在渲染时派生，
  // 而不是用副作用清空。
  const snapshot = created !== null && created.generation === generation ? created.result : null
  // loader 身份必须稳定：useDataset 以它作为重新加载的依据，每次渲染新建会反复请求。
  const repositorySource = useMemo(() => repositoryLoader(syncId ?? '', token), [syncId, token])

  function changeMode(next: Mode) {
    const url = new URL(window.location.href)
    url.searchParams.delete('mode')
    url.searchParams.delete('sync')
    if (next === 'demo') url.searchParams.set('mode', 'demo')
    if (next === 'repository') {
      url.searchParams.set('mode', 'repository')
      if (syncId !== null) url.searchParams.set('sync', syncId)
    }
    window.history.replaceState({}, '', url)
    setMode(next)
    if (next === 'repository') navigate({ name: 'sources' })
  }

  /** 从数据来源页带着一次已完成的同步进入工作台（任务 6.3）。 */
  function openSync(id: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('mode', 'repository')
    url.searchParams.set('sync', id)
    window.history.replaceState({}, '', url)
    setSyncId(id)
    setMode('repository')
    navigate({ name: 'workbench' })
  }

  const shell: ShellProps = { route, navigate, mode, onMode: changeMode, view, count: selection.ids.length, onView: setView }
  const workbench: WorkbenchState = { view, onView: setView, selection, onSelection: setSelection }

  let body: ReactNode
  if (route.name === 'sources') body = <RepositorySourcesPage onOpenSync={openSync} />
  else if (route.name === 'models') body = <ModelsPage />
  else if (route.name === 'trends') body = <TrendPage />
  else if (route.name === 'predict') body = <PredictPage onCreated={result => { setCreated({ generation, result }); navigate({ name: 'result', batchId: result.batchId }) }} />
  else if (route.name === 'open') body = <PredictionsPage navigate={navigate} batchId={null} snapshot={null} />
  else if (route.name === 'result') body = <PredictionsPage navigate={navigate} batchId={route.batchId} snapshot={snapshot} />
  else if (route.name === 'unknown') body = <UnknownRoute hash={route.hash} navigate={navigate} />
  else if (mode === 'repository' && (syncId === null || token === '')) {
    body = <RepositoryGate reason={syncId === null ? 'sync' : 'credential'} navigate={navigate} />
  } else {
    const selectedLoader = mode === 'repository' ? repositorySource : loaders?.[mode] ?? (mode === 'demo' ? (loader ?? demoLoader) : historicalLoader)
    // 仓库模式额外把同步身份与凭据代际计入 key：换凭据或换作业都从头加载，不复用上一份提交。
    const key = mode === 'repository' ? `${mode}:${generation}:${syncId ?? ''}` : mode
    body = <ModeResource key={key} mode={mode} loader={selectedLoader} workbench={workbench} syncId={syncId} token={token} />
  }

  // 应用壳只在这里渲染一次：路由切换与数据加载都不会重建侧栏，凭据输入与键盘焦点因此保持稳定。
  return <AppShell {...shell}>{body}</AppShell>
}

export default function App({ loader, initialMode, loaders }: { loader?: Loader; initialMode?: Mode; loaders?: Partial<Record<Mode, Loader>> }) {
  return <CredentialProvider><Workspace loader={loader} initialMode={initialMode} loaders={loaders} /></CredentialProvider>
}
