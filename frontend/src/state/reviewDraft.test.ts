import { expect, it } from 'vitest'
import { emptyQuery } from '../domain'
import { initialDraft, patchQuery, resetQuery } from './reviewDraft'

it('初始草稿同时是已生效查询，并记录详情返回位置', () => {
  const draft = initialDraft(emptyQuery, 'plan')
  expect(draft).toMatchObject({ offset: 0, detailReturn: 'plan', error: '' })
  expect(draft.applied).toBe(emptyQuery)
})

it('编辑筛选回到第一页，非法日期保留上一次有效查询', () => {
  const start = { ...initialDraft(emptyQuery, 'commits'), offset: 40 }
  const next = patchQuery(start, { start: '2026-13-01' })
  expect(next.draft.start).toBe('2026-13-01')
  expect(next.offset).toBe(0)
  expect(next.applied).toBe(emptyQuery)
  expect(next.error).toContain('请修正日期范围')
})

it('合法日期立即生效并清空错误', () => {
  const invalid = patchQuery(initialDraft(emptyQuery, 'commits'), { start: '2026-13-01' })
  const next = patchQuery(invalid, { start: '2026-10-01' })
  expect(next.applied.start).toBe('2026-10-01')
  expect(next.error).toBe('')
})

it('清除筛选恢复空查询并保留返回位置', () => {
  const dirty = { ...patchQuery(initialDraft(emptyQuery, 'plan'), { search: 'fix', sort: 'time' }), offset: 20 }
  const next = resetQuery(dirty)
  expect(next.applied).toBe(emptyQuery)
  expect(next.draft).toBe(emptyQuery)
  expect(next.offset).toBe(0)
  expect(next.detailReturn).toBe('plan')
})
