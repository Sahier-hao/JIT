import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { queryClient } from './lib/queryClient'

// antd 的弹层组件在 jsdom 下需要这两个浏览器 API，否则打开 Select 下拉会抛
// ReferenceError: ResizeObserver is not defined。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!globalThis.ResizeObserver) globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

// Radix Select 在 jsdom 下调用指针捕获 API；未实现时打开下拉会抛
// TypeError: target.hasPointerCapture is not a function。
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {}
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList
}

afterEach(() => { cleanup(); queryClient.clear() })
