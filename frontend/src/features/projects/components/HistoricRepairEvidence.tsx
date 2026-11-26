import type { CommitLabelEvidence } from '@/features/projects/repositoryContract'

function repositoryBase(value: string | null | undefined): string | null {
  if (!value) return null
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/(?:commit\/[a-f0-9]{40,64}|pull\/\d+))?\/?$/.exec(value)
  return match ? `https://github.com/${match[1]}/${match[2]}` : null
}

function rangesText(ranges: Array<[number, number]> | null, prefix: string): string | null {
  if (!ranges?.length) return null
  return `${prefix} ${ranges.slice(0, 4).map(([start, end]) => start === end ? `${start}` : `${start}–${end}`).join('、')}${ranges.length > 4 ? '…' : ''}`
}

function repairUrl(base: string | null, evidence: CommitLabelEvidence): string | null {
  if (!base || !/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(evidence.fixCommit)) return null
  const line = evidence.parentRanges?.[0]?.[0]
  const anchor = evidence.diffAnchor && /^diff-[a-f0-9]{32}$/.test(evidence.diffAnchor)
    ? `#${evidence.diffAnchor}${line ? `L${line}` : ''}`
    : ''
  return `${base}/commit/${evidence.fixCommit}${anchor}`
}

/** 历史 SZZ 修复证据只读展示；不生成、不应用补丁。 */
export function HistoricRepairEvidence({ evidence, repositoryUrl, limit = 8 }: {
  evidence: CommitLabelEvidence[]
  repositoryUrl: string | null | undefined
  limit?: number
}) {
  if (!evidence.length) return null
  const base = repositoryBase(repositoryUrl)
  return <section aria-label="后续修复证据" className="grid gap-2">
    <h3 className="text-sm font-medium text-foreground">后续修复证据</h3>
    <ul className="grid gap-1.5">
      {evidence.slice(0, limit).map(item => {
        const url = repairUrl(base, item)
        const fixRanges = rangesText(item.parentRanges, '修复 diff 行')
        const introducedRanges = rangesText(item.lineRanges, '引入行')
        return <li key={`${item.fixCommit}:${item.path}:${item.ruleVersion ?? ''}`} className="min-w-0 rounded-sm border border-border-soft px-3 py-2 text-xs">
          {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono text-accent underline-offset-2 hover:underline" title="打开修复提交 diff 的对应文件">{item.fixCommit.slice(0, 12)}</a>
            : <code>{item.fixCommit.slice(0, 12)}</code>}
          <span className="ml-2 break-all text-foreground-2">{item.path}</span>
          {fixRanges ? <span className="ml-2 text-foreground-2">{fixRanges}</span> : null}
          {introducedRanges ? <span className="ml-2 text-foreground-3">{introducedRanges}</span> : null}
          {item.fixTime ? <time className="ml-2 text-foreground-3" dateTime={item.fixTime}>{item.fixTime.slice(0, 10)}</time> : null}
        </li>
      })}
      {evidence.length > limit ? <li className="text-xs text-foreground-3">显示前 {limit} 项，共 {evidence.length} 项。</li> : null}
    </ul>
    <p className="text-xs text-foreground-3">历史修复是参考证据，不是模型生成的修复建议。</p>
  </section>
}
