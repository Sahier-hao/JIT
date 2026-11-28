import { DOC_ARTICLES, type DocArticle } from '@/features/docs/catalog'

export interface DocsHeading {
  id: string
  title: string
  level: 2 | 3 | 4
  body: string
}

export interface ParsedDoc {
  intro: string
  headings: DocsHeading[]
}

export interface DocsSearchResult {
  id: string
  articleSlug: string
  articleTitle: string
  sectionId: string
  sectionTitle: string
  snippet: string
  score: number
}

const HEADING = /^(#{2,4})\s+(.+?)\s*\{#([A-Za-z][A-Za-z0-9_-]*)\}\s*$/
const FENCE = /^\s*(`{3,}|~{3,})/

const SYNONYMS: Record<string, string[]> = {
  '风险分': ['风险分', '风险分数', '模型分数', '提交分数', '最高分', 'risk'],
  '私有仓库': ['私有仓库', '仓库权限', 'github 权限', '关联 github', 'private repository'],
  '模型兼容': ['模型兼容', '兼容模型', '模型列表为空', '没有可用模型', '模型不可用', 'schema 兼容'],
  'vscode': ['vs code', 'vscode', '插件', '扩展'],
  'vs code': ['vs code', 'vscode', '插件', '扩展'],
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function plain(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`|~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseDocsArticle(body: string): ParsedDoc {
  const lines = body.split(/\r?\n/)
  const headings: DocsHeading[] = []
  const intro: string[] = []
  let current: { id: string; title: string; level: 2 | 3 | 4; lines: string[] } | null = null
  let inFence = false

  for (const line of lines) {
    if (FENCE.test(line)) {
      if (current) current.lines.push(line)
      else intro.push(line)
      inFence = !inFence
      continue
    }
    const match = inFence ? null : line.match(HEADING)
    if (match) {
      if (current) headings.push({ id: current.id, title: current.title, level: current.level, body: current.lines.join('\n').trim() })
      current = { id: match[3], title: match[2].trim(), level: Number(match[1].length) as 2 | 3 | 4, lines: [] }
      continue
    }
    if (current) current.lines.push(line)
    else intro.push(line)
  }
  if (current) headings.push({ id: current.id, title: current.title, level: current.level, body: current.lines.join('\n').trim() })
  return { intro: intro.join('\n').trim(), headings }
}

function searchVariants(query: string): string[] {
  const key = normalize(query)
  const values = new Set([key])
  for (const [alias, expansions] of Object.entries(SYNONYMS)) {
    const normalizedAlias = normalize(alias)
    if (key.includes(normalizedAlias) || normalizedAlias.includes(key)) {
      for (const value of expansions) values.add(normalize(value))
    }
  }
  return [...values].filter(Boolean)
}

function snippet(body: string, variants: string[]): string {
  const text = plain(body)
  const lower = text.toLocaleLowerCase()
  const index = variants.map(value => lower.indexOf(value)).filter(value => value >= 0).sort((a, b) => a - b)[0]
  if (index == null) return text.slice(0, 88) + (text.length > 88 ? '…' : '')
  const start = Math.max(0, index - 34)
  const end = Math.min(text.length, index + 96)
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

export function searchDocs(query: string, limit = 12): DocsSearchResult[] {
  const variants = searchVariants(query)
  if (!variants.length || !variants[0]) return []
  const results: DocsSearchResult[] = []
  for (const article of DOC_ARTICLES) {
    const parsed = parseDocsArticle(article.body)
    const articleTitle = normalize(article.title)
    const sections = parsed.headings.length
      ? parsed.headings
      : [{ id: 'top', title: article.title, level: 2 as const, body: article.body }]
    sections.forEach((heading, index) => {
      const headingTitle = normalize(heading.title)
      const sectionBody = normalize(`${heading.body} ${index === 0 ? parsed.intro : ''}`)
      let score = 0
      for (const variant of variants) {
        if (articleTitle.includes(variant)) score = Math.max(score, 120)
        if (headingTitle.includes(variant)) score = Math.max(score, 80)
        if (sectionBody.includes(variant)) score = Math.max(score, 30)
      }
      if (!score) return
      const body = `${heading.body}\n${index === 0 ? parsed.intro : ''}`.trim()
      results.push({
        id: `${article.slug}:${heading.id}`,
        articleSlug: article.slug,
        articleTitle: article.title,
        sectionId: heading.id,
        sectionTitle: heading.title,
        snippet: snippet(body || article.summary, variants),
        score: score + Math.max(0, 8 - index),
      })
    })
  }
  return results
    .sort((left, right) => right.score - left.score
      || DOC_ARTICLES.findIndex(article => article.slug === left.articleSlug) - DOC_ARTICLES.findIndex(article => article.slug === right.articleSlug))
    .slice(0, limit)
}

export function docsSections(article: DocArticle): DocsHeading[] {
  return parseDocsArticle(article.body).headings
}
