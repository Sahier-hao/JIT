/**
 * 模型中心（MPW-03、MPW-04；任务 3.2／3.3）。
 *
 * 先展示已登记目录，再由用户主动打开管理员候选区。这里既不能把注册的方法条目当成已登记模型，
 * 也不能代替管理员自动登记本机 baseline。
 */

import { useRef, useState } from 'react'
import { fetchCandidates, fetchModels, registerModel } from './apiClient'
import { ApiError } from './apiContract'
import { type ModelCandidate, type ModelEntry, predictionSelectable, schemaFieldsInModel, unavailableSchemaField } from './catalogContract'
import { useCredential } from './credentialContext'
import { CredentialNotice, FailureNotice, LoadingNotice, MetaBlock, StatusNote } from './Feedback'
import { Icon } from './Icon'
import { useResource } from './requestState'

function ModelCard({ model, highlighted }: { model: ModelEntry; highlighted: boolean }) {
  const missing = unavailableSchemaField(model.featureSchema)
  const inModel = schemaFieldsInModel(model.featureSchema)
  const origin = model.origin === 'local' ? '本机产生' : '外部产生'
  return (
    <article className={highlighted ? 'model-card highlighted' : 'model-card'}>
      <header className="model-card-head">
        <div>
          <h3>{model.name}</h3>
          <p className="model-method">
            方法 <code>{model.method}</code> · 来源 {origin}
          </p>
        </div>
        <span className={model.state === 'ready' ? 'state-badge state-ready' : 'state-badge state-invalid'}>
          {model.state === 'ready' ? '已登记 · 可用' : '已登记 · 不可用'}
        </span>
      </header>
      <dl className="model-facts">
        <div>
          <dt>特征 schema</dt>
          <dd>
            <code>{model.featureSchemaVersion}</code> · {inModel.length} 个字段入模
          </dd>
        </div>
        <div>
          <dt>单条预测支持</dt>
          <dd>
            {model.jsonPredictionSupported
              ? `支持 ${model.featureSchemaVersion} 的六字段单条预测`
              : `不支持单条 JSON 预测（本模型为 ${model.featureSchemaVersion}）`}
          </dd>
        </div>
        <div>
          <dt>模型哈希</dt>
          <dd>
            <code>{model.sha256}</code>
          </dd>
        </div>
      </dl>
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
      {predictionSelectable(model) ? null : (
        <p className="model-actions">
          <a href="#/predict">前往新建预测</a> 只会列出当前可用且支持六字段单条预测的模型。
        </p>
      )}
      <details className="model-details">
        <summary>查看完整来源与局限</summary>
        <div className="model-details-body">
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
        </div>
      </details>
    </article>
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
      {candidates.status === 'loading' ? <LoadingNotice label="正在读取本机候选目录。" /> : null}
      {candidates.status === 'failed' ? (
        <FailureNotice error={candidates.error} onRetry={candidates.reload} />
      ) : null}
      {candidates.status === 'ready' && list.length === 0 ? (
        <p className="status-note status-info" role="status">
          本机没有可登记的候选产物。请先用后端命令产生并校验运行产物。
        </p>
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

export function ModelsPage() {
  const catalog = useResource((context) => fetchModels(context.token, context.signal))
  const [adminOpen, setAdminOpen] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [registration, setRegistration] = useState<string | null>(null)
  const models = catalog.data ?? []

  function onRegistered(model: ModelEntry) {
    setHighlight(model.modelId)
    setRegistration(`已登记模型 ${model.name}；目录已刷新，本次登记对应模型 ${model.modelId}。`)
    catalog.reload()
  }

  return (
    <>
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
      {catalog.status === 'loading' ? <LoadingNotice label="正在读取已登记模型目录。" /> : null}
      {catalog.status === 'failed' ? <FailureNotice error={catalog.error} onRetry={catalog.reload} /> : null}
      {registration === null ? null : <StatusNote tone="ok">{registration}</StatusNote>}
      {catalog.status === 'ready' && models.length === 0 ? (
        <div className="empty-state">
          <div className="empty-mark">
            <Icon name="project" size={28} />
          </div>
          <h2>尚无已登记模型</h2>
          <p>
            管理员可从下方「管理登记」校验本机已有候选产物并登记；成员可联系维护者完成登记。
            系统不会自动登记本机 baseline。
          </p>
        </div>
      ) : null}
      {models.length > 0 ? (
        <div className="model-list">
          {models.map((model) => (
            <ModelCard key={model.modelId} model={model} highlighted={model.modelId === highlight} />
          ))}
        </div>
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
    </>
  )
}
