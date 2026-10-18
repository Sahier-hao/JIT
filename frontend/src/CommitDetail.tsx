import { useEffect, useRef } from 'react'
import { displayTime, type Commit, type Dataset } from './domain'
import { Risk } from './Risk'
import { Icon } from './Icon'
export interface DetailProps { data: Dataset; id: string; record?: Commit; added: boolean; onAdd: () => void; onClose: () => void }
export function CommitDetail({ data, id, record: supplied, added, onAdd, onClose }: DetailProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  // 仓库模式下提交是分页读取的，不一定在 data.records 里；由调用方把已取到的记录传进来。
  const record = supplied ?? data.records.find(item => item.id === id)
  const historical = data.mode === 'historical'
  const repository = data.mode === 'repository'
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
      <div className="detail-risk"><span className="detail-label">{historical || repository ? '模型估计风险' : '示例风险分数'}</span><Risk risk={record.risk} large /><p>{repository ? '同步模型对这批提交的估计，未经概率校准；不表示已确认缺陷。' : historical ? '固定模型对历史测试提交的估计，未经概率校准；不表示已确认缺陷。' : '人工设定的演示值，不表示实际推理或缺陷结论。'}</p></div>
      <div className="detail-section"><h3>变更概览</h3><div className="detail-metrics"><div><span>变更行数</span><strong>{record.lines ?? '未提供'}</strong></div><div><span>涉及文件</span><strong>{record.files ?? '未提供'}</strong></div></div><dl className="metric-list">{record.metrics && Object.keys(record.metrics).length ? Object.entries(record.metrics).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>) : <div><dt>其他度量</dt><dd>未提供</dd></div>}</dl>{repository ? <p className="muted">以上为本次从仓库采集的原始变更度量（Kamei14 子集），不是模型归因；入模字段与训练口径见来源说明。</p> : null}</div>
      <div className="detail-section"><h3>{historical || repository ? '预测解释' : <>示例解释 <span>人工说明</span></>}</h3>{!historical && !repository && record.explanation?.length ? <ul className="explanation-list">{record.explanation.map((text, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span>{text}</li>)}</ul> : <p className="muted">{repository ? '预测解释未提供。上方 14 个字段是采集到的原始度量，不是模型归因。' : historical ? (data.summary?.featureSchema ? '预测解释未提供。上方度量为当前 schema 声明的原始字段值，不是模型归因。' : '预测解释未提供。上方六字段是原始度量，不是模型归因。') : '未提供'}</p>}</div>
      <div className="detail-source"><span className="detail-label">{repository ? '仓库同步来源' : historical ? '真实历史来源' : '演示来源'}</span><p>{data.project} / <code>{data.version}</code> · {repository ? '仓库同步' : historical ? '真实历史回放' : '演示模式'}</p>{repository ? <><p><code>{data.repository?.repositoryUrl}</code> · 分支 <code>{data.repository?.branch}</code></p><p>同步 <code>{data.repository?.syncId}</code> · 模型来源 {data.repository?.modelStrategy === 'repository-trained' ? '本仓库数据训练' : data.repository?.modelStrategy === 'generic-model' ? '现成通用模型' : '未记录'}{data.repository?.degradeReason ? `（降级原因：${data.repository.degradeReason}）` : ''}</p><p>{data.repository?.labelNote || '标签由简化 SZZ 生成；最近一段提交没有被修复过，因此没有标签。'}</p></> : historical ? <><p>{data.model?.name} · 运行 <code>{data.runId}</code></p><p>{data.summary?.featureSchema ? '回顾性评价；未验证历史当时标签可获得性。' : '回顾性评价；尚非完整 Kamei14，未验证历史当时标签可获得性。'}</p></> : null}</div>
      </div>
      <div className="detail-action"><button className="primary-button" disabled={added} onClick={onAdd}><Icon name={added ? 'check' : 'plus'} size={17} />{added ? '已在清单' : '加入清单'}</button><p>个人审查计划，不会改写提交风险</p></div>
    </> : <div className="empty-state"><h2>提交不存在</h2><p>当前数据中没有这个提交标识。</p><button className="primary-button" onClick={onClose}>返回列表</button></div>}
  </aside>
}
