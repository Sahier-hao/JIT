import { beforeEach, expect, it } from 'vitest'
import { emptyQuery, readSeedQuery } from './domain'

/**
 * 地址上的日期是工作台的"查询种子"（CRR-05，change `make-trend-actionable`）：
 * 只在挂载时读取一次，手动修改不写回地址，因此刷新会回到地址给定的范围。
 */

beforeEach(() => {
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

it('种子解析：合法、单侧、非法、颠倒与未知键', () => {
  expect(readSeedQuery('')).toEqual({ query: emptyQuery, ignored: false })
  expect(readSeedQuery('?start=2026-10-08&end=2026-10-09').query).toMatchObject({
    start: '2026-10-08', end: '2026-10-09', search: '', sort: 'risk',
  })
  expect(readSeedQuery('?start=2026-10-08').query).toMatchObject({ start: '2026-10-08', end: '' })
  expect(readSeedQuery('?end=2026-10-09').query).toMatchObject({ start: '', end: '2026-10-09' })
  expect(readSeedQuery('?start=2026-10-0x')).toEqual({ query: emptyQuery, ignored: true })
  expect(readSeedQuery('?start=2026-10-09&end=2026-10-02')).toEqual({ query: emptyQuery, ignored: true })
  expect(readSeedQuery('?sort=time&mode=demo')).toEqual({ query: emptyQuery, ignored: false })
})
