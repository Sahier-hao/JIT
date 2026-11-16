import { Copy, ExternalLink, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'

import { useEffect, useState } from 'react'
import { displayTime, validRisk, type Commit, type Dataset } from './domain'
import { RepositoryExplanation } from './components/RepositoryExplanation'
import { Risk } from './Risk'

import { EmptyState } from './Feedback'

export interface DetailProps { data: Dataset; id: string; record?: Commit; onClose: () => void }
/** 详情内容本身：外框（对话框、关闭与滚动）由调用方提供。 */
export function CommitDetail({ data, id, record: supplied, onClose }: DetailProps) {
  const record = supplied ?? data.records.find(item => item.id === id)
  const [copied, setCopied] = useState('')
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
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-sm border border-border-soft bg-soft p-3">
      <div className="grid gap-1"><span className="text-xs text-foreground-3">模型分数</span><Risk risk={record.risk} large/></div>
      <p className="max-w-sm text-xs leading-body text-foreground-3">用于排序参考，未经概率校准，不代表已确认缺陷。</p>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="grid gap-0.5"><span className="text-xs text-foreground-3">变更行</span><strong className="text-lg font-semibold text-foreground">{record.lines ?? '未提供'}</strong></div>
      <div className="grid gap-0.5"><span className="text-xs text-foreground-3">文件</span><strong className="text-lg font-semibold text-foreground">{record.files ?? '未提供'}</strong></div>
    </div>
    {data.mode === 'repository' && data.repository?.repositoryId && validRisk(record.risk) ? <RepositoryExplanation key={`${data.repository.repositoryId}:${data.repository.syncId}:${record.id}`} context={{ repositoryId: data.repository.repositoryId, viewSyncId: data.repository.syncId, commitId: record.id, risk: record.risk, modelId: data.repository.modelId, runId: data.repository.runId, datasetVersion: data.repository.datasetVersion }}/> : <p className="flex items-start gap-1.5 text-xs text-foreground-3"><Info aria-hidden="true" focusable="false" strokeWidth={1.5} size={14} className="mt-0.5 shrink-0"/>当前分析未提供逐条模型归因。</p>}
    <details className="rounded-sm border border-border-soft">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground-2">原始变更度量 <span className="text-xs font-normal text-foreground-3">{Object.keys(record.metrics ?? {}).length} 项</span></summary>
      <div className="grid gap-1 border-t border-border-soft p-3">
        <dl className="grid gap-1">
          {Object.entries(record.metrics ?? {}).map(([name, value]) => <div key={name} className="flex items-baseline justify-between gap-3 border-t border-border-soft py-1 text-xs first:border-t-0">
            <dt className="text-foreground-3">{name}</dt><dd className="m-0 font-mono text-foreground">{value}</dd>
          </div>)}
        </dl>
        <p className="text-xs text-foreground-3">采集到的原始字段，不是模型归因。</p>
      </div>
    </details>
    <details className="rounded-sm border border-border-soft">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground-2">来源与局限</summary>
      <div className="grid gap-2 border-t border-border-soft p-3">
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
    </details>
  </div> : <EmptyState title="提交不存在" description="该分析中未找到这个提交。"><Button onClick={onClose} variant="outline" type="button">返回列表</Button></EmptyState>
}
