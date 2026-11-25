import { Button } from '@/components/ui/button'
import { BrandLogo } from '@/components/shared/BrandLogo'
/**
 * 入口页共用外壳：品牌头、页面框架与页脚。
 *
 * 落地页、登录页与研究预览共用同一套入口外观，避免各页复制品牌区与边框。
 */
import type { ReactNode } from 'react'


export function EntryPage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col bg-background text-foreground">{children}</div>
}

export function EntryHeader({ onHome, right }: { onHome: () => void; right?: ReactNode }) {
  return <header className="flex min-h-15 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-soft bg-card px-4 py-2 sm:px-10">
    <Button variant="ghost" type="button" className="inline-flex items-center gap-2.5 border-0 bg-transparent px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={onHome}>
      <span className="grid size-8 place-items-center rounded-[10px] bg-primary text-primary-foreground"><BrandLogo aria-hidden="true" focusable="false" strokeWidth={1.5} size={16}/></span>
      <span className="font-display text-xl font-bold tracking-tight text-foreground">JIT<span className="ml-1.5 font-mono text-[10px] font-medium tracking-[.16em] text-foreground-4">REVIEW</span></span>
    </Button>
    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{right}</div>
  </header>
}

export function EntryFooter({ children }: { children: ReactNode }) {
  return <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-4 text-xs text-foreground-3 sm:px-10">{children}</footer>
}
