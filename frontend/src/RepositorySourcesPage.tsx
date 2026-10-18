/**
 * 数据来源页（RCL-07、D5/D6，任务 6.1/6.2/6.6/6.7）。
 *
 * 一屏完成三件事：填一个公开仓库地址发起同步、看作业走到哪一步、同步完成后去工作台看风险。
 * 页面对两件事保持诚实：同步是异步的（轮询状态，不假装即时完成），最近一段提交没有标签
 * （只有被后续修复指认过的提交才是正例），因此"能打分"和"能验证准不准"不是一回事。
 */

import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from './apiContract'
import { createRepositorySync, fetchRepositorySyncs } from './apiClient'
import { useCredential } from './credentialContext'
import { CredentialNotice, FailureNotice, LoadingNotice, StatusNote } from './Feedback'
import { Icon } from './Icon'
import { displayTime } from './domain'
import {
  ACTIVE_STATUSES,
  DEGRADE_LABELS,
  STATUS_LABELS,
  STRATEGIES,
  STRATEGY_LABELS,
  failHint,
  repositoryName,
  type SyncPage,
  type SyncStrategy,
  type SyncView,
} from './repositoryContract'

const EMPTY_FORM = {
  repositoryUrl: '',
  branch: '',
  since: '',
  until: '',
  commitLimit: '500',
  strategy: 'auto' as SyncStrategy,
}

function isActive(sync: SyncView): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(sync.status)
}

function modelText(sync: SyncView): string {
  if (sync.status !== 'completed') return '尚未打分'
  if (sync.modelStrategy === 'generic-model') return '现成通用模型'
  if (sync.modelStrategy === 'repository-trained') return '本仓库数据训练'
  return '未记录'
}

function SyncCard({ sync, onOpen }: { sync: SyncView; onOpen: (syncId: string) => void }) {
  const hint = failHint(sync.error)
  return (
    <article className="model-card">
      <header className="model-card-head">
        <div>
          <h3>{repositoryName(sync.repositoryUrl)}</h3>
          <p className="model-method">
            分支 <code>{sync.branch}</code> · 请求策略 {STRATEGY_LABELS[sync.requestedStrategy]}
          </p>
        </div>
        <span className={sync.status === 'completed' ? 'state-badge state-ready' : 'state-badge state-invalid'}>
          {STATUS_LABELS[sync.status]}
        </span>
      </header>
      {isActive(sync) ? (
        <LoadingNotice label={`当前阶段：${STATUS_LABELS[sync.stage]}；完成后自动刷新，无需手动重试。`} />
      ) : null}
      <dl className="model-facts">
        <div>
          <dt>仓库地址</dt>
          <dd>
            <code>{sync.repositoryUrl}</code>
          </dd>
        </div>
        <div>
          <dt>时间范围与上限</dt>
          <dd>
            {sync.since ?? '未指定'} — {sync.until ?? '未指定'} · 最多 {sync.commitLimit} 个提交
          </dd>
        </div>
        <div>
          <dt>数据集版本</dt>
          <dd>{sync.datasetVersion === null ? '尚未登记' : <code>{sync.datasetVersion}</code>}</dd>
        </div>
        <div>
          <dt>训练样本</dt>
          <dd>
            {sync.trainRecords === null
              ? '未统计'
              : sync.trainRecords === 0
                ? '没有早于最近 90 天的提交，只做打分'
                : `${sync.trainRecords} 条提交 · 其中 ${sync.trainPositives ?? 0} 条观测到引入缺陷`}
          </dd>
        </div>
        <div>
          <dt>打分模型</dt>
          <dd>{modelText(sync)}</dd>
        </div>
        <div>
          <dt>发起时间</dt>
          <dd>{displayTime(sync.createdAt)} · UTC+08:00</dd>
        </div>
      </dl>
      {sync.degradeReason === null ? null : (
        <StatusNote tone="warn">
          没有按数据训练，原因：{DEGRADE_LABELS[sync.degradeReason] ?? sync.degradeReason}。
          上面的风险由现成通用模型给出，只用于排序线索。
        </StatusNote>
      )}
      {hint === null ? null : (
        <div className="notice notice-failure" role="alert">
          <Icon name="info" size={17} />
          <div>
            <strong>{hint.title}</strong>
            <span>{hint.next}</span>
            <span>
              <code>{sync.error?.code}</code>
              {sync.error?.message}
            </span>
          </div>
        </div>
      )}
      {sync.status === 'completed' ? (
        <p className="model-actions">
          <button type="button" className="primary-button" onClick={() => onOpen(sync.syncId)}>
            去工作台看这批提交的风险
          </button>
          <span>工作台按风险从高到低列出这些提交；风险是模型估计，不等于已确认缺陷。</span>
        </p>
      ) : null}
    </article>
  )
}

export function RepositorySourcesPage({ onOpenSync }: { onOpenSync: (syncId: string) => void }) {
  const { token, generation } = useCredential()
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<unknown>(null)
  const [page, setPage] = useState<SyncPage | null>(null)
  const [listError, setListError] = useState<unknown>(null)
  const [reload, setReload] = useState(0)

  // 换凭据即丢弃上一份作业视图与未提交项目（design D2）。
  useEffect(() => {
    setForm(EMPTY_FORM)
    setPage(null)
    setCreateError(null)
    setListError(null)
  }, [generation])

  // 轮询：只在有进行中的作业时继续，终态后停下；卸载或换凭据即取消。
  useEffect(() => {
    if (token === '') return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const next = await fetchRepositorySyncs(token, 20, 0)
        if (!active) return
        setPage(next)
        setListError(null)
        if (next.syncs.some(isActive)) timer = setTimeout(load, 2500)
      } catch (error) {
        if (active) setListError(error)
      }
    }
    void load()
    return () => {
      active = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [token, reload])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (token === '') return
    setCreating(true)
    setCreateError(null)
    try {
      await createRepositorySync(token, form)
      setForm({ ...EMPTY_FORM, strategy: form.strategy, commitLimit: form.commitLimit })
      setReload((value) => value + 1)
    } catch (error) {
      setCreateError(error)
    } finally {
      setCreating(false)
    }
  }

  const busy = creating
  return (
    <>
      <header className="topbar">
        <div>
          <span className="project-symbol">
            <Icon name="project" />
          </span>
          <strong>数据来源</strong>
          <Icon name="chevron" size={14} />
          <span>从公开仓库同步提交</span>
        </div>
      </header>
      <div className="page-heading">
        <div>
          <h1>把真实仓库变成可以评审的提交</h1>
          <p className="page-intro">
            填一个公开的 Git 仓库地址，系统会克隆它、抽取 14 个变更特征、按修复提交倒推标签，
            再给最近的提交打分。同步在后台进行，完成后可在工作台按风险查看。
          </p>
        </div>
      </div>
      <div className="demo-notice">
        <Icon name="info" size={17} />
        <div>
          <strong>先知道两件事</strong>
          <span>
            第一，最近一段提交还没有被别人修过，所以没有标签，只能打分、不能立刻验证准不准；
            第二，训练与打分用的是同一个仓库的历史提交，模型只对这一类项目有把握。
          </span>
        </div>
      </div>
      {token === '' ? <CredentialNotice>同步需要团队凭据；请在左侧输入后再填写仓库地址。</CredentialNotice> : null}
      <form className="toolbar" aria-label="新建仓库同步" onSubmit={submit}>
        <label className="search-field">
          仓库地址
          <span className="input-wrap">
            <Icon name="search" size={17} />
            <input
              aria-label="仓库地址"
              placeholder="https://github.com/组织/仓库.git"
              value={form.repositoryUrl}
              disabled={busy}
              onChange={(event) => setForm({ ...form, repositoryUrl: event.target.value })}
            />
          </span>
        </label>
        <label>
          分支
          <input
            aria-label="分支"
            placeholder="留空按默认分支"
            value={form.branch}
            disabled={busy}
            onChange={(event) => setForm({ ...form, branch: event.target.value })}
          />
        </label>
        <label>
          从哪天开始
          <input
            aria-label="从哪天开始"
            inputMode="numeric"
            placeholder="YYYY-MM-DD，留空为最近 90 天"
            value={form.since}
            disabled={busy}
            onChange={(event) => setForm({ ...form, since: event.target.value })}
          />
        </label>
        <label>
          到哪天结束
          <input
            aria-label="到哪天结束"
            inputMode="numeric"
            placeholder="YYYY-MM-DD"
            value={form.until}
            disabled={busy}
            onChange={(event) => setForm({ ...form, until: event.target.value })}
          />
        </label>
        <label>
          最多提交数
          <input
            aria-label="最多提交数"
            inputMode="numeric"
            value={form.commitLimit}
            disabled={busy}
            onChange={(event) => setForm({ ...form, commitLimit: event.target.value })}
          />
        </label>
        <label>
          打分模型
          <select
            aria-label="打分模型"
            value={form.strategy}
            disabled={busy}
            onChange={(event) => setForm({ ...form, strategy: event.target.value as SyncStrategy })}
          >
            {STRATEGIES.map((value) => (
              <option key={value} value={value}>
                {STRATEGY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-button" type="submit" disabled={busy || token === ''}>
          {busy ? '正在提交…' : '开始同步'}
        </button>
      </form>
      <p className="status-note">
        「自动」会在提交太少或正例太少时改用现成模型，并说明原因；「强制用本仓库数据训练」在数据
        无法按时间切分时直接失败，不会给出一个看起来能用的模型。
      </p>
      {createError === null ? null : <FailureNotice error={createError} />}
      <section aria-label="同步记录">
        <div className="section-caption">
          <span>
            同步记录<b>{page?.total ?? 0}</b>
          </span>
          <span>按发起时间从新到旧</span>
        </div>
        {token === '' ? (
          <p className="muted">输入团队凭据后，这里会显示本机发起过的同步。</p>
        ) : listError !== null ? (
          <FailureNotice error={listError} onRetry={() => setReload((value) => value + 1)} />
        ) : page === null ? (
          <LoadingNotice label="正在读取同步记录…" />
        ) : page.syncs.length === 0 ? (
          <div className="empty-state">
            <h2>还没有同步过仓库</h2>
            <p>上面填写一个公开仓库地址即可开始；也可以先用「示例数据」熟悉工作台。</p>
          </div>
        ) : (
          <div className="model-list">
            {page.syncs.map((sync) => (
              <SyncCard key={sync.syncId} sync={sync} onOpen={onOpenSync} />
            ))}
          </div>
        )}
      </section>
      {createError instanceof ApiError && createError.code === 'UNAUTHORIZED' ? (
        <StatusNote tone="warn">凭据未被接受，请确认左侧填的是成员凭据而不是管理员凭据以外的内容。</StatusNote>
      ) : null}
    </>
  )
}
