/**
 * 共享应用壳的 hash 导航（任务 3.1、design D1、MPW-01、MPW-09）。
 *
 * 旧首页继续是无 hash 地址、演示模式继续是 `?mode=demo`；新页面只挂在四个 hash 上；
 * 结果链接只带批次身份，不能把演示查询串一起带过去。
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { hashFor, parseHash, resultLink, ROUTE_HASH, useRoute } from './navigation'

function Probe() {
  const { route, navigate } = useRoute()
  return (
    <div>
      <p data-testid="route">{route.name === 'result' ? `result:${route.batchId}` : route.name === 'unknown' ? `unknown:${route.hash}` : route.name}</p>
      <button onClick={() => navigate({ name: 'models' })}>去模型中心</button>
      <button onClick={() => navigate({ name: 'result', batchId: '2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d' })}>去结果页</button>
      <button onClick={() => navigate({ name: 'workbench' })}>回工作台</button>
    </div>
  )
}

describe('parseHash', () => {
  it('无 hash 与根 hash 都是旧工作台首页', () => {
    expect(parseHash('')).toEqual({ name: 'workbench' })
    expect(parseHash('#')).toEqual({ name: 'workbench' })
    expect(parseHash('#/')).toEqual({ name: 'workbench' })
  })

  it('识别三个新入口与结果路由', () => {
    expect(parseHash('#/models')).toEqual({ name: 'models' })
    expect(parseHash('#/predict')).toEqual({ name: 'predict' })
    expect(parseHash('#/predictions')).toEqual({ name: 'open' })
    expect(parseHash('#/predictions/2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d')).toEqual({
      name: 'result',
      batchId: '2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d',
    })
  })

  it('未知地址不被静默当成首页', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'unknown', hash: '#/nope' })
    expect(parseHash('#/predictions/abc/def')).toEqual({ name: 'unknown', hash: '#/predictions/abc/def' })
    expect(parseHash('#/models/1')).toEqual({ name: 'unknown', hash: '#/models/1' })
    // 末尾斜杠只是书写差异，仍指向同一个页面。
    expect(parseHash('#/predictions/')).toEqual({ name: 'open' })
  })

  it('hashFor 与 parseHash 互为反函数', () => {
    for (const hash of [ROUTE_HASH.models, ROUTE_HASH.predict, ROUTE_HASH.open]) {
      expect(hashFor(parseHash(hash))).toBe(hash)
    }
    expect(hashFor({ name: 'workbench' })).toBe('')
  })
})

describe('resultLink', () => {
  it('只带批次身份，不带演示查询串', () => {
    const link = resultLink('2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d', {
      origin: 'http://127.0.0.1:4173',
      pathname: '/',
    })
    expect(link).toBe('http://127.0.0.1:4173/#/predictions/2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d')
    expect(link).not.toContain('mode=demo')
    expect(link).not.toContain('?')
  })
})

describe('useRoute', () => {
  it('导航会改变地址、派发 hashchange 并同步到监听者', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/?mode=demo')
    render(<Probe />)
    expect(screen.getByTestId('route')).toHaveTextContent('workbench')

    await user.click(screen.getByRole('button', { name: '去模型中心' }))
    expect(screen.getByTestId('route')).toHaveTextContent('models')
    expect(window.location.hash).toBe('#/models')
    // 演示模式查询串在新页面之间保留，只有结果链接会去掉它。
    expect(window.location.search).toBe('?mode=demo')

    await user.click(screen.getByRole('button', { name: '去结果页' }))
    expect(screen.getByTestId('route')).toHaveTextContent('result:2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d')

    await user.click(screen.getByRole('button', { name: '回工作台' }))
    expect(screen.getByTestId('route')).toHaveTextContent('workbench')
    expect(window.location.hash).toBe('')
  })

  it('外部直接改 hash（模拟粘贴链接）也会同步', async () => {
    window.history.replaceState({}, '', '/')
    render(<Probe />)
    window.location.hash = '#/predict'
    window.dispatchEvent(new Event('hashchange'))
    expect(await screen.findByText('predict')).toBeVisible()
  })
})
