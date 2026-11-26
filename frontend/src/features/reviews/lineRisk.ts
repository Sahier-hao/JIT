import type { LineScore } from '@/features/research/lineResearch'
import { parsePatchLines } from '@/features/reviews/prReview'

const LANGUAGES: Record<string, 'typescript' | 'javascript'> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
}

export function lineRiskLanguage(path: string): 'typescript' | 'javascript' | null {
  const name = path.split('/').pop() ?? ''
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return LANGUAGES[extension] ?? null
}

/** 只取真实 diff 中新增/修改后的目标侧行号；不把 `+++` 文件头当成代码行。 */
export function addedHeadLines(patch: string | null): number[] {
  if (!patch) return []
  const lines = parsePatchLines(patch)
    .filter(item => item.kind === 'add' && item.line != null && !item.text.startsWith('+++'))
    .map(item => item.line!)
  return [...new Set(lines)]
}

/** 只展示当前 PR 文件实际新增/修改的行，不把整份源码都塞进行级排序。 */
export function rankChangedLineScores(
  lines: LineScore[],
  changed: ReadonlySet<number>,
  limit = 10,
): LineScore[] {
  return lines
    .filter(item => changed.has(item.line))
    .sort((left, right) => right.score - left.score || left.line - right.line)
    .slice(0, limit)
}
