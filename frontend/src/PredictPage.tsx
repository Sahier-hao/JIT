/**
 * 新建预测（MPW-05、MPW-06、MPW-07；任务 4.1–4.4）。
 *
 * 六字段表单与粘贴的特征 JSON 是同一份草稿；只有模型可用、schema 为 openstack-six-v1 且整张表
 * 校验通过时才允许提交。写请求只由用户显式触发一次，绝不自动重试。
 */

import { type FormEvent, useEffect, useRef, useState } from 'react'
import { createPrediction, fetchFeatureSchema, fetchModels } from './apiClient'
import { type FeatureField, importFeatureJson } from './featureJson'
import { CredentialNotice, FailureNotice, LoadingNotice, StatusNote } from './Feedback'
import { Icon } from './Icon'
import { type ModelEntry, predictionSelectable } from './catalogContract'
import { type PredictionResult, type Submission } from './predictionContract'
import {
  type Draft,
  type DraftErrors,
  type DraftField,
  FIELD_LABELS,
  draftWithFeatures,
  emptyDraft,
  validateDraft,
} from './predictionInput'
import { useCredential } from './credentialContext'
import { describeFailure, fieldReasons, useResource } from './requestState'

const FEATURE_HELP: Record<FeatureField, string> = {
  ns: '本次提交涉及的子系统数目（原始计数）',
  nd: '本次提交涉及的目录数目（原始计数）',
  nf: '本次提交修改的文件数目（原始计数）',
  ent: '修改在文件间分布的熵，按发布者原始数值填写',
  la: '本次提交增加的代码行数（原始计数）',
  ld: '本次提交删除的代码行数（原始计数）',
}

/** 服务端字段名（record.features.ns 等）映射回表单字段。 */
function formField(raw: string): DraftField | null {
  const name = raw.replace(/^record\./, '').replace(/^features\./, '')
  const candidate = name as DraftField
  return candidate in FIELD_LABELS ? candidate : null
}

/** schema 声明里的变换与局限可能逐字段重复（同一 transform 会重复出现），按值去重后才适合做列表键。 */
function unique(items: readonly string[]): string[] {
  return Array.from(new Set(items))
}

function SchemaDetails({ version }: { version: string }) {
  const schema = useResource((context) => fetchFeatureSchema(context.token, version, context.signal), [version])
  return (
    <details className="schema-details">
      <summary>输入说明（{version}）</summary>
      <div className="schema-details-body">
        {schema.status === 'loading' ? <LoadingNotice label="正在读取字段说明。" /> : null}
        {schema.status === 'failed' ? <FailureNotice error={schema.error} onRetry={schema.reload} /> : null}
        {schema.data === null ? null : (
          <>
            <p className="muted">
              该 schema 有 {schema.data.inModel.length} 个字段入模；单条 JSON 预测
              {schema.data.jsonPredictionSupported ? '已支持' : '尚未支持'}。
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>类型</th>
                    <th>来源列</th>
                    <th>变换</th>
                    <th>来源状态</th>
                  </tr>
                </thead>
                <tbody>
                  {schema.data.fields.map((field) => (
                    <tr key={field.name}>
                      <td>
                        <code>{field.name}</code>
                        {field.inModel ? null : <span className="muted">（未入模）</span>}
                      </td>
                      <td>{field.type}</td>
                      <td>{field.sourceColumn}</td>
                      <td>{field.transform}</td>
                      <td>{field.sourceStatus === 'verified' ? '已核验' : '未提供'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {schema.data.transforms.length === 0 ? null : (
              <ul className="schema-list">
                {unique(schema.data.transforms).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {schema.data.limitations.length === 0 ? null : (
              <ul className="schema-list">
                {unique(schema.data.limitations).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </details>
  )
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (message === undefined) return null
  return (
    <p className="field-error" id={id}>
      {message}
    </p>
  )
}

export function PredictPage({
  onCreated,
}: {
  onCreated: (result: PredictionResult) => void
}) {
  const { token } = useCredential()
  const catalog = useResource((context) => fetchModels(context.token, context.signal))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [touched, setTouched] = useState<DraftField[]>([])
  const [attempted, setAttempted] = useState(false)
  const [serverErrors, setServerErrors] = useState<DraftErrors>({})
  const [jsonText, setJsonText] = useState('')
  const [jsonMessage, setJsonMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const [focusField, setFocusField] = useState<string | null>(null)
  const busyRef = useRef(false)

  // 在途时输入框是禁用的，禁用的元素拿不到焦点；等服务端原因落地、字段重新可用后再定位。
  useEffect(() => {
    if (busy || focusField === null) return
    document.getElementById(focusField)?.focus()
  }, [busy, focusField])

  const models = catalog.data ?? []
  const selectable = models.filter(predictionSelectable)
  const unavailable = models.filter((model) => !predictionSelectable(model))
  const model: ModelEntry | null = models.find((item) => item.modelId === selectedId) ?? null
  const changed = selectedId !== null && model === null

  const { errors, result } = validateDraft(draft, model === null ? null : model.modelId)
  const shown: DraftErrors = { ...serverErrors }
  for (const [field, message] of Object.entries(errors)) {
    const name = field as DraftField
    if (touched.includes(name) || attempted) shown[name] = message
  }

  function update(field: DraftField, value: string) {
    setDraft((previous) => ({ ...previous, [field]: value }))
    setTouched((previous) => (previous.includes(field) ? previous : [...previous, field]))
    setServerErrors((previous) => {
      if (!(field in previous)) return previous
      const next = { ...previous }
      delete next[field]
      return next
    })
  }

  function applyJson() {
    const imported = importFeatureJson(jsonText)
    if (!imported.ok) {
      setJsonMessage({ tone: 'warn', text: imported.message })
      return
    }
    // 完全合法后一次性填入六项；项目、记录编号与所选模型保持原样。
    setDraft((previous) => draftWithFeatures(previous, imported.features))
    setJsonMessage({ tone: 'ok', text: '已按粘贴的六项特征填入表单，其余字段保持不变。' })
    setServerErrors({})
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setAttempted(true)
    if (busyRef.current || result === null) return
    busyRef.current = true
    setBusy(true)
    setFailure(null)
    setServerErrors({})
    try {
      const created = await createPrediction(token, result.submission)
      onCreated(created)
    } catch (error) {
      setFailure(error)
      const view = describeFailure(error)
      if (view.kind === 'field' && view.details.length > 0) {
        const reasons = fieldReasons(view.details)
        const mapped: DraftErrors = {}
        let first: string | null = null
        for (const [raw, reason] of reasons) {
          const field = formField(raw)
          if (field === null) continue
          mapped[field] = reason
          first ??= `predict-field-${field}`
        }
        setServerErrors(mapped)
        setFocusField(first)
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const failureView = failure === null ? null : describeFailure(failure)
  // 请求已发出但连接中断／超时，或 201 正文不符合约定：都不能断言保存结果。
  const saveUnknown = failureView !== null && (failureView.kind === 'network' || failureView.kind === 'contract')
  const canSubmit = result !== null && model !== null && !busy

  const text = (field: 'project' | 'recordId') => (
    <label className="field" htmlFor={`predict-field-${field}`}>
      <span>{FIELD_LABELS[field]}</span>
      <input
        id={`predict-field-${field}`}
        name={field}
        type="text"
        autoComplete="off"
        disabled={busy}
        value={draft[field]}
        aria-invalid={shown[field] === undefined ? undefined : true}
        aria-describedby={shown[field] === undefined ? undefined : `predict-error-${field}`}
        onChange={(event) => update(field, event.target.value)}
      />
      <FieldError id={`predict-error-${field}`} message={shown[field]} />
    </label>
  )

  return (
    <>
      <header className="topbar">
        <div>
          <span className="project-symbol">
            <Icon name="project" />
          </span>
          <strong>新建预测</strong>
          <Icon name="chevron" size={14} />
          <span>用户提供特征 · 模型估计</span>
        </div>
      </header>
      <div className="page-heading">
        <div>
          <h1>新建预测</h1>
          <p className="page-intro">
            选择一个当前可用、且支持 {`openstack-six-v1`} 六字段单条预测的模型，填写原始数值后显式提交。
            本页不会自动训练或调整模型，也不会从源码自动提取特征。
          </p>
        </div>
      </div>

      <section className="predict-section" aria-labelledby="model-heading">
        <div className="section-caption">
          <span id="model-heading">选择模型</span>
          <span>只有当前可用且支持六字段单条预测的模型可选</span>
        </div>
        {catalog.status === 'credential-required' ? <CredentialNotice /> : null}
        {catalog.status === 'loading' ? <LoadingNotice label="正在读取已登记模型目录。" /> : null}
        {catalog.status === 'failed' ? <FailureNotice error={catalog.error} onRetry={catalog.reload} /> : null}
        {catalog.status === 'ready' && selectable.length === 0 ? (
          <div className="empty-state">
            <div className="empty-mark">
              <Icon name="info" size={28} />
            </div>
            <h2>当前没有可用于单条预测的模型</h2>
            <p>
              需要先由管理员在<a href="#/models">模型中心</a>登记一个已校验的本机产物；
              登记完成后回到本页即可选择。
            </p>
          </div>
        ) : null}
        {selectable.length > 0 ? (
          <fieldset className="model-picker" disabled={busy}>
            <legend className="sr-only">选择用于单条预测的模型</legend>
            {selectable.map((item) => (
              <label key={item.modelId} className="model-option">
                <input
                  type="radio"
                  name="prediction-model"
                  value={item.modelId}
                  checked={item.modelId === selectedId}
                  onChange={() => setSelectedId(item.modelId)}
                />
                <span>
                  <strong>{item.name}</strong>
                  <span className="muted">
                    方法 {item.method} · schema {item.featureSchemaVersion} · 模型哈希{' '}
                    <code>{item.sha256}</code>
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {changed ? (
          <StatusNote tone="warn">
            所选模型在当前目录中已不存在，系统不会自动改选其他模型，请重新选择。
          </StatusNote>
        ) : null}
        {model !== null && !predictionSelectable(model) ? (
          <StatusNote tone="warn">
            所选模型当前不可用
            {model.error === null ? '' : `（${model.error.code}：${model.error.message}）`}，请改选其他模型。
          </StatusNote>
        ) : null}
        {unavailable.length === 0 ? null : (
          <details className="unavailable-models">
            <summary>另有 {unavailable.length} 个模型当前不可用于单条预测</summary>
            <ul>
              {unavailable.map((item) => (
                <li key={item.modelId}>
                  <strong>{item.name}</strong>：{item.featureSchemaVersion}，
                  {item.jsonPredictionSupported ? '当前不可用' : '不支持单条 JSON 预测'}
                  {item.error === null ? '' : `（${item.error.code}：${item.error.message}）`}
                </li>
              ))}
            </ul>
          </details>
        )}
        {model === null ? null : (
          <div className="model-summary">
            <dl className="model-facts">
              <div>
                <dt>运行身份</dt>
                <dd>
                  <code>{model.runId}</code>
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
            </dl>
            <SchemaDetails version={model.featureSchemaVersion} />
          </div>
        )}
      </section>

      <form className="predict-form" onSubmit={submit} noValidate>
        <section className="predict-section" aria-labelledby="record-heading">
          <div className="section-caption">
            <span id="record-heading">记录信息</span>
            <span>项目与记录编号只用于标识本次输入</span>
          </div>
          <div className="field-grid">
            {text('project')}
            {text('recordId')}
          </div>
        </section>

        <section className="predict-section" aria-labelledby="features-heading">
          <div className="section-caption">
            <span id="features-heading">六个原始特征</span>
            <span>按发布者原生数值填写，无需预先变换</span>
          </div>
          <div className="field-grid">
            {(['ns', 'nd', 'nf', 'ent', 'la', 'ld'] as FeatureField[]).map((name) => (
              <label className="field" htmlFor={`predict-field-${name}`} key={name}>
                <span>{FIELD_LABELS[name]}</span>
                <input
                  id={`predict-field-${name}`}
                  name={name}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={busy}
                  value={draft[name]}
                  aria-invalid={shown[name] === undefined ? undefined : true}
                  aria-describedby={
                    shown[name] === undefined ? `predict-help-${name}` : `predict-error-${name}`
                  }
                  onChange={(event) => update(name, event.target.value)}
                />
                <span className="field-help" id={`predict-help-${name}`}>
                  {FEATURE_HELP[name]}
                </span>
                <FieldError id={`predict-error-${name}`} message={shown[name]} />
              </label>
            ))}
          </div>
        </section>

        <section className="predict-section" aria-labelledby="meta-heading">
          <div className="section-caption">
            <span id="meta-heading">可选记录元数据</span>
            <span>留空即表示未提供，不会被当成 0 或当前时间</span>
          </div>
          <div className="field-grid">
            <label className="field" htmlFor="predict-field-commitId">
              <span>{FIELD_LABELS.commitId}</span>
              <input
                id="predict-field-commitId"
                name="commitId"
                type="text"
                autoComplete="off"
                disabled={busy}
                value={draft.commitId}
                aria-invalid={shown.commitId === undefined ? undefined : true}
                aria-describedby={shown.commitId === undefined ? undefined : 'predict-error-commitId'}
                onChange={(event) => update('commitId', event.target.value)}
              />
              <FieldError id="predict-error-commitId" message={shown.commitId} />
            </label>
            <label className="field" htmlFor="predict-field-time">
              <span>{FIELD_LABELS.time}</span>
              <input
                id="predict-field-time"
                name="time"
                type="text"
                autoComplete="off"
                placeholder="2026-01-02T03:04:05+08:00"
                disabled={busy}
                value={draft.time}
                aria-invalid={shown.time === undefined ? undefined : true}
                aria-describedby={shown.time === undefined ? undefined : 'predict-error-time'}
                onChange={(event) => update('time', event.target.value)}
              />
              <FieldError id="predict-error-time" message={shown.time} />
            </label>
          </div>
        </section>

        <section className="predict-section" aria-labelledby="json-heading">
          <div className="section-caption">
            <span id="json-heading">粘贴特征 JSON</span>
            <span>只接受恰好六项数值的对象；不触发预测</span>
          </div>
          <label className="field" htmlFor="predict-feature-json">
            <span className="sr-only">特征 JSON</span>
            <textarea
              id="predict-feature-json"
              name="featureJson"
              rows={5}
              spellCheck={false}
              disabled={busy}
              placeholder={'{\n  "ns": 1, "nd": 2, "nf": 3, "ent": 1.5, "la": 10, "ld": 4\n}'}
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
            />
          </label>
          <div className="json-actions">
            <button type="button" disabled={busy} onClick={applyJson}>
              导入到表单
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setJsonText('')
                setJsonMessage(null)
              }}
            >
              清空粘贴内容
            </button>
          </div>
          {jsonMessage === null ? null : <StatusNote tone={jsonMessage.tone}>{jsonMessage.text}</StatusNote>}
        </section>

        <div className="submit-bar">
          <button type="submit" className="primary-button" disabled={!canSubmit}>
            {busy ? '正在提交并保存…' : '提交并保存预测'}
          </button>
          <span className="muted" role="status">
            {busy
              ? '请求已发出，正在等待服务端保存结果。'
              : model === null
                ? '请先选择模型。'
                : result === null
                  ? '请先补全必填字段，空白不会被当成 0。'
                  : '提交只会向所选模型发送一条预测请求。'}
          </span>
        </div>
      </form>

      {failure === null ? null : saveUnknown ? (
        <div className="notice notice-unknown" role="alert">
          <Icon name="info" size={17} />
          <div>
            <strong>未能确认保存结果</strong>
            <span>{failureView?.message}</span>
            <span>
              请求已经发出，但本页没有拿到可核对的保存结果。这不代表保存失败，也不代表成功：
              请到<a href="#/predictions">打开已有结果</a>用批次编号确认，再决定是否重新提交。
            </span>
            {failureView?.requestId === '' || failureView === null ? null : (
              <span className="failure-request">
                请求编号 <code>{failureView.requestId}</code>
              </span>
            )}
          </div>
        </div>
      ) : (
        <FailureNotice error={failure}>
          {failureView?.kind === 'model' || failureView?.kind === 'storage' ? (
            <p>
              可以到<a href="#/models">模型中心</a>确认模型状态，或请管理员重新校验登记后再试。
            </p>
          ) : null}
        </FailureNotice>
      )}
      <footer className="page-foot">
        <span>JIT Review</span>
        <span>特征由用户提供；风险为已登记模型的估计，不代表已确认缺陷</span>
      </footer>
    </>
  )
}

export type { Submission }
