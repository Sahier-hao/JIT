/**
 * 入口页共用外壳：品牌头、页面框架与页脚。
 *
 * 落地页、登录页与研究预览共用同一套入口外观，避免各页复制品牌区与边框。
 */
import type { ReactNode } from 'react'
import { Icon } from '../Icon'

export function EntryPage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col bg-background text-foreground">{children}</div>
}

export function EntryHeader({ onHome, right }: { onHome: () => void; right?: ReactNode }) {
  return <header className="flex h-[66px] shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-5 sm:px-10">
    <button type="button" className="inline-flex items-center gap-2.5 border-0 bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={onHome}>
      <span className="grid size-8 place-items-center rounded-[10px] bg-primary text-primary-foreground"><Icon name="logo" size={16}/></span>
      <span className="font-display text-xl font-bold tracking-tight text-foreground">JIT<span className="ml-1.5 font-mono text-[10px] font-medium tracking-[.16em] text-foreground-4">REVIEW</span></span>
    </button>
    <div className="flex items-center gap-3">{right}</div>
  </header>
}

export function EntryFooter({ children }: { children: ReactNode }) {
  return <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-4 text-xs text-foreground-3 sm:px-10">{children}</footer>
}
