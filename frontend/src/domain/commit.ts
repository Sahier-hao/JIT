import type { SyncCommit } from '../api/repositories'

/** 工作台统一的提交记录：历史回放与仓库分析都归一到这一个形状。 */
export interface Commit {
  id: string
  time: string
  risk?: unknown
  lines?: number
  files?: number
  title?: string
  authorName?: string | null
  originalCommitUrl?: string | null
  metrics?: Record<string, number>
  explanation?: string[]
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
export function shanghaiDate(time: string): string {
  return dateFormatter.format(new Date(time))
}

const timeFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
export function displayTime(time: string): string {
  return timeFormatter.format(new Date(time))
}

/**
 * 同步提交 → 工作台记录：只做字段改名与单位换算，风险与度量原样带过来。
 * 列表页、清单逐条读取与数据集解析共用这一个映射，避免三处各写一遍。
 */
export function toCommit(commit: SyncCommit): Commit {
  return {
    id: commit.commitId,
    time: new Date(commit.epoch * 1000).toISOString(),
    risk: commit.risk,
    lines: commit.addedLines + commit.deletedLines,
    files: commit.files,
    title: commit.subject ?? '',
    authorName: commit.authorName,
    originalCommitUrl: commit.originalCommitUrl,
    metrics: commit.metrics,
  }
}
