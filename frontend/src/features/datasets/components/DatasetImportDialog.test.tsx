import { fireEvent, render, screen, waitFor } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { DatasetImportDialog } from './DatasetImportDialog'

afterEach(() => vi.restoreAllMocks())

function renderImport() {
  render(<DatasetImportDialog open onOpenChange={vi.fn()} onStarted={vi.fn()} onLoginRequired={vi.fn()}/>)
  return (contents: string, name = 'research.csv') => fireEvent.change(screen.getByLabelText('数据文件'), {
    target: { files: [new File([contents], name, { type: 'text/csv' })] },
  })
}

it('selects the Kamei 2013 format from the CSV header', async () => {
  const choose = renderImport()
  choose('\uFEFF"transactionid",commitdate,ns,nm,nf,entropy,la,ld,lt,fix,ndev,pd,npt,exp,rexp,sexp,bug\r\n')
  expect(await screen.findByText('已识别为 Kamei 2013 原始 CSV')).toBeVisible()
  expect(screen.getByRole('button', { name: /^导入$/ })).toBeEnabled()
})

it('asks for the source version when three formats share the same header', async () => {
  const choose = renderImport()
  choose('commit_id,author_date,bugcount,ns,nd,nf,entropy,la,ld,lt,fix,ndev,age,nuc,exp,rexp,sexp\n')
  expect(await screen.findByText('表头匹配多个规范，请确认数据来源。')).toBeVisible()
  expect(screen.getByRole('button', { name: /^导入$/ })).toBeDisabled()
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'CSV 字段规范' }))
  await user.click(await screen.findByRole('option', { name: '标准化 Kamei 14 维' }))
  expect(screen.getByRole('button', { name: /^导入$/ })).toBeEnabled()
})

it('keeps an unsupported CSV selected and lists the missing columns without uploading', async () => {
  const choose = renderImport()
  const fetch = vi.spyOn(globalThis, 'fetch')
  choose('transactionid,commitdate,ns,nm,nf,entropy,la,ld,lt,fix,ndev,pd,npt,exp,rexp,sexp\n')
  expect(await screen.findByText('表头未匹配到可导入的规范。')).toBeVisible()
  expect(screen.getByText('bug', { exact: true })).toBeVisible()
  expect((screen.getByLabelText('数据文件') as HTMLInputElement).files?.[0].name).toBe('research.csv')
  expect(screen.getByRole('link', { name: '下载表头模板' })).toHaveAttribute('download', 'kamei14-2013-v1-template.csv')
  expect(screen.getByRole('button', { name: /^导入$/ })).toBeDisabled()
  expect(fetch).not.toHaveBeenCalled()

  choose('commit_id,author_date,bugcount,ns,nd,nf,ent,la,ld\n', 'corrected.csv')
  expect(await screen.findByText('已识别为 OpenStack 6 维')).toBeVisible()
  expect(screen.queryByText('表头未匹配到可导入的规范。')).not.toBeInTheDocument()
})

it('explains the published labels and hands off the accepted ZIP to a background task', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
    taskId: 'job-1', filename: 'jit.zip', status: 'queued', stage: 'queued', processed: 0, total: null,
    versions: [], createdCount: 0, createdAt: '2026-11-20T12:00:00Z',
  }, { status: 202 }))
  const onStarted = vi.fn()
  const onOpenChange = vi.fn()
  render(<DatasetImportDialog open onOpenChange={onOpenChange} onStarted={onStarted} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  const file = new File(['package'], 'jit.zip', { type: 'application/zip' })
  fireEvent.change(screen.getByLabelText('数据文件'), { target: { files: [file] } })

  expect(screen.queryByLabelText('CSV 字段规范')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '字段与标签说明' }))
  expect(screen.getByText('引入缺陷')).toBeVisible()
  expect(screen.getByText('过去改动次数（按文件数归一化）')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.queryByText('引入缺陷')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^导入$/ }))

  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/user/dataset-imports?filename=jit.zip&format=zip',
    expect.objectContaining({ method: 'POST', body: file }),
  )
  await waitFor(() => expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'job-1', status: 'queued' })))
  expect(onOpenChange).toHaveBeenCalledWith(false)
})
