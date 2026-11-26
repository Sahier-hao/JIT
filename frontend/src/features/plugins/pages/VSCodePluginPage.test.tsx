import { fireEvent, render, screen } from '@/lib/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { VSCodePluginPage } from '@/features/plugins/pages/VSCodePluginPage'

afterEach(() => vi.restoreAllMocks())

function clipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

it('explains the plugin journey, trust boundary and identity states', () => {
  render(<VSCodePluginPage/>)
  expect(screen.getByRole('heading', { name: 'IDE 插件', level: 1 })).toBeVisible()
  expect(screen.getByText('把提交级风险带进 VS Code，再从证据回到代码行')).toBeVisible()
  expect(screen.getByRole('heading', { name: '从报告到代码行' })).toBeVisible()
  expect(screen.getByText('本页不提供稳定 VSIX 下载。请从本地构建产物或已核对的 CI artifact 安装，并确认包版本与当前交付一致。')).toBeVisible()
  expect(screen.getByRole('table', { name: '' })).toBeVisible()
  expect(screen.getByText('提交过期')).toBeVisible()
  expect(screen.getByText('工作树有改动')).toBeVisible()
  expect(screen.queryByRole('link', { name: /下载/ })).not.toBeInTheDocument()
})

it('copies real commands and reports clipboard failure', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  clipboard(writeText)
  const view = render(<VSCodePluginPage/>)
  fireEvent.click(screen.getAllByRole('button', { name: '复制命令' })[0])
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('pr-check-analyze'))
  expect(await screen.findByText('命令已复制')).toBeVisible()

  view.unmount()
  writeText.mockRejectedValueOnce(new Error('blocked'))
  render(<VSCodePluginPage/>)
  fireEvent.click(screen.getAllByRole('button', { name: '复制命令' })[1])
  expect(await screen.findByText('自动复制不可用，请手动选择命令')).toBeVisible()
})
