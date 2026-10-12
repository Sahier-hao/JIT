import { useEffect, useRef } from 'react'
import { displayTime, type Dataset } from './domain'
import { Risk } from './Risk'
import { Icon } from './Icon'
export interface DetailProps { data: Dataset; id: string; added: boolean; onAdd: () => void; onClose: () => void }
export function CommitDetail({ data, id, added, onAdd, onClose }: DetailProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const record = data.records.find(item => item.id === id)
  const historical = data.mode === 'historical'
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
      <div className="detail-risk"><span className="detail-label">{historical ? '模型估计风险' : '示例风险分数'}</span><Risk risk={record.risk} large /><p>{historical ? '固定模型对历史测试提交的估计，未经概率校准；不表示已确认缺陷。' : '人工设定的演示值，不表示实际推理或缺陷结论。'}</p></div>
      <div className="detail-section"><h3>变更概览</h3><div className="detail-metrics"><div><span>变更行数</span><strong>{record.lines ?? '未提供'}</strong></div><div><span>涉及文件</span><strong>{record.files ?? '未提供'}</strong></div></div><dl className="metric-list">{record.metrics && Object.keys(record.metrics).length ? Object.entries(record.metrics).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>) : <div><dt>其他度量</dt><dd>未提供</dd></div>}</dl></div>
      <div className="detail-section"><h3>{historical ? '预测解释' : <>示例解释 <span>人工说明</span></>}</h3>{!historical && record.explanation?.length ? <ul className="explanation-list">{record.explanation.map((text, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span>{text}</li>)}</ul> : <p className="muted">{historical ? '预测解释未提供。上方六字段是原始度量，不是模型归因。' : '未提供'}</p>}</div>
      <div className="detail-source"><span className="detail-label">{historical ? '真实历史来源' : '演示来源'}</span><p>{data.project} / <code>{data.version}</code> · {historical ? '真实历史回放' : '演示模式'}</p>{historical ? <><p>{data.model?.name} · 运行 <code>{data.runId}</code></p><p>回顾性评价；尚非完整 Kamei14，未验证历史当时标签可获得性。</p></> : null}</div>
      </div>
      <div className="detail-action"><button className="primary-button" disabled={added} onClick={onAdd}><Icon name={added ? 'check' : 'plus'} size={17} />{added ? '已在清单' : '加入清单'}</button><p>个人审查计划，不会改写提交风险</p></div>
    </> : <div className="empty-state"><h2>提交不存在</h2><p>当前数据中没有这个提交标识。</p><button className="primary-button" onClick={onClose}>返回列表</button></div>}
  </aside>
}
