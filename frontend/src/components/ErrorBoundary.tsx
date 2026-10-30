import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * 页面级错误边界：单页渲染失败时保留外壳与返回入口，不让整站白屏。
 * 数据请求错误仍由各页面的 FailureNotice 处理，这里只接住渲染异常。
 */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面渲染失败', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <section role="alert" className="mx-auto max-w-xl rounded-lg border border-[var(--risk-high)] bg-[var(--risk-soft)] p-5 text-[13px] text-[var(--risk-fg)]">
      <h2 className="m-0 text-base font-semibold">这个页面渲染失败</h2>
      <p className="mt-2 text-[var(--fg-2)]">其他数据与已保存的分析不受影响。可以重试，或返回项目列表继续。</p>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-card p-2 text-xs text-[var(--fg-3)]">{this.state.error.message}</pre>
      <div className="mt-3 flex gap-2">
        <button type="button" className="ui-btn ui-btn--primary ui-btn--md inline-flex h-[30px] items-center rounded-md border border-primary bg-primary px-3 text-[13px] font-medium text-primary-foreground" onClick={() => { this.setState({ error: null }); this.props.onReset?.() }}>重试</button>
        <a href="#/projects" className="ui-btn ui-btn--secondary ui-btn--md inline-flex h-[30px] items-center rounded-md border border-input bg-card px-3 text-[13px] font-medium text-foreground">返回项目列表</a>
      </div>
    </section>
  }
}
