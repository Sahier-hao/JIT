import { ContractError } from '@/lib/apiContract'
import type { Route } from '@/app/navigation'
import type { PRSnapshot } from '@/features/reviews/prReviewClient'
import { downloadText, backupText, type PRWork } from '@/features/reviews/prReview'

export type Navigate = (route: Route) => void

export const message = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试'
export const changeLabels: Record<string, string> = { added: '新增', removed: '删除', modified: '修改', renamed: '重命名', copied: '复制', changed: '内容变化', unchanged: '未变化' }
export const FILE_FLAG: Record<string, string> = { added: 'bg-teal', removed: 'bg-rose', modified: 'bg-amber', renamed: 'bg-blue', copied: 'bg-blue', changed: 'bg-amber', unchanged: 'bg-foreground-4' }

/** 文件行把路径拆成"目录 + 文件名"：目录可以被省略号吃掉，文件名必须始终完整。 */
export function splitPath(path: string) {
  const index = path.lastIndexOf('/')
  return index < 0 ? { dir: '', name: path } : { dir: path.slice(0, index + 1), name: path.slice(index + 1) }
}

export function backup(work: PRWork, account: string | null) {
  downloadText(`review-${work.owner}-${work.name}-${work.number}.json`, backupText(work, account), 'application/json')
}

export function validateProjectSource(source: PRSnapshot, owner: string, name: string, number: number, repositoryId?: string) {
  if (source.owner.toLowerCase() !== owner.toLowerCase() || source.name.toLowerCase() !== name.toLowerCase() || source.number !== number || repositoryId && source.repositoryId !== repositoryId) throw new ContractError('PR 固定来源与项目上下文不一致，未修改个人草稿')
}
