/**
 * 模型中心（MPW-03、MPW-04；任务 3.2／3.3，视觉改造任务 5.2）。
 *
 * 先展示已登记目录，再由用户主动打开管理员候选区。这里既不能把注册的方法条目当成已登记模型，
 * 也不能代替管理员自动登记本机 baseline。
 *
 * 呈现（design D14）：KPI 账本 + 表格 + 右侧抽屉。表格每行一条登记项，`.model-card` 仍是一条
 * 登记项的容器、`.state-badge` 仍是可用性标签——两者都是 e2e 的选择目标，类名保留。
 * 结论（可用性、是否支持单条预测）与告警常驻表格，完整来源与局限进抽屉，一层可达。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCandidates, fetchModels, registerModel } from './apiClient'
import { ApiError } from './apiContract'
import { type ModelCandidate, type ModelEntry, predictionSelectable, schemaFieldsInModel, unavailableSchemaField } from './catalogContract'
import { useCredential } from './credentialContext'
import { CredentialNotice, EmptyState, FailureNotice, LoadingNotice, MetaBlock, StatusNote } from './Feedback'
import { Icon } from './Icon'
import { useResource } from './requestState'

/** 可用性标签：6px 色块 + 文字（不用描边徽章）。`.state-badge` 系列类名保留。 */
function StateBadge({ model }: { model: ModelEntry }) {
  const ready = model.state === 'ready'
  return (
    <span className={ready ? 'state-badge state-ready' : 'state-badge state-invalid'}>
      <i className="state-dot" aria-hidden="true" />
      {ready ? '已登记 · 可用' : '已登记 · 不可用'}
    </span>
  )
}

function predictionSupport(model: ModelEntry): string {
  return model.jsonPredictionSupported
    ? `支持 ${model.featureSchemaVersion} 的六字段单条预测`
    : `不支持单条 JSON 预测（本模型为 ${model.featureSchemaVersion}）`
}

/** 逐条登记项的告警：不可用原因与未提供的字段必须常驻表格，不能藏进抽屉。 */
function ModelAlerts({ model }: { model: ModelEntry }) {
  const missing = unavailableSchemaField(model.featureSchema)
  return (
    <>
      {model.error === null ? null : (
        <StatusNote tone="warn">
          不可用原因（<code>{model.error.code}</code>）：{model.error.message}
        </StatusNote>
      )}
      {missing.length === 0 ? null : (
        <StatusNote tone="warn">
          未提供的字段：
          {missing.map((field) => `${field.name}（${field.reason ?? '原因未记录'}）`).join('；')}
        </StatusNote>
      )}
    </>
  )
}

/**
 * 来源与局限抽屉：Esc 关闭、点击背板关闭、关闭后焦点回到触发按钮（与设置面板同一套语义）。
 */
function ModelDrawer({ model, onClose }: { model: ModelEntry; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButton.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', escape)
    // 抽屉是覆盖层：打开期间锁住页面滚动，否则背景会在模态层后面滚动，
    // 而且滚动条本身会把固定定位的抽屉顶出可比对的可视宽度。
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', escape)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer model-drawer" role="dialog" aria-modal="true" aria-label="模型来源与局限">
        <div className="drawer-head">
          <span>来源与局限</span>
          <button className="icon-button" ref={closeButton} aria-label="关闭模型详情" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="drawer-body">
          <p className="drawer-model-name">{model.name}</p>
          <p className="drawer-model-method">
            方法 <code>{model.method}</code> · 来源 {model.origin === 'local' ? '本机产生' : '外部产生'}
          </p>
          <dl className="identity-list">
            <div>
              <dt>模型身份</dt>
              <dd>
                <code>{model.modelId}</code>
              </dd>
            </div>
            <div>
              <dt>运行身份</dt>
              <dd>
                <code>{model.runId}</code>
              </dd>
            </div>
            <div>
              <dt>原产物运行</dt>
              <dd>
                <code>{model.artifactRunId}</code>
              </dd>
            </div>
            <div>
              <dt>原产物模型</dt>
              <dd>
                <code>{model.artifactModelId}</code>
              </dd>
            </div>
            <div>
              <dt>数据集版本</dt>
              <dd>
                <code>{model.artifactDatasetVersion}</code>
              </dd>
            </div>
            <div>
              <dt>schema 哈希</dt>
              <dd>
                <code>{model.featureSchema.schemaSha256}</code>
              </dd>
            </div>
            <div>
              <dt>模型哈希</dt>
              <dd>
                <code>{model.sha256}</code>
              </dd>
            </div>
          </dl>
          <MetaBlock
            title="训练环境（产物声明）"
            value={model.trainingEnvironment === null ? '产物未记录训练环境' : model.trainingEnvironment}
          />
          <MetaBlock title="校验环境（本机）" value={model.verificationEnvironment} />
          <MetaBlock title="复现口径（方法声明）" value={model.reproducibility} />
          <section className="model-limits">
            <h4>局限</h4>
            <ul>
              {Array.from(new Set(model.limitations)).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          {predictionSelectable(model) ? null : (
            <p className="model-actions">
              本模型不可用于单条预测：<a href="#/predict">前往新建预测</a>{' '}
              只会列出当前可用、且支持六字段单条预测的模型。
            </p>
          )}
        </div>
      </aside>
    </>
  )
}

function CandidateRow({
  candidate,
  selected,
  onSelect,
}: {
  candidate: ModelCandidate
  selected: boolean
  onSelect: (candidateId: string) => void
}) {
  const invalid = candidate.state === 'invalid' || candidate.manifestSha256 === null
  const reason =
    candidate.error?.message ??
    (candidate.manifestSha256 === null ? '缺少 manifest 校验值，无法发起登记' : '')
  return (
    <li className={invalid ? 'candidate-row invalid' : 'candidate-row'}>
      <label>
        <input
          type="radio"
          name="model-candidate"
          value={candidate.candidateId}
          checked={selected}
          disabled={invalid}
          onChange={() => onSelect(candidate.candidateId)}
        />
        <span className="candidate-name">{candidate.displayName}</span>
      </label>
      <dl className="candidate-facts">
        <div>
          <dt>方法</dt>
          <dd>{candidate.method ?? '未声明'}</dd>
        </div>
        <div>
          <dt>schema</dt>
          <dd>{candidate.featureSchemaVersion ?? '未声明'}</dd>
        </div>
        <div>
          <dt>校验状态</dt>
          <dd>
            {candidate.state === 'candidate' ? '可校验登记' : '校验失败'}
            {reason === '' ? '' : ` · ${reason}`}
          </dd>
        </div>
        <div>
          <dt>manifest 校验值</dt>
          <dd>
            <code>{candidate.manifestSha256 ?? '未取得'}</code>
          </dd>
        </div>
      </dl>
    </li>
  )
}

function CandidateSection({ onRegistered }: { onRegistered: (model: ModelEntry) => void }) {
  const { token } = useCredential()
  const candidates = useResource((context) => fetchCandidates(context.token, context.signal))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const busyRef = useRef(false)

  const list = candidates.data ?? []
  const selected =
    list.find(
      (item) => item.candidateId === selectedId && item.state === 'candidate' && item.manifestSha256 !== null,
    ) ?? null

  async function submit() {
    // 双击保护：在途时不再发起第二个 POST。
    if (busyRef.current || selected === null || selected.manifestSha256 === null) return
    busyRef.current = true
    setBusy(true)
    setFailure(null)
    setOutcome(null)
    try {
      const result = await registerModel(token, {
        candidateId: selected.candidateId,
        expectedManifestSha256: selected.manifestSha256,
      })
      setOutcome({
        tone: 'ok',
        text: result.created
          ? `已新增登记：${result.model.name}（模型 ${result.model.modelId}）`
          : `该产物此前已登记，本次为复用：${result.model.name}（模型 ${result.model.modelId}）`,
      })
      setSelectedId(null)
      onRegistered(result.model)
    } catch (error) {
      setFailure(error)
      // 409：候选或运行上下文已变化。必须刷新候选并由用户重选，不能把新的校验值自动带回请求。
      if (error instanceof ApiError && error.code === 'CONTEXT_MISMATCH') {
        setSelectedId(null)
        candidates.reload()
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <section className="candidate-section" aria-labelledby="candidate-heading">
      <div className="section-caption">
        <span id="candidate-heading">
          本机候选 <b>{list.length}</b>
        </span>
        <span>只列出后端允许的相对展示名称；没有路径输入，也没有模型上传</span>
      </div>
      {candidates.status === 'credential-required' ? <CredentialNotice /> : null}
      {candidates.status === 'loading' ? <LoadingNotice label="本机候选目录。" /> : null}
      {candidates.status === 'failed' ? (
        <FailureNotice error={candidates.error} onRetry={candidates.reload} />
      ) : null}
      {candidates.status === 'ready' && list.length === 0 ? (
        <StatusNote tone="info">本机没有可登记的候选产物。请先用后端命令产生并校验运行产物。</StatusNote>
      ) : null}
      {list.length > 0 ? (
        <ul className="candidate-list">
          {list.map((candidate) => (
            <CandidateRow
              key={candidate.candidateId}
              candidate={candidate}
              selected={candidate.candidateId === selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </ul>
      ) : null}
      <div className="candidate-actions">
        <button type="button" className="primary-button" disabled={selected === null || busy} onClick={submit}>
          {busy ? '正在校验并登记…' : '校验并登记所选候选'}
        </button>
        <button type="button" disabled={busy} onClick={candidates.reload}>
          刷新候选
        </button>
      </div>
      {outcome === null ? null : <StatusNote tone={outcome.tone}>{outcome.text}</StatusNote>}
      {failure === null ? null : <FailureNotice error={failure} />}
    </section>
  )
}

/** 一条登记项的两行：数据行（`.model-card`）+ 可选的告警行。 */
function ModelRows({
  model,
  highlighted,
  onOpen,
}: {
  model: ModelEntry
  highlighted: boolean
  onOpen: (model: ModelEntry, trigger: HTMLButtonElement) => void
}) {
  const inModel = schemaFieldsInModel(model.featureSchema)
  const hasAlert = model.error !== null || unavailableSchemaField(model.featureSchema).length > 0
  return (
    <>
      <tr className={highlighted ? 'model-card highlighted' : 'model-card'} data-state={model.state}>
        <td className="model-name-cell">
          <strong>{model.name}</strong>
          <span className="model-method">
            方法 <code>{model.method}</code> · 来源 {model.origin === 'local' ? '本机产生' : '外部产生'}
          </span>
        </td>
        <td className="model-schema-cell">
          <code>{model.featureSchemaVersion}</code>
          <span className="model-schema-count">{inModel.length} 个字段入模</span>
        </td>
        <td className="model-predict-cell">{predictionSupport(model)}</td>
        <td className="model-state-cell">
          <StateBadge model={model} />
        </td>
        <td className="action-cell">
          <button
            type="button"
            className="row-action"
            aria-label={`查看 ${model.name} 的来源与局限`}
            onClick={(event) => onOpen(model, event.currentTarget)}
          >
            查看完整来源与局限
          </button>
        </td>
      </tr>
      {hasAlert ? (
        <tr className="model-alert-row">
          <td colSpan={5}>
            <div className="model-alert-body">
              <ModelAlerts model={model} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

export function ModelsPage() {
  const catalog = useResource((context) => fetchModels(context.token, context.signal))
  const [adminOpen, setAdminOpen] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [registration, setRegistration] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const detailTrigger = useRef<HTMLButtonElement | null>(null)
  const models = catalog.data ?? []

  const ready = models.filter((model) => model.state === 'ready').length
  const selectable = models.filter(predictionSelectable).length
  const detail = models.find((model) => model.modelId === detailId) ?? null

  const closeDetail = useCallback(() => {
    setDetailId(null)
    detailTrigger.current?.focus()
  }, [])

  function openDetail(model: ModelEntry, trigger: HTMLButtonElement) {
    detailTrigger.current = trigger
    setDetailId(model.modelId)
  }

  function onRegistered(model: ModelEntry) {
    setHighlight(model.modelId)
    setRegistration(`已登记模型 ${model.name}；目录已刷新，本次登记对应模型 ${model.modelId}。`)
    catalog.reload()
  }

  return (
    <div className="models-page">
      <header className="topbar">
        <div>
          <span className="project-symbol">
            <Icon name="project" />
          </span>
          <strong>模型中心</strong>
          <Icon name="chevron" size={14} />
          <span>已登记模型与管理员登记</span>
        </div>
        <div className="source-meta">
          <span className="demo-badge historical-badge">
            <span />
            团队目录
          </span>
        </div>
      </header>
      <div className="page-heading">
        <div>
          <h1>模型中心</h1>
          <p className="page-intro">
            查看本机已登记的模型、它们的来源与单条预测支持状态；管理员可在此校验并登记本机已有候选。
          </p>
        </div>
        <div className="record-count">
          <Icon name="list" size={20} />
          <div>
            <strong>{models.length}</strong>
            <span>个已登记模型</span>
          </div>
        </div>
      </div>
      <div className="demo-notice historical-notice">
        <Icon name="info" size={17} />
        <div>
          <strong>可用性与预测支持分开显示</strong>
          <span>
            已注册的方法条目不等于已登记模型，这里只列出目录中真实存在的登记项；低于当前可用性或按测试效果挑选模型都不在本页范围内。
          </span>
        </div>
      </div>

      <dl className="ledger models-ledger" aria-label="目录概况">
        <div>
          <dt>登记项</dt>
          <dd>{models.length}</dd>
        </div>
        <div>
          <dt>可用</dt>
          <dd>{ready}</dd>
        </div>
        <div>
          <dt>不可用</dt>
          <dd>{models.length - ready}</dd>
        </div>
        <div>
          <dt>支持单条预测</dt>
          <dd>{selectable}</dd>
        </div>
      </dl>

      <div className="section-caption">
        <span>
          已登记模型 <b>{models.length}</b>
        </span>
        <span>
          <button type="button" className="clear-button" onClick={catalog.reload}>
            刷新目录
          </button>
        </span>
      </div>
      {catalog.status === 'credential-required' ? <CredentialNotice /> : null}
      {catalog.status === 'loading' ? <LoadingNotice label="已登记模型目录。" /> : null}
      {catalog.status === 'failed' ? <FailureNotice error={catalog.error} onRetry={catalog.reload} /> : null}
      {registration === null ? null : <StatusNote tone="ok">{registration}</StatusNote>}
      {catalog.status === 'ready' && models.length === 0 ? (
        <EmptyState
          title="尚无已登记模型"
          description="管理员可从下方「管理登记」校验本机已有候选产物并登记；成员可联系维护者完成登记。系统不会自动登记本机 baseline。"
        />
      ) : null}
      {models.length > 0 ? (
        <section className="list-panel models-panel" aria-label="已登记模型">
          <div className="table-wrap models-table-wrap">
            <table className="models-table">
              <caption className="sr-only">已登记模型目录</caption>
              <thead>
                <tr>
                  <th>模型 / 方法</th>
                  <th>特征 schema</th>
                  <th>单条预测支持</th>
                  <th>状态</th>
                  <th className="action-head">来源与局限</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <ModelRows
                    key={model.modelId}
                    model={model}
                    highlighted={model.modelId === highlight}
                    onOpen={openDetail}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <footer className="list-footer">
            <span>状态按登记时冻结的身份判断；不可用原因与未提供的字段直接列在行下</span>
            <span>
              <Icon name="list" size={14} />
              {models.length} 条登记项
            </span>
          </footer>
        </section>
      ) : null}

      <div className="section-caption">
        <span>管理员登记</span>
        <span>只有明确进入后才读取候选目录</span>
      </div>
      {adminOpen ? (
        <CandidateSection onRegistered={onRegistered} />
      ) : (
        <div className="candidate-gate">
          <p>
            候选发现需要管理员凭据，并且只在你主动打开时才会请求 <code>/api/v1/model-candidates</code>。
          </p>
          <button type="button" onClick={() => setAdminOpen(true)}>
            打开管理登记
          </button>
        </div>
      )}
      <footer className="page-foot">
        <span>JIT Review</span>
        <span>模型目录只读展示；登记只提交所选候选的身份与 manifest 校验值</span>
      </footer>

      {detail === null ? null : <ModelDrawer model={detail} onClose={closeDetail} />}
    </div>
  )
}
