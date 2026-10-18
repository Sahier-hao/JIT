import { useEffect, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { contextKey, displayTime, emptyQuery, applyQuery, queryCommits, readSeedQuery, type Commit, type Dataset, type Mode } from './domain'
import { demoLoader, historicalLoader, useDataset, type Loader } from './useDataset'
import { useRepository, useRepositories } from './repositoryWorkspace'
import { ReviewWorkbench, type ReviewDraft } from './ReviewWorkbench'
import { AppShell, UnknownRoute, type ShellProps } from './AppShell'
import { RepositorySourcesPage } from './RepositorySourcesPage'
import { CredentialProvider } from './credentials'
import { useCredential } from './credentialContext'
import { EmptyState, FailureNotice, LoadingNotice } from './Feedback'
import { ModelsPage } from './ModelsPage'
import { PredictPage } from './PredictPage'
import { PredictionsPage } from './PredictionsPage'
import { TrendPage } from './TrendPage'
import type { PredictionResult } from './predictionContract'
import { hashFor, parseHash, legacyParameterError, useRoute, type Route } from './navigation'
import { BaselineRecord } from './BaselineRecord'
import { CommitDetail } from './CommitDetail'
import { Risk } from './Risk'
import { Icon } from './Icon'
import { restoreShortlist, saveShortlist, previewLegacyPlan, migrateLegacyPlan } from './shortlist'
import { SettingsPage } from './SettingsPage'
import { apiRequest } from './apiClient'
import { parseSync } from './repositoryContract'

function Empty({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <EmptyState title={title} description={description}>{children}</EmptyState>
}

function CommitTable({ records, selected, shortlist, listView, onOpen, onAdd, onRemove, modelRisk, truncate }: {
  records: Commit[]; selected: string | null; shortlist: string[]; listView: boolean; modelRisk: boolean; truncate: boolean;
  onOpen: (id: string, trigger: HTMLButtonElement) => void; onAdd: (id: string) => void; onRemove: (id: string) => void;
}) {
  return <div className="table-wrap"><table>
    <caption className="sr-only">{listView ? '提交风险列表' : '优先审查清单提交'}</caption>
    <thead><tr><th>提交 / 改动</th><th className="th-risk">{modelRisk ? '模型分数' : '示例风险'}</th><th>提交时间</th><th className="numeric">变更行</th><th className="numeric">文件</th><th className="action-head">审查选择</th></tr></thead>
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
  const real = data.mode !== 'demo'
  const label = historical ? '真实历史回放' : '演示模式'
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
      <p className="lede">{listView ? '从提交风险出发，确定下一次审查的重点。' : '保留值得优先核对的改动，按加入顺序安排审查。'}</p>
      {historical ? <p className="run-context"><strong>{data.model?.name}</strong><span>运行 <code>{data.runId}</code></span></p> : null}
    </div>
    <p className="stat"><strong>{listView ? total.toLocaleString() : count.toLocaleString()}</strong><span>{listView ? (historical ? '条测试提交' : '条演示提交') : '条审查选择'}</span></p>
  </header>
}

/** 数据来源说明：真实数据（历史回放或仓库同步）与演示数据的二分决定语气与图标。 */
function SourceNotice({ data }: { data: Dataset }) {
  const historical = data.mode === 'historical'
  return <div className="notice" data-tone={historical ? 'info' : 'warn'}>
    <Icon name={historical ? 'info' : 'warning'} size={16} />
    <div>
      <strong>{historical ? '公开历史数据 · 模型估计' : '当前为演示数据'}</strong>
      <span>{historical ? '回顾性评价；发布者历史观测标签，未验证当时标签可获得性。风险不等于已确认缺陷。' : '风险分数和解释均为人工示例，不表示真实预测或已确认缺陷。'}</span>
    </div>
  </div>
}

type LabDraft = { queryState: { draft: typeof emptyQuery; applied: typeof emptyQuery; error: string }; selected: string | null }
function Workbench({ data, view, onView, selection, onSelection, drafts: labDrafts }: {
  data: Dataset
  view: string
  onView: (view: string) => void
  selection: { ids: string[]; warning: string | null }
  onSelection: (selection: { ids: string[]; warning: string | null }) => void
  drafts: Map<string, LabDraft>
}) {
  const historical = data.mode === 'historical'
  // 实验室只接收历史回放或演示；仓库查询统一走固定分析工作区。
  const real = data.mode !== 'demo'
  // 地址上的日期是"查询种子"（CRR-05）：只在挂载时读一次，之后手动修改不写回地址。
  const [seed] = useState(() => readSeedQuery(window.location.search))
  const draftKey = contextKey(data) + window.location.search
  const [queryState, setQueryState] = useState(() => labDrafts.get(draftKey)?.queryState ?? { draft: seed.query, applied: seed.query, error: '' })
  const shortlist = selection.ids
  const [selected, setSelected] = useState<string | null>(() => labDrafts.get(draftKey)?.selected ?? null)
  useEffect(() => { labDrafts.set(draftKey, { queryState, selected }) }, [draftKey, queryState, selected, labDrafts])
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const listView = view === 'list'
  const visible: Commit[] = listView
    ? queryCommits(data.records, queryState.applied)
    : shortlist.flatMap(id => data.records.filter(record => record.id === id))
  const total = listView ? data.records.length : shortlist.length
  // 清单按数据上下文恢复：状态由 Workspace 持有（侧栏计数要用），所以在这里同步而不是用 useState 初始化。
  // 用 layout 效果是为了保持「首屏就是已恢复的清单」这一原有表现。
  const restored = useRef<string | null>(null)
  const context = contextKey(data)
  useLayoutEffect(() => {
    if (restored.current === context) return
    restored.current = context
    const saved = restoreShortlist(data)
    // 清单视图现在是独立路由：切过去会重新挂载 Workbench，此时 localStorage 里可能
    // 还没有内容（保存被拒绝或刚加入但未落盘），不能用空结果覆盖内存里的清单。
    onSelection(saved)
  }, [context, data, onSelection, selection.ids.length])
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
  const legacy = previewLegacyPlan(data)
  useEffect(() => { if (listView && selected && visible.length === 0) setSelected(null) }, [listView, selected, visible.length])
  return <div className="workbench">
      <PageHead data={data} listView={listView} count={shortlist.length} total={total} />

      <SourceNotice data={data} />

      <BaselineRecord data={data} />
      {legacy.warning ? <p role="status" className="warning">{legacy.warning}</p> : null}
      {legacy.ids.length ? <details className="legacy-preview"><summary>旧清单迁入预览（{legacy.ids.length} 条）</summary><ol>{legacy.ids.map(id => <li key={id}><code>{id}</code> · {data.records.some(record => record.id === id) ? '来源已核对' : '当前来源不存在'}</li>)}</ol><button onClick={() => { const warning = migrateLegacyPlan(data, legacy.ids.filter(id => data.records.some(record => record.id === id))); const saved = restoreShortlist(data); onSelection({ ids: warning ? shortlist : saved.ids, warning: warning || saved.warning }) }}>明确迁入已核对提交</button></details> : null}
      {!listView && shortlist.some(id => !data.records.some(record => record.id === id)) ? <p role="alert">部分计划项在当前来源中不存在，保留标识供核对：{shortlist.filter(id => !data.records.some(record => record.id === id)).map(id => <button key={id} onClick={() => changeShortlist(shortlist.filter(value => value !== id))}>移除失效项 {id}</button>)}</p> : null}
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
      <div className="section-caption"><span>{listView ? '提交风险列表' : '审查计划'}<b>{total}</b></span><span>时间：Asia/Shanghai (UTC+08:00){listView ? (queryState.applied.sort === 'risk' ? (real ? ' · 按模型分数排序' : ' · 按示例风险排序') : ' · 按时间排序') : ' · 按加入顺序'}</span></div>
      <div className={selected ? 'workbench-grid with-detail' : 'workbench-grid'}>
        <section className="list-panel" aria-label={listView ? '提交列表' : '清单列表'}>
          {visible.length
                ? <CommitTable modelRisk={real} truncate={historical} records={visible} selected={selected} shortlist={shortlist} listView={listView} onOpen={(id, trigger) => { returnFocus.current = trigger; setSelected(id) }} onAdd={add} onRemove={id => changeShortlist(shortlist.filter(value => value !== id))} />
                : <Empty title={listView ? (total ? '没有符合条件的提交' : '暂无提交') : '清单为空'} description={listView ? (total ? '使用上方「清除筛选」恢复列表，或尝试其他查询条件。' : '当前数据没有提交记录。') : '从工作台加入你想优先核对的提交。'}>{!listView ? <button className="primary-button" onClick={() => changeView('list')}>返回列表选择提交</button> : null}</Empty>}
          <footer className="list-footer"><span>{listView ? (historical ? '点击标识查看原始度量；预测解释未提供' : '点击提交标识，查看改动与示例解释') : '加入清单仅代表你的审查计划'}</span><span><Icon name={listView ? 'list' : 'shortlist'} size={14} />{total} 条记录</span></footer>
        </section>
        {selected ? <CommitDetail data={data} id={selected} record={visible.find(record => record.id === selected)} added={shortlist.includes(selected)} onAdd={() => add(selected)} onClose={closeDetail} /> : null}
      </div>
      <p className="page-foot foot">{historical ? (data.summary?.featureSchema ? `历史测试批次 · ${data.summary.featureSchema.name} 基线` : '历史测试批次 · 六字段基线') : '示例数据'} · 个人审查选择</p>
  </div>
}

function Workspace({ loader, initialMode, loaders }: { loader?: Loader; initialMode?: Mode; loaders?: Partial<Record<Mode, Loader>> }) {
  const { route, navigate } = useRoute()
  const routeSearch = window.location.search
  const legacyError = legacyParameterError(window.location.search, route)
  const legacyDemo = route.name === 'validation' && new URLSearchParams(window.location.search).get('mode') === 'demo'
  const { generation, token } = useCredential()
  const repositories = useRepositories(token)
  const [created, setCreated] = useState<{ generation: number; result: PredictionResult } | null>(null)
  const [labDrafts] = useState(() => new Map<string, LabDraft>())
  const [reviewDrafts] = useState(() => new Map<string, ReviewDraft>())
  const [selection, setSelection] = useState<{ ids: string[]; warning: string | null }>({ ids: [], warning: null })
  const [target, setTarget] = useState<Route | null>(() => {
    try { const raw = sessionStorage.getItem('jit.recentAnalysis'); const parsed = raw ? parseHash(raw) : null; return parsed?.name === 'analysis' ? parsed : null } catch { return null }
  })
  const remember = useCallback((destination: Route) => {
    setTarget(destination)
    try { sessionStorage.setItem('jit.recentAnalysis', hashFor(destination)) } catch { /* Continue in memory. */ }
  }, [])
  useEffect(() => {
    const params = new URLSearchParams(routeSearch)
    if (!legacyError && ['workbench', 'validation', 'shortlist'].includes(route.name) && params.get('sync')) { navigate({ name: 'legacy-sync', syncId: params.get('sync')!, view: route.name === 'shortlist' ? 'plan' : 'commits' }, true); return }
    if (legacyDemo && !legacyError) { navigate({ name: 'demo' }, true); return }
    if (route.name !== 'workbench' || legacyError) return
    if (params.get('mode') === 'repository' && params.get('sync')) return
    if (params.get('mode') === 'demo' || initialMode === 'demo') navigate({ name: 'demo' }, true)
    else if (params.get('mode') === 'historical' || initialMode === 'historical') navigate({ name: 'validation' }, true)
    else navigate({ name: 'repositories' }, true)
  }, [route.name, routeSearch, navigate, initialMode, legacyError, legacyDemo])
  const activeRepositoryId = route.name === 'analysis' || route.name === 'repository' ? route.repositoryId : target?.name === 'analysis' ? target.repositoryId : null
  const shell: ShellProps = { route, navigate, repositories: token ? repositories.items : [], repositoriesState: token ? repositories.state : 'idle', selectedRepositoryId: activeRepositoryId, shortlistCount: selection.ids.length, repositoryTarget: target }
  const protectedGate = <EmptyState title="连接团队后查看项目" description="仓库与预测使用团队成员凭据，公开历史验证可直接访问。"><button className="primary-button" onClick={() => navigate({ name: 'settings', page: 'connection', returnTo: hashFor(route) })}>设置团队连接</button><button className="clear-button" onClick={() => navigate({ name: 'validation' })}>浏览公开历史验证</button></EmptyState>
  let body: ReactNode
  if (legacyError) body = <EmptyState title="地址来源冲突" description={legacyError}><button onClick={() => navigate({ name: 'repositories' })}>返回项目入口</button></EmptyState>
  else if (route.name === 'settings') body = <SettingsPage route={route} navigate={navigate}/>
  else if (route.name === 'unknown') body = <UnknownRoute hash={route.hash} navigate={navigate}/>
  else if (route.name === 'sources') body = <RepositorySourcesPage key={generation} onOpenSync={(repositoryId, syncId) => navigate(syncId ? { name: 'analysis', repositoryId, viewSyncId: syncId, view: 'commits' } : { name: 'repository', repositoryId })}/>
  else if (route.name === 'models') body = <ModelsPage key={generation}/>
  else if (route.name === 'predict') body = <PredictPage key={generation} onCreated={result => { setCreated({ generation, result }); navigate({ name: 'result', batchId: result.batchId }) }}/>
  else if (route.name === 'open' || route.name === 'result') body = <PredictionsPage key={`${generation}:${route.name === 'result' ? route.batchId : ''}`} navigate={navigate} batchId={route.name === 'result' ? route.batchId : null} snapshot={created?.generation === generation ? created.result : null}/>
  else if (route.name === 'history' || route.name === 'validation' || route.name === 'trends' || route.name === 'demo') body = <LabResource drafts={labDrafts} route={legacyDemo ? { name: 'demo' } : route} navigate={navigate} loader={loader} loaders={loaders}/>
  else if (route.name === 'repository') body = token ? <RepositoryResolver key={`${generation}:${route.repositoryId}`} repositoryId={route.repositoryId} token={token} navigate={navigate}/> : protectedGate
  else if (route.name === 'analysis') body = token ? <ReviewWorkbench drafts={reviewDrafts} key={`${generation}:${route.repositoryId}:${route.viewSyncId}`} repositoryId={route.repositoryId} viewSyncId={route.viewSyncId} commitId={route.commitId} stateKey={`${generation}:${route.repositoryId}:${route.viewSyncId}`} view={route.view === 'plan' ? 'shortlist' : 'list'} token={token} navigate={navigate} selection={selection} onSelection={setSelection} onConfirmed={remember}/> : protectedGate
  else if (route.name === 'shortlist') body = target?.name === 'analysis' ? <LegacyPlan target={target} navigate={navigate}/> : <EmptyState title="选择审查计划的来源" description="旧地址没有仓库与分析身份，请先选择项目。"><button className="primary-button" onClick={() => navigate({ name: 'repositories' })}>选择项目</button></EmptyState>
  else if (route.name === 'legacy-sync') body = token ? <LegacySync syncId={route.syncId} view={route.view} token={token} navigate={navigate}/> : protectedGate
  else body = token ? <RepositoriesPage repositories={repositories} navigate={navigate}/> : protectedGate
  return <AppShell {...shell}>{body}</AppShell>
}

function LegacyPlan({ target, navigate }: { target: Extract<Route, { name: 'analysis' }>; navigate: ReturnType<typeof useRoute>['navigate'] }) {
  useEffect(() => navigate({ ...target, view: 'plan', commitId: undefined }, true), [target, navigate])
  return <LoadingNotice label="正在定位审查计划"/>
}
function LegacySync({ syncId, view, token, navigate }: { syncId: string; view: 'commits' | 'plan'; token: string; navigate: ReturnType<typeof useRoute>['navigate'] }) {
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const id = syncId
    apiRequest({ path: `/api/v1/repository-syncs/${encodeURIComponent(id)}`, method: 'GET', token }).then(parseSync).then(job => {
      if (!active) return
      if (job.syncId !== id || !job.repositoryId || job.status !== 'completed') throw new Error('旧同步地址未对应到可用的成功分析，请查看接入记录。')
      navigate({ name: 'analysis', repositoryId: job.repositoryId, viewSyncId: job.syncId, view }, true)
    }).catch(error => { if (active) setError(String(error.message ?? error)) })
    return () => { active = false }
  }, [token, navigate, syncId, view])
  return error ? <EmptyState title="无法定位旧同步" description={error}/> : <LoadingNotice label="正在核对旧同步来源"/>
}
function RepositoryResolver({ repositoryId, token, navigate }: { repositoryId: string; token: string; navigate: ReturnType<typeof useRoute>['navigate'] }) {
  const result = useRepository(repositoryId, token)
  useEffect(() => { if (result.state === 'ready' && result.repository?.viewContext) navigate({ name: 'analysis', repositoryId, viewSyncId: result.repository.viewContext.syncId, view: 'commits' }, true) }, [result.state, result.repository, repositoryId, navigate])
  if (result.state === 'error') return <EmptyState tone="alert" title="项目读取失败" description={result.error}><button onClick={result.retry}>重新加载</button></EmptyState>
  if (result.state === 'ready' && !result.repository?.viewContext) return <EmptyState title="还没有成功分析" description={result.repository?.latestSync ? `最近作业：${result.repository.latestSync.status}；${result.repository.latestSync.error?.message ?? '完成后可查看提交。'}` : '接入仓库并完成一次分析。'}><button className="primary-button" onClick={() => navigate({ name: 'sources' })}>查看接入记录</button></EmptyState>
  return <LoadingNotice label="正在定位最新成功分析"/>
}
function LabResource({ route, navigate, loader, loaders, drafts }: { route: Route; navigate: ReturnType<typeof useRoute>['navigate']; loader?: Loader; loaders?: Partial<Record<Mode, Loader>>; drafts: Map<string, LabDraft> }) {
  const demo = route.name === 'demo'
  const mode = demo ? 'demo' : 'historical'
  const selectedLoader = loaders?.[mode] ?? (demo ? loader ?? demoLoader : historicalLoader)
  const { resource, retry } = useDataset(selectedLoader, mode)
  const [selection, onSelection] = useState<{ ids: string[]; warning: string | null }>({ ids: [], warning: null })
  const [view, onView] = useState('list')
  useEffect(() => {
    if (resource.state === 'ready' && !demo && (route.name === 'validation' || route.name === 'trends') && resource.data.runId) navigate({ name: 'history', runId: resource.data.runId, view: route.name === 'trends' ? 'trends' : 'commits' }, true)
  }, [resource, route.name, demo, navigate])
  if (resource.state === 'loading') return <LoadingNotice label="正在读取实验来源"/>
  if (resource.state === 'error') return <EmptyState tone="alert" title="实验数据不可用" description={resource.error}><button onClick={retry}>重新加载</button></EmptyState>
  if (route.name === 'history' && route.runId !== resource.data.runId) return <EmptyState title="该历史运行未供给" description="服务目前配置的是另一运行；没有替换地址中指定的来源。"><button onClick={() => navigate({ name: 'validation' })}>查看当前供给运行</button></EmptyState>
  const runId = resource.data.runId
  return <section className="lab-workspace"><div className="tab-nav"><button onClick={() => onView('list')}>已分析提交</button><button onClick={() => onView('shortlist')}>审查计划（{selection.ids.length}）</button></div><header className="lab-context"><div><p className="eyebrow">{demo ? '交互演示' : '历史验证'}</p><h1>{resource.data.project}</h1><p className="muted">{demo ? '人工示例数据，只用于熟悉操作。' : '当前服务供给的公开历史运行；指标只描述这次回顾性评价。'}</p></div>{runId ? <nav className="tab-nav" aria-label="历史运行页面"><button aria-current={route.name !== 'history' || route.view === 'commits' ? 'page' : undefined} onClick={() => navigate({ name: 'history', runId, view: 'commits' })}>提交回放</button><button aria-current={route.name === 'history' && route.view === 'trends' ? 'page' : undefined} onClick={() => navigate({ name: 'history', runId, view: 'trends' })}>历史趋势</button></nav> : null}</header>
    {route.name === 'history' && route.view === 'trends' ? <TrendPage expectedRunId={route.runId} navigate={search => { const params = new URL(search, window.location.href).searchParams; const url = new URL(window.location.href); url.search = params.toString(); window.history.replaceState({}, '', url); navigate({ name: 'history', runId: route.runId, view: 'commits' }) }}/> : <Workbench drafts={drafts} key={contextKey(resource.data)} data={resource.data} view={view} onView={onView} selection={selection} onSelection={onSelection}/>}
  </section>
}

/** 仓库列表：验证之外的“从哪进来”。点一行进入该仓库的评审台。 */
function RepositoriesPage({ repositories, navigate }: { repositories: ReturnType<typeof useRepositories>; navigate: (route: Route) => void }) {
  if (repositories.state === 'loading') return <LoadingNotice label="正在读取仓库" note="请稍候。" />
  if (repositories.state === 'error') return <FailureNotice error={repositories.error} onRetry={repositories.retry} />
  if (repositories.items.length === 0) return <NoRepository token="" navigate={navigate} />
  return (
    <section className="stack">
      <header className="page-head">
        <div className="page-head-text">
          <p className="eyebrow">仓库与分析</p><h1>项目工作区</h1>
          <p className="page-sub">从一次成功分析开始审查，或接入新的仓库。</p>
        </div>
      <button className="primary-button" onClick={() => navigate({ name: 'sources' })}>接入仓库</button></header>
      <ul className="repo-list">
        {repositories.items.map(item => (
          <li key={item.repositoryId}>
            <button className="repo-row" onClick={() => navigate({ name: 'repository', repositoryId: item.repositoryId })}>
              <span className="repo-row-main">
                <b>{item.displayName}</b>
                <small>最近请求 {item.defaultBranch} · 最近同步 {item.latestSyncAt === null ? '从未' : displayTime(item.latestSyncAt)}</small>
              </span>
              <span className="repo-row-count">{item.commitCount} 个已分析提交</span>
              <span className="repo-row-bar" aria-hidden="true">
                <i data-tone="high" style={{ flex: item.distribution.high }} />
                <i data-tone="medium" style={{ flex: item.distribution.medium }} />
                <i data-tone="low" style={{ flex: item.distribution.low }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 没有仓库时的唯一下一步：去数据来源页接一个。 */
function NoRepository({ token, navigate }: { token: string; navigate: (route: Route) => void }) {
  return (
    <EmptyState title="还没有已同步的仓库" description={token === '' ? '在设置中输入团队凭据，再接入一个公开仓库。' : '接入一个公开仓库，分析完成后这里会出现它的提交。'}>
      <button className="primary-button" onClick={() => navigate({ name: 'sources' })}>接入仓库</button>
    </EmptyState>
  )
}

export default function App({ loader, initialMode, loaders }: { loader?: Loader; initialMode?: Mode; loaders?: Partial<Record<Mode, Loader>> }) {
  return <CredentialProvider><Workspace loader={loader} initialMode={initialMode} loaders={loaders} /></CredentialProvider>
}
