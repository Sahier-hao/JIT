import { useEffect, useRef, useState } from 'react'
import { displayTime, type Commit, type Dataset } from './domain'
import { Risk } from './Risk'
import { Icon } from './Icon'
import { EmptyState } from './Feedback'

export interface DetailProps { data: Dataset; id: string; record?: Commit; added: boolean; onAdd: () => void; onClose: () => void; readOnly?: boolean }
export function CommitDetail({ data, id, record: supplied, added, onAdd, onClose, readOnly = false }: DetailProps) {
  const close = useRef<HTMLButtonElement>(null)
  const record = supplied ?? data.records.find(item => item.id === id)
  const [copied, setCopied] = useState<{ id: string; message: string } | null>(null)
  const original = record?.originalCommitUrl
  const safeOriginal = original && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commit\/(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(original) && original.endsWith('/'+id) ? original : null
  useEffect(() => { close.current?.focus() }, [id])
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }; document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape) }, [onClose])
  async function copy() { try { await navigator.clipboard.writeText(id); setCopied({ id, message: '完整提交 ID 已复制' }) } catch { setCopied({ id, message: '自动复制不可用，可在来源中选择完整 ID。' }) } }
  return <aside className="detail-panel" role="dialog" aria-modal="false" aria-label="提交详情"><header className="detail-heading"><span>提交详情</span><button className="icon-button" ref={close} aria-label="关闭详情" onClick={onClose}><Icon name="close" size={18}/></button></header>{record ? <><div className="detail-body"><div className="detail-identity"><h2>{record.title || `提交 ${record.id.slice(0, 12)}`}</h2><p>{record.authorName || '作者未提供'} <span>·</span> {displayTime(record.time)}</p><div className="commit-actions"><code>{record.id.slice(0, 12)}</code><button className="icon-button" aria-label="复制完整提交 ID" onClick={copy}><Icon name="copy" size={15}/></button>{safeOriginal ? <a href={safeOriginal} target="_blank" rel="noopener noreferrer">原始提交 <Icon name="external" size={14}/></a> : null}</div>{copied?.id === id ? <p className="muted" role="status">{copied.message}</p> : null}</div>
    <div className="detail-risk"><div><span>模型分数</span><Risk risk={record.risk} large/></div><p>用于安排审查，未经概率校准，不代表已确认缺陷。</p></div>
    <div className="detail-metrics"><div><span>变更行</span><strong>{record.lines ?? '未提供'}</strong></div><div><span>文件</span><strong>{record.files ?? '未提供'}</strong></div></div>
    <p className="detail-explanation-note"><Icon name="info" size={14}/>当前分析未提供逐条模型归因。</p>
    <details className="detail-disclosure"><summary>原始变更度量 <span>{Object.keys(record.metrics ?? {}).length} 项</span></summary><dl className="metric-list">{Object.entries(record.metrics ?? {}).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><p className="muted">采集到的原始字段，不是模型归因。</p></details>
    <details className="detail-disclosure"><summary>来源与局限</summary><dl className="source-facts"><div><dt>提交</dt><dd><code>{record.id}</code></dd></div><div><dt>项目</dt><dd>{data.project}</dd></div><div><dt>数据</dt><dd><code>{data.version}</code></dd></div>{data.repository ? <><div><dt>分支</dt><dd>{data.repository.branch}</dd></div><div><dt>分析</dt><dd><code>{data.repository.syncId}</code></dd></div></> : <div><dt>运行</dt><dd><code>{data.runId}</code></dd></div>}</dl><p className="muted">{data.mode === 'repository' ? '仓库采集分析，新提交没有经过独立缺陷确认。' : '公开历史数据，回顾性评价。'}</p>{!safeOriginal ? <p className="muted">此记录未提供受支持的原始提交外链，可复制完整 ID 核对。</p> : null}</details></div>
    {!readOnly ? <footer className="detail-action"><button className="primary-button" disabled={added} onClick={onAdd}><Icon name={added ? 'check' : 'plus'} size={17}/>{added ? '已加入审查计划' : '加入审查计划'}</button><p>个人选择，不会修改模型输出。</p></footer> : null}</> : <EmptyState title="提交不存在" description="该分析中未找到这个提交。"><button onClick={onClose}>返回列表</button></EmptyState>}</aside>
}
