import { useEffect, useRef, useState } from 'react'
import { displayTime, type Commit, type Dataset } from './domain'
import { Risk } from './Risk'
import { Icon } from './Icon'
import { EmptyState } from './Feedback'
import { DEGRADE_LABELS } from './repositoryContract'

export interface DetailProps {
  data: Dataset
  id: string
  /** 仓库模式下列表是分页读取的，记录不一定在 data.records 里；由调用方传入已取到的记录。 */
  record?: Commit
  added: boolean
  onAdd: () => void
  onClose: () => void
}

export function CommitDetail({ data, id, record: supplied, added, onAdd, onClose }: DetailProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const record = supplied ?? data.records.find(item => item.id === id)
  const historical = data.mode === 'historical'
  const repository = data.mode === 'repository'
  const real = data.mode !== 'demo'
  const original = record?.originalCommitUrl
  const safeOriginal = original && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commit\/(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(original) && original.endsWith('/' + record?.id) ? original : null
  const [copyState, setCopyState] = useState('')
  async function copyId() {
    try { await navigator.clipboard.writeText(id); setCopyState('完整提交 ID 已复制') }
    catch { setCopyState('自动复制不可用，请选择上方完整 ID 手动复制') }
  }
  useEffect(() => { closeButton.current?.focus() }, [id])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [onClose])
  return <aside className="detail-panel" role="dialog" aria-modal="false" aria-label="提交详情">
    <div className="detail-heading"><span><Icon name="list" size={17} />提交详情</span><button className="icon-button" ref={closeButton} aria-label="关闭详情" onClick={onClose}><Icon name="close" size={19} /></button></div>
    {record ? <>
      <div className="detail-body" role="region" aria-label="提交详情内容" tabIndex={0}>
      <div className="detail-identity"><code>{record.id}</code><h2>{record.title || '未提供'}</h2><time dateTime={record.time}>{displayTime(record.time)} · UTC+08:00</time></div>
      {repository ? <div className="commit-origin"><p>作者：{record.authorName || '未提供'}</p><button className="clear-button" onClick={copyId}>复制完整提交 ID</button>{copyState ? <p role="status">{copyState}</p> : null}{safeOriginal ? <a href={safeOriginal} target="_blank" rel="noopener noreferrer">查看原始提交 ↗</a> : <p className="muted">本地或旧记录未提供可用外链，请使用完整 ID 在原仓库定位。</p>}</div> : null}
      <div className="detail-risk"><span className="detail-label">{real ? '模型分数' : '示例风险分数'}</span><Risk risk={record.risk} large /><p>{repository ? '同步模型对这批提交的估计，未经概率校准；不表示已确认缺陷。' : historical ? '固定模型对历史测试提交的估计，未经概率校准；不表示已确认缺陷。' : '人工设定的演示值，不表示实际推理或缺陷结论。'}</p></div>
      <div className="detail-section"><h3>变更概览</h3><div className="detail-metrics"><div><span>变更行数</span><strong>{record.lines ?? '未提供'}</strong></div><div><span>涉及文件</span><strong>{record.files ?? '未提供'}</strong></div></div><dl className="metric-list">{record.metrics && Object.keys(record.metrics).length ? Object.entries(record.metrics).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>) : <div><dt>其他度量</dt><dd>未提供</dd></div>}</dl>{repository ? <p className="muted">以上为本次从仓库采集的原始变更度量（Kamei14 子集），不是模型归因；入模字段与训练口径见来源说明。</p> : null}</div>
      <div className="detail-section"><h3>{real ? '预测解释' : <>示例解释 <span>人工说明</span></>}</h3>{!real && record.explanation?.length ? <ul className="explanation-list">{record.explanation.map((text, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span>{text}</li>)}</ul> : <p className="muted">{repository ? '预测解释未提供。上方 14 个字段是采集到的原始度量，不是模型归因。' : historical ? (data.summary?.featureSchema ? '预测解释未提供。上方度量为当前 schema 声明的原始字段值，不是模型归因。' : '预测解释未提供。上方六字段是原始度量，不是模型归因。') : '未提供'}</p>}</div>
      <details className="detail-source"><summary>{real ? '来源与局限' : '演示来源'}</summary><p>{data.project} / <code>{data.version}</code> · {repository ? '仓库同步数据' : historical ? '真实历史回放' : '演示模式'}</p>{repository ? <><p><code>{data.repository?.repositoryUrl}</code> · 分支 <code>{data.repository?.branch}</code></p><p>同步 <code>{data.repository?.syncId}</code> · 模型来源 {data.repository?.modelStrategy === 'repository-trained' ? '本仓库数据训练' : data.repository?.modelStrategy === 'generic-model' ? '现成通用模型' : '未记录'}{data.repository?.degradeReason ? `（降级原因：${DEGRADE_LABELS[data.repository.degradeReason] ?? data.repository.degradeReason}）` : ''}</p><p>{data.repository?.labelNote || '标签由简化 SZZ 生成；最近一段提交没有被修复过，因此没有标签。'}</p></> : historical ? <><p>{data.model?.name} · 运行 <code>{data.runId}</code></p><p>{data.summary?.featureSchema ? '回顾性评价；未验证历史当时标签可获得性。' : '回顾性评价；尚非完整 Kamei14，未验证历史当时标签可获得性。'}</p></> : null}</details>
      </div>
      <div className="detail-action"><button className="primary-button" disabled={added} onClick={onAdd}><Icon name={added ? 'check' : 'plus'} size={17} />{added ? '已在清单' : '加入清单'}</button><p>个人审查计划，不会改写提交风险</p></div>
    </> : <EmptyState title="提交不存在" description="当前数据中没有这个提交标识。"><button className="primary-button" onClick={onClose}>返回列表</button></EmptyState>}
  </aside>
}
