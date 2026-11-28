import { render, screen } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { Markdown } from '@/components/shared/Markdown'

it('renders document headings, internal navigation, external targets and scrollable tables', async () => {
  const navigate = vi.fn()
  const user = userEvent.setup()
  render(<Markdown mode="document" onNavigate={navigate}>{[
    '## 提交级风险分 {#commit-score}',
    '',
    '阅读[常见问题](#/docs/faq?section=private-repository)或[GitHub](https://github.com)。',
    '',
    '| 项目 | 说明 |',
    '| --- | --- |',
    '| 分数 | 模型估计 |',
  ].join('\n')}</Markdown>)
  const heading = screen.getByRole('heading', { name: '提交级风险分' })
  expect(heading).toHaveAttribute('id', 'commit-score')
  const internal = screen.getByRole('link', { name: '常见问题' })
  expect(internal).not.toHaveAttribute('target')
  await user.click(internal)
  expect(navigate).toHaveBeenCalledWith('#/docs/faq?section=private-repository')
  expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('target', '_blank')
  expect(screen.getByRole('table').parentElement).toHaveClass('overflow-x-auto')
})

it('preserves the existing new-tab link behavior outside document mode', () => {
  render(<Markdown>{'[诊断](#/docs/reading-results)'}</Markdown>)
  expect(screen.getByRole('link', { name: '诊断' })).toHaveAttribute('target', '_blank')
})
