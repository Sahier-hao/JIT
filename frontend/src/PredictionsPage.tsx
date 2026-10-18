/**
 * 结果展示与按编号重开（MPW-08、MPW-09；任务 5.1、5.2，视觉改造任务 5.4）。
 *
 * 结果页只呈现这一条记录：风险、用户提供的原始输入、以及不可变的模型与运行来源。重开是一次
 * 只读 GET，不触发新预测，也不要求该模型当前仍然可用，更不依赖模型目录能否读取。
 *
 * 版式（design D14）：顶部风险横幅（大号等宽数字 + 0–100% 量表 + 免责），下方左身份 / 右来源。
 */

import { type FormEvent, useState } from 'react'
import { fetchPredictionBatch } from './apiClient'
import { CredentialNotice, EmptyState, FailureNotice, LoadingNotice, MetaBlock, StatusNote } from './Feedback'
import { displayTime } from './domain'
import { Icon } from './Icon'
import { Risk } from './Risk'
import { type PredictionResult } from './predictionContract'
import { normalizedBatchId } from './predictionContract'
import { resultLink, type Route } from './navigation'
import { useResource } from './requestState'

function showTime(value: string | null): string {
  if (value === null || value.trim() === '') return '未提供'
  return displayTime(value)
}

/**
 * 风险横幅（任务 5.4、design D14）：大号等宽数字 + 0–100% 量表 + 一句免责。
 *
 * 量表把数值放回可核对的范围里：条的末端是这次估计，60% 处是分档界（D11），两端是
 * 0 与 100 两个端点。这里不给出任何置信区间——运行产物不提供区间，写一个出来就是编造。
 */
function RiskBanner({ risk, recordId }: { risk: number; recordId: string }) {
  return (
    <section className="risk-banner" aria-label="风险估计">
      <div className="risk-banner-main">
        <span className="risk-banner-label">缺陷风险（模型估计）</span>
        <Risk risk={risk} large />
        <div className="risk-banner-scale" aria-hidden="true">
          <span>0%</span>
          <span>60% 分档界</span>
          <span>100%</span>
        </div>
      </div>
      <div className="risk-banner-side">
        <p className="risk-banner-note">
          模型估计的缺陷风险，未验证在线仓库效果；不代表已确认缺陷，也不构成缺陷结论。
        </p>
        <p className="risk-banner-meta">
          单条预测 · 记录 <code>{recordId}</code>
        </p>
      </div>
    </section>
  )
}

function ResultBody({ result, snapshot }: { result: PredictionResult; snapshot: boolean }) {
  const record = result.records[0]
  const link = resultLink(result.batchId, window.location)
  const [copied, setCopied] = useState<string | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied('结果链接已复制到剪贴板。')
    } catch {
      // 剪贴板不可用时保留可手动复制的输入框，不谎称已复制。
      setCopied('当前浏览器不允许自动复制，请在下面的输入框里手动复制链接。')
    }
  }

  return (
    <>
      <div className="demo-notice historical-notice">
        <Icon name="info" size={17} />
        <div>
          <strong>用户提供特征 · 模型估计</strong>
          <span>
            本次输入由用户手工提供，风险是已登记模型的估计值；不是源码提取结果，也不代表已确认缺陷。
          </span>
        </div>
      </div>
      {snapshot ? null : (
        <StatusNote tone="info">
          本页直接按批次编号读取结果，没有重新预测，也不要求该模型当前仍然可用。
        </StatusNote>
      )}

      <RiskBanner risk={record.risk} recordId={record.recordId} />

      <div className="result-grid">
        <div className="result-col">
          <article className="result-card">
            <div className="section-caption">
              <span>身份</span>
              <span>{record.recordId}</span>
            </div>
            <dl className="identity-list">
              <div>
                <dt>项目</dt>
                <dd>{result.project}</dd>
              </div>
              <div>
                <dt>记录编号</dt>
                <dd>{record.recordId}</dd>
              </div>
              <div>
                <dt>提交 SHA</dt>
                <dd>{record.commitId === null ? '未提供' : <code>{record.commitId}</code>}</dd>
              </div>
              <div>
                <dt>提交时间</dt>
                <dd>{showTime(record.time)}</dd>
              </div>
              <div>
                <dt>创建时刻</dt>
                <dd>{showTime(result.createdAt)}</dd>
              </div>
            </dl>
          </article>

          <article className="result-card">
            <div className="section-caption">
              <span>原始输入（六字段）</span>
              <span>按提交时的数值原样保存</span>
            </div>
            <dl className="identity-list">
              {Object.entries(record.features).map(([name, value]) => (
                <div key={name}>
                  <dt>
                    <code>{name}</code>
                  </dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              六项均为用户提供的原始数值，未经本应用变换；模型内部按已登记 schema 自行处理。
            </p>
          </article>
        </div>

        <section className="result-section">
          <div className="section-caption">
            <span>来源与身份</span>
            <span>来源在保存时冻结，重开时不会随模型状态改变</span>
          </div>
          <dl className="identity-list">
            <div>
              <dt>批次身份</dt>
              <dd>
                <code>{result.batchId}</code>
              </dd>
            </div>
            <div>
              <dt>预测身份</dt>
              <dd>
                <code>{record.predictionId}</code>
              </dd>
            </div>
            <div>
              <dt>模式 / 来源类型</dt>
              <dd>
                <code>{result.mode}</code> · <code>{result.sourceKind}</code>
              </dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>
                {result.model.name}（方法 <code>{result.model.method}</code>）
              </dd>
            </div>
            <div>
              <dt>模型身份</dt>
              <dd>
                <code>{result.model.modelId}</code>
              </dd>
            </div>
            <div>
              <dt>运行身份</dt>
              <dd>
                <code>{result.runId}</code>
              </dd>
            </div>
            <div>
              <dt>原产物模型</dt>
              <dd>
                <code>{result.model.artifactModelId}</code>
              </dd>
            </div>
            <div>
              <dt>模型哈希</dt>
              <dd>
                <code>{result.model.sha256}</code>
              </dd>
            </div>
            <div>
              <dt>特征 schema</dt>
              <dd>
                <code>{result.featureSchemaVersion}</code> · schema 哈希{' '}
                <code>{result.model.featureSchema.schemaSha256}</code>
              </dd>
            </div>
            <div>
              <dt>输入哈希</dt>
              <dd>
                <code>{result.inputSha256}</code>
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="result-section">
        <div className="section-caption">
          <span>预测解释</span>
          <span>
            {record.explanationStatus === 'supported'
              ? `方法 ${record.explanationMethod ?? ''}，按影响绝对值取前五项`
              : '未支持时只展示原因，不给任何归因数字'}
          </span>
        </div>
        {record.explanationStatus === 'supported' && record.explanation !== null ? (
          <>
            <p className="explanation-summary">{record.explanationSummary}</p>
            {record.explanation.length === 0 ? (
              <p className="muted">本次输入各字段与训练均值一致，没有可测的归因项。</p>
            ) : (
              <table className="explanation-table">
                <thead>
                  <tr>
                    <th scope="col">特征</th>
                    <th scope="col">输入值</th>
                    <th scope="col">训练均值</th>
                    <th scope="col">对风险的影响</th>
                  </tr>
                </thead>
                <tbody>
                  {record.explanation.map((item) => (
                    <tr key={item.feature}>
                      <th scope="row">
                        <code>{item.feature}</code>
                      </th>
                      <td>{String(item.value)}</td>
                      <td>{item.baseline.toFixed(3)}</td>
                      <td className={item.direction === 'increases' ? 'delta-up' : 'delta-down'}>
                        {item.direction === 'increases' ? '推高' : '拉低'} {Math.abs(item.delta).toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted">
              归因是把单个特征替换为训练集均值后风险的变化量，正值为推高、负值为拉低；它来自模型对单特征的敏感度，不是缺陷结论或代码定位。
            </p>
          </>
        ) : (
          <StatusNote tone="warn">预测解释未支持：{record.explanationReason ?? '服务端未给出原因'}</StatusNote>
        )}
      </section>

      <section className="result-section">
        <div className="section-caption">
          <span>来源详情与局限</span>
          <span>按服务端返回如实展示</span>
        </div>
        <ul className="schema-list">
          {result.limitations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <details className="model-details">
          <summary>展开完整来源声明</summary>
          <div className="model-details-body">
            <MetaBlock
              title="训练环境（产物声明）"
              value={result.model.trainingEnvironment === null ? '产物未记录训练环境' : result.model.trainingEnvironment}
            />
            <MetaBlock title="校验环境（本机）" value={result.model.verificationEnvironment} />
            <MetaBlock title="复现口径（方法声明）" value={result.model.reproducibility} />
          </div>
        </details>
        <p className="muted">本页不展示历史测试集指标：这些数字不描述本次单条输入的在线效果。</p>
      </section>

      <section className="result-section">
        <div className="section-caption">
          <span>结果链接</span>
          <span>链接只含批次身份，不含凭据，也不含输入内容</span>
        </div>
        <label className="field" htmlFor="result-link">
          <span className="sr-only">结果链接</span>
          <input id="result-link" type="text" readOnly value={link} onFocus={(event) => event.target.select()} />
        </label>
        <div className="json-actions">
          <button type="button" onClick={copy}>
            复制结果链接
          </button>
          <a href={link}>在新标签页打开</a>
        </div>
        {copied === null ? null : <StatusNote tone="info">{copied}</StatusNote>}
        <p className="muted">
          重新打开仍然需要有效的团队凭据；结果按团队共享，没有个人隔离，也没有全量历史列表。
        </p>
      </section>
    </>
  )
}

function BatchLookup({ onSubmit }: { onSubmit: (batchId: string) => void }) {  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const normalized = normalizedBatchId(value)
    if (normalized === null) {
      // 非法编号不发出任何请求。
      setError('批次编号必须是标准的 UUID，例如 3cc29957-8331-4646-94cc-cd81e97a0bb8')
      return
    }
    setError(null)
    onSubmit(normalized)
  }

  return (
    <form className="batch-lookup" onSubmit={submit} noValidate>
      <label className="field" htmlFor="batch-id">
        <span>批次编号</span>
        <input
          id="batch-id"
          name="batchId"
          type="text"
          autoComplete="off"
          value={value}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : 'batch-id-error'}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      {error === null ? null : (
        <p className="field-error" id="batch-id-error">
          {error}
        </p>
      )}
      <button type="submit" className="primary-button">
        打开已有结果
      </button>
    </form>
  )
}

export function PredictionsPage({
  navigate,
  batchId,
  snapshot,
}: {
  navigate: (route: Route) => void
  batchId: string | null
  snapshot: PredictionResult | null
}) {
  const found = batchId === null ? null : normalizedBatchId(batchId)
  const saved = snapshot !== null && found !== null && snapshot.batchId === found ? snapshot : null
  // 只有地址里带了合法编号、又不是刚创建的快照时才发起只读 GET；单纯的「打开已有结果」
  // 页面不能借着一个空编号去请求 /prediction-batches/null。
  const target = saved === null ? found : null
  const batch = useResource<PredictionResult | null>(
    (context) =>
      target === null ? Promise.resolve(null) : fetchPredictionBatch(context.token, target, context.signal),
    [target],
  )

  return (
    <div className="result-page">
      <header className="topbar">
        <div>
          <span className="project-symbol">
            <Icon name="search" />
          </span>
          <strong>预测结果</strong>
          <Icon name="chevron" size={14} />
          <span>按批次编号重开</span>
        </div>
      </header>
      <div className="page-heading">
        <div>
          <h1>预测结果</h1>
          <p className="page-intro">
            用批次编号重新打开一条已保存的单条预测，或直接使用创建时得到的结果链接。
          </p>
        </div>
      </div>

      {batchId === null ? (
        <EmptyState
          title="打开已有结果"
          description="输入创建预测时得到的批次编号。本应用不提供全量历史预测列表。"
        >
          <BatchLookup onSubmit={(value) => navigate({ name: 'result', batchId: value })} />
        </EmptyState>
      ) : found === null ? (
        <EmptyState
          tone="alert"
          title="批次编号无效"
          description={
            <>
              地址里的批次编号 <code>{batchId}</code> 不是标准 UUID，因此没有发出任何请求。
            </>
          }
        >
          <BatchLookup onSubmit={(value) => navigate({ name: 'result', batchId: value })} />
        </EmptyState>
      ) : saved !== null ? (
        <ResultBody result={saved} snapshot />
      ) : (
        <>
          {batch.status === 'credential-required' ? <CredentialNotice /> : null}
          {batch.status === 'loading' ? <LoadingNotice label="按批次编号读取已保存的结果。" /> : null}
          {batch.status === 'failed' ? (
            <>
              <FailureNotice error={batch.error} onRetry={batch.reload} />
              <BatchLookup onSubmit={(value) => navigate({ name: 'result', batchId: value })} />
            </>
          ) : null}
          {batch.data === null ? null : <ResultBody result={batch.data} snapshot={false} />}
        </>
      )}

      <footer className="page-foot">
        <span>JIT Review</span>
        <span>结果读取是只读请求；重开不会产生新的预测批次</span>
      </footer>
    </div>
  )
}
