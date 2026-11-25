import { Copy, ExternalLink, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { useEffect, useState } from 'react'
import { displayTime, validRisk, type Commit, type Dataset } from '@/lib/domain'
import { RepositoryExplanation } from '@/features/projects/components/RepositoryExplanation'
import { CommitEvidenceBadge } from '@/features/projects/components/CommitEvidenceBadge'
import { Risk } from '@/components/shared/Risk'

import { EmptyState } from '@/components/shared/Feedback'

export interface DetailProps { data: Dataset; id: string; record?: Commit; onClose: () => void }
/** 详情内容本身：外框（对话框、关闭与滚动）由调用方提供。 */
export function CommitDetail({ data, id, record: supplied, onClose }: DetailProps) {
  const record = supplied ?? data.records.find(item => item.id === id)
  const [copied, setCopied] = useState('')
  const [metricsOpen, setMetricsOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const original = record?.originalCommitUrl
  const safeOriginal = original && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commit\/(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(original) && original.endsWith('/'+id) ? original : null
  useEffect(() => { setCopied('') }, [id])
  async function copy() { try { await navigator.clipboard.writeText(id); setCopied('完整提交 ID 已复制') } catch { setCopied('自动复制不可用，可在来源中选择完整 ID。') } }
  return record ? <div className="grid gap-4">
    <div className="grid gap-1">
      <h2 className="text-lg font-semibold leading-title text-foreground">{record.title || `提交 ${record.id.slice(0, 12)}`}</h2>
      <p className="text-xs text-foreground-3">{record.authorName || '作者未提供'} <span>·</span> {displayTime(record.time)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-xs text-foreground-3">{record.id.slice(0, 12)}</code>
        <Button onClick={copy} aria-label="复制完整提交 ID" title="复制完整提交 ID" variant="ghost" size="icon-sm" type="button">{<Copy aria-hidden="true" focusable="false" strokeWidth={1.5} size={15}/>}</Button>
        {safeOriginal ? <a className="inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline" href={safeOriginal} target="_blank" rel="noopener noreferrer">原始提交 <ExternalLink aria-hidden="true" focusable="false" strokeWidth={1.5} size={14}/></a> : null}
      </div>
      {copied ? <p className="text-xs text-foreground-3" role="status">{copied}</p> : null}
    </div>
    <div className="grid gap-3 rounded-sm border border-border-soft bg-soft p-3 sm:grid-cols-2">
      <div className="grid gap-1"><span className="text-xs text-foreground-3">模型分数</span><Risk risk={record.risk} large/></div>
      {data.mode === 'repository' ? <div className="grid justify-items-start gap-1">
        <span className="text-xs text-foreground-3">缺陷引入证据</span>
        <CommitEvidenceBadge status={record.labelStatus}/>
        {record.observedThrough ? <span className="text-xs text-foreground-3">观察到 {displayTime(record.observedThrough).slice(0, 10)}</span> : null}
      </div> : null}
    </div>
    {data.mode === 'repository' && record.labelStatus === 'positive' ? <section aria-label="后续修复记录" className="grid gap-2">
      <h3 className="text-sm font-medium text-foreground">后续修复记录</h3>
      {record.labelEvidence?.length ? <ul className="grid gap-1.5">
        {record.labelEvidence.slice(0, 8).map(evidence => {
          const fixUrl = safeOriginal && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(evidence.fixCommit)
            ? safeOriginal.slice(0, -id.length) + evidence.fixCommit : null
          return <li key={`${evidence.fixCommit}:${evidence.path}`} className="min-w-0 rounded-sm border border-border-soft px-3 py-2 text-xs">
            {fixUrl ? <a href={fixUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-accent underline-offset-2 hover:underline">{evidence.fixCommit.slice(0, 12)}</a>
              : <code>{evidence.fixCommit.slice(0, 12)}</code>}
            <span className="ml-2 break-all text-foreground-2">{evidence.path}</span>
            {evidence.fixTime ? <time className="ml-2 text-foreground-3" dateTime={evidence.fixTime}>{displayTime(evidence.fixTime).slice(0, 10)}</time> : null}
          </li>
        })}
        {record.labelEvidence.length > 8 ? <li className="text-xs text-foreground-3">显示前 8 项，共 {record.labelEvidence.length} 项。</li> : null}
      </ul> : <p className="text-xs text-foreground-3">这份分析保存了正例标签，修复记录明细缺失。</p>}
    </section> : null}
    <div className="grid grid-cols-2 gap-3">
      <div className="grid gap-0.5"><span className="text-xs text-foreground-3">变更行</span><strong className="text-lg font-semibold text-foreground">{record.lines ?? '未提供'}</strong></div>
      <div className="grid gap-0.5"><span className="text-xs text-foreground-3">文件</span><strong className="text-lg font-semibold text-foreground">{record.files ?? '未提供'}</strong></div>
    </div>
    {data.mode === 'repository' && data.repository?.repositoryId && validRisk(record.risk) ? <RepositoryExplanation key={`${data.repository.repositoryId}:${data.repository.syncId}:${record.id}`} context={{ repositoryId: data.repository.repositoryId, viewSyncId: data.repository.syncId, commitId: record.id, risk: record.risk, modelId: data.repository.modelId, runId: data.repository.runId, datasetVersion: data.repository.datasetVersion }}/> : <p className="flex items-start gap-1.5 text-xs text-foreground-3"><Info aria-hidden="true" focusable="false" strokeWidth={1.5} size={14} className="mt-0.5 shrink-0"/>当前分析未提供逐条模型归因。</p>}
    <div className="flex flex-wrap gap-2 border-t border-border-soft pt-3">
      <Button size="sm" variant="outline" type="button" onClick={() => setMetricsOpen(true)}>原始变更度量（{Object.keys(record.metrics ?? {}).length} 项）</Button>
      <Button size="sm" variant="outline" type="button" onClick={() => setSourceOpen(true)}>来源与局限</Button>
    </div>
    <Dialog open={metricsOpen} onOpenChange={setMetricsOpen}>
      <DialogContent aria-describedby={undefined} className="max-h-[80vh] overflow-auto" style={{ width: 'min(92vw, 480px)', maxWidth: 'none' }}>
        <DialogHeader><DialogTitle>原始变更度量</DialogTitle></DialogHeader>
        <div className="grid gap-2">
          <dl className="grid gap-1">
            {Object.entries(record.metrics ?? {}).map(([name, value]) => <div key={name} className="flex items-baseline justify-between gap-3 border-t border-border-soft py-1 text-xs first:border-t-0">
              <dt className="text-foreground-3">{name}</dt><dd className="m-0 font-mono text-foreground">{value}</dd>
            </div>)}
          </dl>
          <p className="text-xs text-foreground-3">采集到的原始字段，不是模型归因。</p>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
      <DialogContent aria-describedby={undefined} className="max-h-[80vh] overflow-auto" style={{ width: 'min(92vw, 520px)', maxWidth: 'none' }}>
        <DialogHeader><DialogTitle>来源与局限</DialogTitle></DialogHeader>
        <div className="grid gap-2">
          <dl className="grid gap-1">
            <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 border-t border-border-soft py-1 text-xs first:border-t-0"><dt className="text-foreground-3">提交</dt><dd className="m-0 break-all"><code className="font-mono">{record.id}</code></dd></div>
            <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 border-t border-border-soft py-1 text-xs"><dt className="text-foreground-3">项目</dt><dd className="m-0 break-words">{data.project}</dd></div>
            <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 border-t border-border-soft py-1 text-xs"><dt className="text-foreground-3">数据</dt><dd className="m-0 break-all"><code className="font-mono">{data.version}</code></dd></div>
            {data.repository ? <>
              <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 border-t border-border-soft py-1 text-xs"><dt className="text-foreground-3">分支</dt><dd className="m-0 break-words">{data.repository.branch}</dd></div>
              <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 border-t border-border-soft py-1 text-xs"><dt className="text-foreground-3">分析</dt><dd className="m-0 break-all"><code className="font-mono">{data.repository.syncId}</code></dd></div>
            </> : <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 border-t border-border-soft py-1 text-xs"><dt className="text-foreground-3">运行</dt><dd className="m-0 break-all"><code className="font-mono">{data.runId}</code></dd></div>}
          </dl>
          <p className="text-xs text-foreground-3">{data.mode === 'repository' ? '仓库采集分析，新提交没有经过独立缺陷确认。' : '公开历史数据，回顾性评价。'}</p>
          {!safeOriginal ? <p className="text-xs text-foreground-3">此记录未提供受支持的原始提交外链，可复制完整 ID 核对。</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  </div> : <EmptyState title="提交不存在" description="该分析中未找到这个提交。"><Button onClick={onClose} variant="outline" type="button">返回列表</Button></EmptyState>
}
