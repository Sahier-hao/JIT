import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DOC_ARTICLES, DOC_GROUPS, articleBySlug, articlesInGroup } from '@/features/docs/catalog'
import { parseDocsArticle, searchDocs } from '@/features/docs/docsContent'

it('publishes nine unique articles across all four navigation groups', () => {
  expect(DOC_ARTICLES).toHaveLength(9)
  expect(new Set(DOC_ARTICLES.map(article => article.slug)).size).toBe(9)
  expect(DOC_GROUPS).toHaveLength(4)
  for (const group of DOC_GROUPS) expect(articlesInGroup(group.id).length).toBeGreaterThan(0)
  expect(articleBySlug('first-pr-review')?.group).toBe('quick-start')
})

it('gives every article unique stable section ids and no duplicate page title', () => {
  for (const article of DOC_ARTICLES) {
    expect(article.body).not.toMatch(/^# /m)
    const headings = parseDocsArticle(article.body).headings
    expect(headings.length).toBeGreaterThan(0)
    expect(new Set(headings.map(heading => heading.id)).size).toBe(headings.length)
    for (const heading of headings) expect(heading.id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/)
  }
})

it('only links to published articles and existing sections', () => {
  for (const article of DOC_ARTICLES) {
    for (const match of article.body.matchAll(/#\/docs\/([A-Za-z0-9_-]+)(?:\?section=([A-Za-z0-9_-]+))?/g)) {
      const target = articleBySlug(match[1])
      expect(target, `${article.slug} links to ${match[1]}`).toBeDefined()
      if (match[2]) {
        const ids = parseDocsArticle(target!.body).headings.map(heading => heading.id)
        expect(ids, `${article.slug} links to ${match[1]}#${match[2]}`).toContain(match[2])
      }
    }
  }
})

it('uses local public images that exist in the build input', () => {
  const images = DOC_ARTICLES.flatMap(article => [...article.body.matchAll(/!\[[^\]]*\]\((\/[^)]+)\)/g)].map(match => match[1]))
  expect(images).toContain('/docs/first-pr-review-flow.svg')
  for (const image of images) expect(existsSync(join(process.cwd(), 'public', image.slice(1))), image).toBe(true)
})

it('searches real Chinese terms and returns linkable context', () => {
  const checks = [
    ['风险分', 'reading-results'],
    ['私有仓库', 'faq'],
    ['模型兼容', 'faq'],
    ['VS Code', 'vscode-commit-check'],
  ] as const
  for (const [query, slug] of checks) {
    const results = searchDocs(query)
    expect(results.length, query).toBeGreaterThan(0)
    expect(results.some(result => result.articleSlug === slug), query).toBe(true)
    expect(results[0].snippet.length).toBeGreaterThan(0)
    expect(results[0].sectionId).not.toBe('')
  }
  expect(searchDocs('完全不存在的中文检索词')).toEqual([])
})

it('prioritizes titles and section headings over body-only matches', () => {
  const [first] = searchDocs('缺陷预测')
  expect(first.articleSlug).toBe('what-is-jit')
})

it('ignores headings inside code fences', () => {
  const parsed = parseDocsArticle('intro\n\n```md\n## 伪标题 {#fake}\n```\n\n## 真标题 {#real}')
  expect(parsed.headings.map(heading => heading.id)).toEqual(['real'])
})

it('does not embed private admin or local account material', () => {
  const text = DOC_ARTICLES.map(article => article.body).join('\n')
  expect(text).not.toContain('C:\\Users\\')
  expect(text).not.toContain('/admin/datasets')
  expect(text).not.toContain('password=')
})
