import { render, screen, waitFor } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { DocsPage } from '@/features/docs/pages/DocsPage'

afterEach(() => vi.restoreAllMocks())

it('shows the first-review path, four groups and anonymous search', () => {
  render(<DocsPage route={{ name: 'docs' }} navigate={vi.fn()}/>)
  expect(screen.getByRole('heading', { name: '产品文档' })).toBeVisible()
  expect(screen.getByRole('link', { name: /完成第一次 PR 审查/ })).toBeVisible()
  for (const group of ['快速开始', '使用指南', '背景知识', '常见问题']) expect(screen.getByRole('heading', { name: group })).toBeVisible()
  expect(screen.getByRole('textbox', { name: '搜索文档' })).toBeVisible()
})

it('opens an article without requesting project, model or report APIs', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
  render(<DocsPage route={{ name: 'docs', slug: 'reading-results', section: 'commit-score' }} navigate={vi.fn()}/>)
  const heading = screen.getByRole('heading', { name: '提交级风险分是什么' })
  expect(heading).toHaveAttribute('id', 'commit-score')
  await waitFor(() => expect(scroll).toHaveBeenCalled())
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps the article visible and explains an unknown section', () => {
  render(<DocsPage route={{ name: 'docs', slug: 'reading-results', section: 'not-here' }} navigate={vi.fn()}/>)
  expect(screen.getByRole('heading', { name: '怎么看风险分和代码线索' })).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('没有找到“not-here”这个本节')
})

it('shows a docs-local empty state for an unpublished article', async () => {
  const navigate = vi.fn()
  const user = userEvent.setup()
  render(<DocsPage route={{ name: 'docs', slug: 'missing-guide' }} navigate={navigate}/>)
  expect(screen.getByRole('heading', { name: '没有这篇文档' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: '返回文档首页' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'docs' })
})

it('supports arrow navigation, Enter and Escape in search', async () => {
  const navigate = vi.fn()
  const user = userEvent.setup()
  render(<DocsPage route={{ name: 'docs' }} navigate={navigate}/>)
  const input = screen.getByRole('textbox', { name: '搜索文档' })
  await user.type(input, 'VS Code')
  const options = await screen.findAllByRole('option')
  expect(options.length).toBeGreaterThan(1)
  expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
  await user.keyboard('{ArrowDown}')
  expect(input).toHaveAttribute('aria-activedescendant', options[1].id)
  await user.keyboard('{Enter}')
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ name: 'docs', slug: expect.any(String), section: expect.any(String) }))

  await user.type(input, '私有仓库')
  expect(await screen.findByRole('listbox', { name: '文档搜索结果' })).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('listbox', { name: '文档搜索结果' })).not.toBeInTheDocument()
  expect(input).toHaveFocus()
})

it('shows a no-result prompt for an unmatched query', async () => {
  const user = userEvent.setup()
  render(<DocsPage route={{ name: 'docs' }} navigate={vi.fn()}/>)
  await user.type(screen.getByRole('textbox', { name: '搜索文档' }), '完全不存在的中文检索词')
  expect(await screen.findByRole('status')).toHaveTextContent('没有匹配内容')
})
