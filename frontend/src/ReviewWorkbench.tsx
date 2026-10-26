/** Fixed-analysis review: title-first list, inline plan and one detail panel. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { applyQuery, displayTime, emptyQuery, readSeedQuery, validRisk, type Commit, type Dataset, type Query } from './domain'
import { CommitDetail } from './CommitDetail'
import { EmptyState, LoadingNotice } from './Feedback'
import { Icon } from './Icon'
import type { Route } from './navigation'
import { restoreShortlist, saveShortlist, previewLegacyPlan, migrateLegacyPlan } from './shortlist'
import {
  useRepository,
  useRepositoryCommits,
  useRepositoryShortlist,
  type RepositoryDetail,
} from './repositoryWorkspace'
import { toCommit } from './domain'
import { DEGRADE_LABELS, STATUS_LABELS } from './repositoryContract'
import { useModelName } from './modelClient'
import { PlanTransfer } from './components/PlanTransfer'

const PAGE_SIZE = 20

/** 风险分档与三色一一对应：高 ≥25%、中 10–25%、低 <10%（repo-distribution-v1）。 */
function riskTone(risk: number | null | undefined): 'high' | 'medium' | 'low' | 'unknown' {
  if (risk === null || risk === undefined || !Number.isFinite(risk)) return 'unknown'
  if (risk >= 0.25) return 'high'
  if (risk >= 0.1) return 'medium'
  return 'low'
}

/** 旧数据里 risk 是 unknown，界面只接受 0–1 的有限数；其余按"未知"处理。 */
function safeRisk(value: unknown): number | null {
  return validRisk(value) ? value : null
}

function scoreText(risk: number | null | undefined): string {
  return risk === null || risk === undefined || !Number.isFinite(risk) ? '—' : risk.toFixed(2)
}

function RepositoryHead({ repository, total }: { repository: RepositoryDetail; total: number }) {
  const { high, medium, low, unknown } = repository.distribution
  const segments = [
    { key: 'high', value: high, label: '高' },
    { key: 'medium', value: medium, label: '中' },
    { key: 'low', value: low, label: '低' },
  ].filter(segment => segment.value > 0)
  return (
    <header className="review-head">
      <div className="review-head-main">
        <h1>{repository.displayName}</h1>
        <p className="t-meta">
          {repository.viewContext?.completedAt ? `分析完成 ${displayTime(repository.viewContext.completedAt)}` : '旧分析未记录完成时间'}
          <span className="meta-sep" aria-hidden="true">·</span>
          {repository.viewContext?.branch ?? '未提供'} 分支
          <span className="meta-sep" aria-hidden="true">·</span>
          {total.toLocaleString()} 个已分析提交
        </p>
      </div>
      <div className="dist-wrap">
        <div
          className="dist"
          role="img"
          aria-label={`风险分布：高 ${high}，中 ${medium}，低 ${low}${unknown ? `，未知 ${unknown}` : ''}`}
        >
          {segments.length === 0
            ? <i className="dist-empty" />
            : segments.map(segment => (
              <i key={segment.key} className={`dist-${segment.key}`} style={{ flex: segment.value }} />
            ))}
        </div>
        <p className="dist-legend">
          <span className="dist-high-fg">高 {high}</span>
          <span className="dist-medium-fg">中 {medium}</span>
          <span className="dist-low-fg">低 {low}</span>
        </p>
      </div>
    </header>
  )
}

function ReviewTable({ commits, shortlist, onOpen, onAdd, onRemove }: {
  commits: Commit[]
  shortlist: string[]
  onOpen: (id: string, trigger: HTMLButtonElement) => void
  onAdd: (id: string) => void
  onRemove?: (id: string) => void
}) {
  return (
    <div className="review-table-wrap">
      <div className="table-scroll"><table className="review-table">
        <caption className="sr-only">仓库提交风险列表，按模型分数从高到低</caption>
        <thead>
          <tr>
            <th>提交 / 改动</th>
            <th className="th-risk">模型分数</th>
            <th className="numeric">变更行</th>
            <th className="numeric">文件</th>
            <th className="action-head"><span className="sr-only">审查选择</span></th>
          </tr>
        </thead>
        <tbody>
          {commits.map(commit => {
            return (
              <tr key={commit.id} data-tone={riskTone(safeRisk(commit.risk))}>
                <td className="commit-cell">
                  <i className="row-mark" aria-hidden="true" />
                  <button
                    className="commit-link"
                    title={commit.id}
                    aria-label={`查看 ${commit.id}`}
                    onClick={event => onOpen(commit.id, event.currentTarget)}
                  >
                    <span className="commit-title">{commit.title || '未提供标题'}</span><code>{commit.id.slice(0, 8)}</code>
                  </button>
                  <span className="commit-meta">
                    <span>{commit.authorName || '作者未提供'} · </span>
                    <time dateTime={commit.time}>{displayTime(commit.time).slice(0, 16)}</time>
                  </span>
                </td>
                <td className="risk-cell">
                  <b className="risk-value">{scoreText(safeRisk(commit.risk))}</b>
                  <span className="risk-track" aria-hidden="true">
                    <i style={{ width: `${Math.round((safeRisk(commit.risk) ?? 0) * 100)}%` }} className="risk-fill" />
                  </span>
                </td>
                <td className="numeric">{commit.lines === undefined ? '—' : commit.lines.toLocaleString()}</td>
                <td className="numeric">{commit.files === undefined ? '—' : commit.files.toLocaleString()}</td>
                <td className="action-cell">
                  <button
                    className="row-action"
                    aria-label={onRemove ? `从计划移除 ${commit.id}` : shortlist.includes(commit.id) ? `${commit.id} 已在清单` : `加入 ${commit.id} 到清单`}
                    disabled={!onRemove && shortlist.includes(commit.id)}
                    onClick={() => onRemove ? onRemove(commit.id) : onAdd(commit.id)}
                  >
                    <Icon name={onRemove ? 'close' : shortlist.includes(commit.id) ? 'check' : 'plus'} size={14} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table></div>
    </div>
  )
}

export interface ReviewWorkbenchProps {
  repositoryId: string
  viewSyncId: string
  commitId?: string
  stateKey: string
  onConfirmed: (route: Route) => void
  drafts: Map<string, ReviewDraft>
  view: 'list' | 'shortlist'
  selection: { ids: string[]; warning: string | null }
  onSelection: (selection: { ids: string[]; warning: string | null }) => void
  navigate: (route: Route) => void
}

export type ReviewDraft = { draft: Query; applied: Query; error: string; offset: number; detailReturn?: 'commits' | 'plan' }
export function ReviewWorkbench({ repositoryId, viewSyncId, commitId, stateKey, onConfirmed, drafts: reviewDrafts, view, selection, onSelection, navigate }: ReviewWorkbenchProps) {
  const repository = useRepository(repositoryId, viewSyncId)
  const modelName = useModelName(repository.repository?.modelId)
  const [seed] = useState(() => readSeedQuery(window.location.search))
  const [queryState, setQueryState] = useState(() => reviewDrafts.get(stateKey) ?? { draft: seed.query, applied: seed.query, error: '' })
  const [offset, setOffset] = useState(() => reviewDrafts.get(stateKey)?.offset ?? 0)
  const selected = commitId ?? null
  const detailReturn = useRef<'commits' | 'plan'>(reviewDrafts.get(stateKey)?.detailReturn ?? (view === 'shortlist' ? 'plan' : 'commits'))
  const setSelected = useCallback((id: string | null) => {
    if (id && !selected) detailReturn.current = view === 'shortlist' ? 'plan' : 'commits'
    navigate({ name: 'analysis', repositoryId, viewSyncId, view: id ? 'commits' : detailReturn.current, ...(id ? { commitId: id } : {}) })
  }, [navigate, repositoryId, viewSyncId, selected, view])
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const shortlist = selection.ids
  const listView = view === 'list'
  const page = useRepositoryCommits(repository.repository ? repositoryId : '', queryState.applied, offset, PAGE_SIZE, viewSyncId)
  const shortlistRecords = useRepositoryShortlist(repositoryId, listView ? [] : shortlist, viewSyncId)
  const detailRecords = useRepositoryShortlist(repositoryId, selected ? [selected] : [], viewSyncId)
  const totalMismatch = page.state === 'ready' && !queryState.applied.search.trim() && !queryState.applied.start && !queryState.applied.end && repository.repository !== null && page.total !== repository.repository.commitCount
  const visible: Commit[] = listView ? (totalMismatch ? [] : page.commits.map(toCommit)) : shortlist.flatMap(id => {
    const record = shortlistRecords.records.get(id)
    return record ? [record] : []
  })
  const dataset: Dataset = useMemo(() => ({
    mode: 'repository',
    project: repository.repository?.displayName ?? '',
    version: repository.repository?.datasetVersion ?? '未登记数据集',
    records: [],
    repository: repository.repository ? {
      modelId: repository.repository.modelId,
      runId: repository.repository.runId,
      repositoryId,
      syncId: viewSyncId,
      repositoryUrl: repository.repository.url,
      branch: repository.repository.viewContext?.branch ?? '未提供',
      datasetVersion: repository.repository.datasetVersion ?? '',
      requestedStrategy: 'auto',
      modelStrategy: repository.repository.modelStrategy ?? null,
      degradeReason: repository.repository.degradeReason ?? null,
      trainRecords: null,
      trainPositives: null,
      labelNote: '标签由简化 SZZ 从后续修复提交倒推',
    } : undefined,
  }), [repository.repository, repositoryId, viewSyncId])
  useEffect(() => { reviewDrafts.set(stateKey, { ...queryState, offset, detailReturn: detailReturn.current }) }, [stateKey, queryState, offset, commitId, reviewDrafts])
  useEffect(() => { if (repository.state === 'ready') onConfirmed({ name: 'analysis', repositoryId, viewSyncId, view: view === 'shortlist' ? 'plan' : 'commits', ...(commitId ? { commitId } : {}) }) }, [repository.state, repositoryId, viewSyncId, commitId, view, onConfirmed])
  const legacy = repository.repository ? previewLegacyPlan(dataset) : { ids: [], warning: '' }
  const legacyRecords = useRepositoryShortlist(repositoryId, legacy.ids, viewSyncId)

  function updateQuery(patch: Partial<Query>) {
    setOffset(0)
    setQueryState(previous => {
      const draft = { ...previous.draft, ...patch }
      const result = applyQuery(previous.applied, draft)
      return { draft, applied: result.query, error: result.error }
    })
  }

  function clearQuery() {
    setOffset(0)
    setQueryState({ draft: emptyQuery, applied: emptyQuery, error: '' })
  }

  function changeShortlist(ids: string[]) {
    onSelection({ ids, warning: saveShortlist(dataset, ids) })
  }

  function add(id: string) {
    if (!shortlist.includes(id)) changeShortlist([...shortlist, id])
  }

  function mergePlan(ids: string[]): string {
    const stored = restoreShortlist(dataset)
    if (stored.warning) return '原计划存储无法读取，未覆盖；请先保留原数据并恢复浏览器存储后重试。'
    const merged = [...new Set([...shortlist, ...stored.ids, ...ids])]
    const warning = saveShortlist(dataset, merged)
    if (warning) return '浏览器未能保存合并计划，原计划保持不变；请释放存储空间或恢复写入权限后重试。'
    onSelection({ ids: merged, warning: '' })
    return ''
  }

  function closeDetail() {
    const id = selected
    setSelected(null)
    requestAnimationFrame(() => {
      const target = returnFocus.current?.isConnected ? returnFocus.current : Array.from(document.querySelectorAll<HTMLButtonElement>('button[title]')).find(button => button.title === id)
      if (target) target.focus()
      else document.getElementById('product-main')?.focus()
    })
  }
  useEffect(() => {
    if (listView && selected && page.state === 'ready' && page.total === 0) setSelected(null)
  }, [listView, selected, page.state, page.total, setSelected])

  // 清单按仓库恢复：状态由 Workspace 持有（侧栏计数要用），所以这里同步而不是初始化。
  const restored = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!repository.repository || restored.current === stateKey) return
    restored.current = stateKey
    onSelection(restoreShortlist(dataset))
  }, [stateKey, dataset, repository.repository, onSelection])

  if (repository.state === 'loading' && repository.repository === null) {
    return <LoadingNotice prefix={false} label="正在读取仓库" note="读取仓库详情、风险分布与提交列表。" />
  }
  if (repository.state === 'error') {
    return (
      <EmptyState tone="alert" title="仓库读取失败" description={repository.error}>
        <button className="primary-button" onClick={repository.retry}>重新加载</button>
      </EmptyState>
    )
  }
  if (repository.repository === null) {
    return (
      <EmptyState title="仓库不存在" description="这个地址对应的仓库已经不在目录里。">
        <button className="primary-button" onClick={() => navigate({ name: 'repositories' })}>查看全部仓库</button>
      </EmptyState>
    )
  }

  const repo = repository.repository
  const total = listView ? page.total : shortlist.length
  const first = page.total === 0 ? 0 : offset + 1
  const last = Math.min(offset + PAGE_SIZE, page.total)

  return (
    <div className={listView ? 'review' : 'review review--shortlist'}>
      <button className="back-link" onClick={() => navigate({ name: 'repository', repositoryId })} aria-label={`返回项目 ${repo.displayName}`} title={`返回项目 ${repo.displayName}`}><Icon name="collapse" size={16}/>返回项目</button>
      <RepositoryHead repository={repo} total={repo.commitCount} />
      <details className="analysis-source"><summary><span className="source-chip">仓库分析 · {repo.viewContext?.branch ?? '分支未提供'}</span><span>分析来源 <Icon name="chevron" size={13}/></span></summary>      <div className="analysis-context"><span>分析 <code>{viewSyncId}</code></span><span>HEAD <code>{repo.viewContext?.headCommit ?? '旧记录未提供'}</code></span><span>数据 <code>{repo.datasetVersion ?? '未提供'}</code></span><span>模型 <code>{repo.modelId ?? '未提供'}</code></span><span>运行 <code>{repo.runId ?? '未提供'}</code></span><span>{repo.modelStrategy === 'generic-model' ? '通用模型' : repo.modelStrategy === 'repository-trained' ? '仓库模型' : '模型来源未提供'}{repo.degradeReason ? ` · ${DEGRADE_LABELS[repo.degradeReason] ?? repo.degradeReason}` : ''}</span></div>
</details>
      {repo.latestSync?.syncId !== viewSyncId ? <p className="status-note">最近作业：{repo.latestSync ? STATUS_LABELS[repo.latestSync.status] : '未提供'}。当前仍查看固定的成功分析。<button onClick={() => navigate({ name: 'repository', repositoryId })}>检查最新成功分析</button></p> : null}
      <p className="muted">{modelName ? `分析模型：${modelName}。` : ''}模型分数用于安排审查，未经当前仓库概率校准；不代表已确认缺陷。可在提交详情主动生成原模型解释。</p>
      {selection.warning ? <p className="warning" role="alert">{selection.warning}</p> : null}
      {legacy.warning ? <p role="status" className="warning">{legacy.warning}</p> : null}
      {legacy.ids.length ? <details className="legacy-preview"><summary>发现本分析的旧清单（{legacy.ids.length} 条），预览迁入</summary><p>只迁入经当前仓库分析核对的提交；保留旧存储。{legacyRecords.failed.length} 条无法核对。</p><ol>{legacy.ids.map(id => <li key={id}><code>{id}</code> · {legacyRecords.records.has(id) ? '来源已核对' : '未核对'}</li>)}</ol><button disabled={legacyRecords.state !== 'ready'} onClick={() => { const warning = migrateLegacyPlan(dataset, legacy.ids.filter(id => legacyRecords.records.has(id))); const restored = restoreShortlist(dataset); onSelection({ ids: warning ? shortlist : restored.ids, warning: warning || restored.warning }) }}>明确迁入已核对提交</button></details> : null}

      <nav className="view-tabs" aria-label="分析结果视图"><button aria-current={listView ? 'page' : undefined} onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId, view: 'commits' })}>全部提交 <span>{repo.commitCount}</span></button><button aria-current={!listView ? 'page' : undefined} onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId, view: 'plan' })}>审查计划 <span>{shortlist.length}</span></button></nav>
      {!listView ? <PlanTransfer key={`${repositoryId}:${viewSyncId}`} source={{ repositoryId, viewSyncId, datasetVersion: repo.datasetVersion, modelId: repo.modelId, runId: repo.runId }} ids={shortlist} onMerge={mergePlan}/> : null}
      {!listView && shortlist.length ? <div className="plan-summary"><span>已选 {shortlist.length} 条 · 已知规模 {Array.from(shortlistRecords.records.values()).reduce((sum, record) => sum + (record.lines ?? 0), 0).toLocaleString()} 行{shortlist.filter(id => shortlistRecords.records.get(id)?.lines === undefined).length ? ' · 部分规模未提供' : ''}</span><button className="text-button" onClick={() => changeShortlist([])}>清空计划</button></div> : null}
      <div className={selected ? 'review-body has-detail' : 'review-body'}>
        <section className="review-main" aria-label={listView ? '已分析提交' : '审查清单'}>
          {listView ? (
            <>
              <div className="review-toolbar" role="search" aria-label="提交筛选">
                <label className="search-field">
                  <Icon name="search" size={14} />
                  <input
                    aria-label="搜索提交标题或 SHA"
                    placeholder="搜索提交标题或 SHA"
                    value={queryState.draft.search}
                    onChange={event => updateQuery({ search: event.target.value })}
                  />
                </label>
                <label className="date-field">起始日期
                  <input
                    aria-label="起始日期"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    value={queryState.draft.start}
                    aria-invalid={!!queryState.error}
                    onChange={event => updateQuery({ start: event.target.value })}
                  />
                </label>
                <label className="date-field">结束日期
                  <input
                    aria-label="结束日期"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    value={queryState.draft.end}
                    aria-invalid={!!queryState.error}
                    onChange={event => updateQuery({ end: event.target.value })}
                  />
                </label>
                <label className="sort-field">排序
                  <select aria-label="排序" value={queryState.draft.sort} onChange={event => updateQuery({ sort: event.target.value })}>
                    <option value="risk">风险从高到低</option>
                    <option value="time">时间从新到旧</option>
                  </select>
                </label>
                <button className="clear-button" onClick={clearQuery}>清除筛选</button>
              </div>
              {queryState.error ? <p className="warning" role="alert">{queryState.error} 当前保留最近一次有效结果。</p> : null}
              <p className="review-caption">
                <span>提交 / 改动<b>{page.total.toLocaleString()}</b></span>
                <span>时间口径 Asia/Shanghai (UTC+08:00) · 按{queryState.applied.sort === 'risk' ? '模型分数' : '时间'}排序</span>
              </p>
              {page.state === 'loading' && visible.length === 0
                ? <LoadingNotice prefix={false} label="正在读取提交" note="按当前筛选条件从服务端读取这一页。" />
                : page.state === 'error' || totalMismatch
                  ? <EmptyState tone="alert" title="提交读取失败" description={totalMismatch ? '提交总数与固定分析不一致，请重新加载核对。' : page.error}><button className="primary-button" onClick={page.retry}>重新加载</button></EmptyState>
                  : visible.length === 0
                    ? <EmptyState title="没有符合条件的提交" description="使用「清除筛选」恢复列表，或换一个查询条件。" />
                    : <>
                      <ReviewTable
                        commits={visible}
                        shortlist={shortlist}
                        onOpen={(id, trigger) => { returnFocus.current = trigger; setSelected(id) }}
                        onAdd={add}
                      />
                      <nav className="pager" aria-label="提交分页">
                        <span role="status">第 {first}–{last} 条，共 {page.total.toLocaleString()} 条</span>
                        <button className="clear-button" disabled={offset === 0 || page.state === 'loading'} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</button>
                        <button className="clear-button" disabled={offset + PAGE_SIZE >= page.total || page.state === 'loading'} onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</button>
                      </nav>
                    </>}
            </>
          ) : (
            <>
              {selection.warning ? <p className="warning" role="alert">{selection.warning}</p> : null}
              {shortlistRecords.failed.length > 0
                ? <p className="warning" role="alert">清单中有 {shortlistRecords.failed.length.toLocaleString()} 条不在当前视图里，已跳过显示；可在条目中移除。</p>
                : null}
              <p className="review-caption"><span>审查计划<b>{total}</b></span><span>按加入顺序 · 缺少成本分母，不显示预算占比</span></p>
              {visible.length === 0
                ? <EmptyState title="清单为空" description="从评审台把要优先核对的提交加进来。"><button className="primary-button" onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId, view: 'commits' })}>返回评审台</button></EmptyState>
                : <ReviewTable commits={visible} shortlist={shortlist} onOpen={(id, trigger) => { returnFocus.current = trigger; setSelected(id) }} onAdd={add} onRemove={id => changeShortlist(shortlist.filter(value => value !== id))} />}
            </>
          )}
          <p className="review-foot">
            {listView ? '点击提交查看原始度量，并可主动生成原模型解释' : '加入清单仅代表你的审查计划'}
          </p>
        </section>

      {selected ? (
        <CommitDetail
          data={dataset}
          id={selected}
          record={detailRecords.records.get(selected) ?? visible.find(record => record.id === selected)}
          added={shortlist.includes(selected)}
          onAdd={() => add(selected)}
          onClose={closeDetail}
        />
      ) : null}
      </div>
    </div>
  )
}
