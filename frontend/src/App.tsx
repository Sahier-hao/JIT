import { useRef, useState, type ReactNode } from 'react'
import { contextKey, displayTime, emptyQuery, applyQuery, queryCommits, type Commit, type Dataset, type Mode } from './domain'
import { demoLoader, historicalLoader, useDataset, type Loader } from './useDataset'
import { BaselineRecord } from './BaselineRecord'
import { CommitDetail } from './CommitDetail'
import { Risk } from './Risk'
import { Icon } from './Icon'
import { restoreShortlist, saveShortlist } from './shortlist'
import './App.css'

function Sidebar({ view, count, onView, mode, onMode }: { view: string; count: number; onView?: (view: string) => void; mode: Mode; onMode: (mode: Mode) => void }) {
  return <aside className="sidebar">
    <div className="brand"><span className="brand-mark"><Icon name="logo" size={25} /></span><div>JIT Review<span>提交风险评审</span></div></div>
    <div className="mode-switch" role="group" aria-label="数据模式"><button aria-label="选择真实历史回放" aria-pressed={mode === 'historical'} onClick={() => onMode('historical')}>历史数据</button><button aria-label="选择演示模式" aria-pressed={mode === 'demo'} onClick={() => onMode('demo')}>示例数据</button></div>
    <div className="nav-label">工作空间</div>
    <nav aria-label="工作台导航">
      <button className={view === 'list' ? 'nav-item active' : 'nav-item'} aria-current={view === 'list' ? 'page' : undefined} disabled={!onView} onClick={() => onView?.('list')}><Icon name="list" />提交工作台</button>
      <button className={view === 'shortlist' ? 'nav-item active' : 'nav-item'} aria-current={view === 'shortlist' ? 'page' : undefined} disabled={!onView} onClick={() => onView?.('shortlist')}><Icon name="shortlist" />优先审查清单 <b>{count}</b></button>
    </nav>
    <div className="sidebar-foot"><div className="workspace-avatar"><Icon name="logo" size={18} /></div><div>个人工作空间<small>清单保存在当前浏览器</small></div></div>
  </aside>
}

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

function Workbench({ data, onMode }: { data: Dataset; onMode: (mode: Mode) => void }) {
  const historical = data.mode === 'historical'
  const [view, setView] = useState('list')
  const [queryState, setQueryState] = useState({ draft: emptyQuery, applied: emptyQuery, error: '' })
  const [selection, setSelection] = useState(() => restoreShortlist(data))
  const shortlist = selection.ids
  const [selected, setSelected] = useState<string | null>(null)
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const listView = view === 'list'
  const visible = listView ? queryCommits(data.records, queryState.applied) : shortlist.flatMap(id => data.records.filter(record => record.id === id))
  function updateQuery(patch: Partial<typeof emptyQuery>) {
    setQueryState(previous => {
      const draft = { ...previous.draft, ...patch }
      const result = applyQuery(previous.applied, draft)
      return { draft, applied: result.query, error: result.error }
    })
  }
  function clearQuery() { setQueryState({ draft: emptyQuery, applied: emptyQuery, error: '' }) }
  function closeDetail() { setSelected(null); returnFocus.current?.focus() }
  function changeView(next: string) { setView(next); setSelected(null) }
  function changeShortlist(ids: string[]) { setSelection({ ids, warning: saveShortlist(data, ids) }) }
  function add(id: string) { if (!shortlist.includes(id) && data.records.some(record => record.id === id)) changeShortlist([...shortlist, id]) }
  return <div className="app">
    <Sidebar view={view} count={shortlist.length} onView={changeView} mode={data.mode} onMode={onMode} />
    <main className="main">
      <header className="topbar"><div><span className="project-symbol"><Icon name="project" /></span><strong>{data.project}</strong><Icon name="chevron" size={14} /><span>{listView ? '提交工作台' : '审查清单'}</span></div><div className="source-meta"><span className={historical ? 'demo-badge historical-badge' : 'demo-badge'}><span />{historical ? '真实历史回放' : '演示模式'}</span><code title={data.version}>{data.version}</code></div></header>
      {historical ? <div className="run-context"><span>{data.model?.name}</span><span>运行 <code title={data.runId}>{data.runId}</code></span></div> : null}
      <div className="page-heading"><div><h1>{listView ? '提交评审' : '优先审查清单'}</h1><p className="page-intro">{listView ? '从提交风险出发，确定下一次审查的重点。' : '保留值得优先核对的改动，按加入顺序安排审查。'}</p></div><div className="record-count"><Icon name={listView ? 'list' : 'shortlist'} size={20} /><div><strong>{listView ? data.records.length.toLocaleString() : shortlist.length}</strong><span>{listView ? (historical ? '条测试提交' : '条演示提交') : '条审查选择'}</span></div></div></div>
      <div className={historical ? 'demo-notice historical-notice' : 'demo-notice'}><Icon name="info" size={17} /><div><strong>{historical ? '公开历史数据 · 模型估计' : '当前为演示数据'}</strong><span>{historical ? '回顾性评价；发布者历史观测标签，未验证当时标签可获得性。风险不等于已确认缺陷。' : '风险分数和解释均为人工示例，不表示真实预测或已确认缺陷。'}</span></div></div>
      <BaselineRecord data={data} />
      {selection.warning ? <p className="warning storage-warning" role="alert">{selection.warning}</p> : null}
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
    </main>
  </div>
}

function ModeResource({ loader, mode, onMode }: { loader: Loader; mode: Mode; onMode: (mode: Mode) => void }) {
  const { resource, retry } = useDataset(loader, mode)
  if (resource.state === 'ready') return <Workbench key={contextKey(resource.data)} data={resource.data} onMode={onMode} />
  return <div className="app"><Sidebar view="list" count={0} mode={mode} onMode={onMode} /><main className="main"><header className="topbar">JIT · 提交评审 · {mode === 'historical' ? '真实历史回放' : '演示模式'}</header>{resource.state === 'loading' ? <div role="status"><Empty title={mode === 'historical' ? '正在读取真实历史提交' : '正在读取演示提交'} description="请稍候，读取完成后显示项目与数据版本。" /></div> : <div role="alert"><Empty title="数据不可用" description={resource.error}><button className="primary-button" onClick={retry}>重新加载</button></Empty></div>}</main></div>
}
export default function App({ loader, initialMode, loaders }: { loader?: Loader; initialMode?: Mode; loaders?: Partial<Record<Mode, Loader>> }) {
  const [mode, setMode] = useState<Mode>(() => initialMode ?? (new URLSearchParams(window.location.search).get('mode') === 'demo' ? 'demo' : 'historical'))
  function changeMode(next: Mode) {
    const url = new URL(window.location.href)
    if (next === 'demo') url.searchParams.set('mode', 'demo'); else url.searchParams.delete('mode')
    window.history.replaceState({}, '', url)
    setMode(next)
  }
  const selectedLoader = loaders?.[mode] ?? (mode === 'demo' ? (loader ?? demoLoader) : historicalLoader)
  return <ModeResource key={mode} mode={mode} loader={selectedLoader} onMode={changeMode} />
}
