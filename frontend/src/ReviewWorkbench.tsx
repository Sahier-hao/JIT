/** Fixed-analysis review: title-first list, inline plan and one detail panel. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { toCommit, type Commit, type Dataset, type Query } from './domain'
import { patchQuery, resetQuery, type ReviewDraft } from './state/reviewDraft'
import { CommitDetail } from './CommitDetail'
import { RepositoryHead } from './components/review/RepositoryHead'
import { ReviewTable } from './components/review/ReviewTable'
import { EmptyState, LoadingNotice } from './Feedback'
import { Icon } from './Icon'
import type { Route } from './navigation'
import { restoreShortlist, saveShortlist, previewLegacyPlan, migrateLegacyPlan } from './state/planStorage'
import {
  useRepository,
  useRepositoryCommits,
  useRepositoryShortlist,
} from './repositoryWorkspace'
import { DEGRADE_LABELS, STATUS_LABELS } from './api/repositories'

const PAGE_SIZE = 20

export interface ReviewWorkbenchProps {
  repositoryId: string
  viewSyncId: string
  commitId?: string
  stateKey: string
  onConfirmed: (route: Route) => void
  /** 界面状态由 App 持有：筛选、分页、详情返回位置都只有这一份。 */
  value: ReviewDraft
  onChange: (next: ReviewDraft) => void
  view: 'list' | 'shortlist'
  selection: { ids: string[]; warning: string | null }
  onSelection: (selection: { ids: string[]; warning: string | null }) => void
  navigate: (route: Route) => void
}

export function ReviewWorkbench({ repositoryId, viewSyncId, commitId, stateKey, onConfirmed, value, onChange, view, selection, onSelection, navigate }: ReviewWorkbenchProps) {
  const repository = useRepository(repositoryId, viewSyncId)
  const selected = commitId ?? null
  const setSelected = useCallback((id: string | null) => {
    if (id && !selected) onChange({ ...value, detailReturn: view === 'shortlist' ? 'plan' : 'commits' })
    navigate({ name: 'analysis', repositoryId, viewSyncId, view: id ? 'commits' : value.detailReturn, ...(id ? { commitId: id } : {}) })
  }, [navigate, repositoryId, viewSyncId, selected, view, value, onChange])
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const shortlist = selection.ids
  const listView = view === 'list'
  const page = useRepositoryCommits(repository.repository ? repositoryId : '', value.applied, value.offset, PAGE_SIZE, viewSyncId)
  const shortlistRecords = useRepositoryShortlist(repositoryId, listView ? [] : shortlist, viewSyncId)
  const detailRecords = useRepositoryShortlist(repositoryId, selected ? [selected] : [], viewSyncId)
  const totalMismatch = page.state === 'ready' && !value.applied.search.trim() && !value.applied.start && !value.applied.end && repository.repository !== null && page.total !== repository.repository.commitCount
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
  useEffect(() => { if (repository.state === 'ready') onConfirmed({ name: 'analysis', repositoryId, viewSyncId, view: view === 'shortlist' ? 'plan' : 'commits', ...(commitId ? { commitId } : {}) }) }, [repository.state, repositoryId, viewSyncId, commitId, view, onConfirmed])
  const legacy = repository.repository ? previewLegacyPlan(dataset) : { ids: [], warning: '' }
  const legacyRecords = useRepositoryShortlist(repositoryId, legacy.ids, viewSyncId)

  function updateQuery(patch: Partial<Query>) {
    onChange(patchQuery(value, patch))
  }

  function clearQuery() {
    onChange(resetQuery(value))
  }

  function changeShortlist(ids: string[]) {
    onSelection({ ids, warning: saveShortlist(dataset, ids) })
  }

  function add(id: string) {
    if (!shortlist.includes(id)) changeShortlist([...shortlist, id])
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
  if (repository.state === 'error' && repository.repository === null) {
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
  const first = page.total === 0 ? 0 : value.offset + 1
  const last = Math.min(value.offset + PAGE_SIZE, page.total)

  return (
    <div className={listView ? 'review' : 'review review--shortlist'}>
      <RepositoryHead repository={repo} total={repo.commitCount} />
      <details className="analysis-source"><summary><span className="source-chip">仓库分析 · {repo.viewContext?.branch ?? '分支未提供'}</span><span>分析来源 <Icon name="chevron" size={13}/></span></summary>      <div className="analysis-context"><span>分析 <code>{viewSyncId}</code></span><span>HEAD <code>{repo.viewContext?.headCommit ?? '旧记录未提供'}</code></span><span>数据 <code>{repo.datasetVersion ?? '未提供'}</code></span><span>模型 <code>{repo.modelId ?? '未提供'}</code></span><span>运行 <code>{repo.runId ?? '未提供'}</code></span><span>{repo.modelStrategy === 'generic-model' ? '通用模型' : repo.modelStrategy === 'repository-trained' ? '仓库模型' : '模型来源未提供'}{repo.degradeReason ? ` · ${DEGRADE_LABELS[repo.degradeReason] ?? repo.degradeReason}` : ''}</span></div>
</details>
      {repo.latestSync?.syncId !== viewSyncId ? <p className="status-note">最近作业：{repo.latestSync ? STATUS_LABELS[repo.latestSync.status] : '未提供'}。当前仍查看固定的成功分析。<button onClick={() => navigate({ name: 'repository', repositoryId })}>检查最新成功分析</button></p> : null}
      <p className="muted">模型分数用于安排审查，未经当前仓库概率校准；不代表已确认缺陷。仓库分析未提供逐条模型归因。</p>
      {repository.state === 'error' ? <p className="warning" role="status">刷新仓库详情失败：{repository.error} 当前仍显示最近一次成功读取的结果。<button className="text-button" onClick={repository.retry}>重试</button></p> : null}
      {selection.warning ? <p className="warning" role="alert">{selection.warning}</p> : null}
      {legacy.warning ? <p role="status" className="warning">{legacy.warning}</p> : null}
      {legacy.ids.length ? <details className="legacy-preview"><summary>发现本分析的旧清单（{legacy.ids.length} 条），预览迁入</summary><p>只迁入经当前仓库分析核对的提交；保留旧存储。{legacyRecords.failed.length} 条无法核对。</p><ol>{legacy.ids.map(id => <li key={id}><code>{id}</code> · {legacyRecords.records.has(id) ? '来源已核对' : '未核对'}</li>)}</ol><button disabled={legacyRecords.state !== 'ready'} onClick={() => { const warning = migrateLegacyPlan(dataset, legacy.ids.filter(id => legacyRecords.records.has(id))); const restored = restoreShortlist(dataset); onSelection({ ids: warning ? shortlist : restored.ids, warning: warning || restored.warning }) }}>明确迁入已核对提交</button></details> : null}

      <nav className="view-tabs" aria-label="分析结果视图"><button aria-current={listView ? 'page' : undefined} onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId, view: 'commits' })}>全部提交 <span>{repo.commitCount}</span></button><button aria-current={!listView ? 'page' : undefined} onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId, view: 'plan' })}>审查计划 <span>{shortlist.length}</span></button></nav>
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
                    value={value.draft.search}
                    onChange={event => updateQuery({ search: event.target.value })}
                  />
                </label>
                <label className="date-field">起始日期
                  <input
                    aria-label="起始日期"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    value={value.draft.start}
                    aria-invalid={!!value.error}
                    onChange={event => updateQuery({ start: event.target.value })}
                  />
                </label>
                <label className="date-field">结束日期
                  <input
                    aria-label="结束日期"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    value={value.draft.end}
                    aria-invalid={!!value.error}
                    onChange={event => updateQuery({ end: event.target.value })}
                  />
                </label>
                <label className="sort-field">排序
                  <select aria-label="排序" value={value.draft.sort} onChange={event => updateQuery({ sort: event.target.value })}>
                    <option value="risk">风险从高到低</option>
                    <option value="time">时间从新到旧</option>
                  </select>
                </label>
                <button className="clear-button" onClick={clearQuery}>清除筛选</button>
              </div>
              {value.error ? <p className="warning" role="alert">{value.error} 当前保留最近一次有效结果。</p> : null}
              <p className="review-caption">
                <span>提交 / 改动<b>{page.total.toLocaleString()}</b></span>
                <span>时间口径 Asia/Shanghai (UTC+08:00) · 按{value.applied.sort === 'risk' ? '模型分数' : '时间'}排序</span>
              </p>
              {page.state === 'loading' && visible.length === 0
                ? <LoadingNotice prefix={false} label="正在读取提交" note="按当前筛选条件从服务端读取这一页。" />
                : (page.state === 'error' && visible.length === 0) || totalMismatch
                  ? <EmptyState tone="alert" title="提交读取失败" description={totalMismatch ? '提交总数与固定分析不一致，请重新加载核对。' : page.error}><button className="primary-button" onClick={page.retry}>重新加载</button></EmptyState>
                  : visible.length === 0
                    ? <EmptyState title="没有符合条件的提交" description="使用「清除筛选」恢复列表，或换一个查询条件。" />
                    : <>
                      {page.state === 'error' ? <p className="warning" role="status">这一页读取失败：{page.error} 当前仍显示上一次成功读取的结果。<button className="text-button" onClick={page.retry}>重试</button></p> : null}
                      <ReviewTable
                        commits={visible}
                        shortlist={shortlist}
                        onOpen={(id, trigger) => { returnFocus.current = trigger; setSelected(id) }}
                        onAdd={add}
                      />
                      <nav className="pager" aria-label="提交分页">
                        <span role="status">第 {first}–{last} 条，共 {page.total.toLocaleString()} 条</span>
                        <button className="clear-button" disabled={value.offset === 0 || page.state === 'loading'} onClick={() => onChange({ ...value, offset: Math.max(0, value.offset - PAGE_SIZE) })}>上一页</button>
                        <button className="clear-button" disabled={value.offset + PAGE_SIZE >= page.total || page.state === 'loading'} onClick={() => onChange({ ...value, offset: value.offset + PAGE_SIZE })}>下一页</button>
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
            {listView ? '点击标识查看这条提交的原始度量；预测解释未提供' : '加入清单仅代表你的审查计划'}
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
