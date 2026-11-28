import { Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { searchDocs, type DocsSearchResult } from '@/features/docs/docsContent'
import { cn } from '@/lib/utils'

export function DocsSearch({ onOpen, autoFocus = false }: {
  onOpen: (result: DocsSearchResult) => void
  autoFocus?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const results = useMemo(() => searchDocs(query), [query])

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  function choose(result: DocsSearchResult) {
    onOpen(result)
    setOpen(false)
    setQuery('')
  }

  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      if (results.length) setActive(value => (value + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (results.length) setActive(value => (value - 1 + results.length) % results.length)
    } else if (event.key === 'Enter' && open && results[active]) {
      event.preventDefault()
      choose(results[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      input.current?.focus()
    }
  }

  const visible = open && query.trim().length > 0
  return <div ref={wrapper} className="relative w-full sm:w-[min(28rem,50vw)]">
    <label className="relative block">
      <span className="sr-only">搜索文档</span>
      <Search aria-hidden="true" size={15} strokeWidth={1.6} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-4"/>
      <Input
        ref={input}
        autoFocus={autoFocus}
        value={query}
        onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true) }}
        onFocus={() => { if (query.trim()) setOpen(true) }}
        onKeyDown={keys}
        placeholder="搜索风险分、私有仓库、模型兼容…"
        aria-label="搜索文档"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible && results[active] ? `${listId}-${active}` : undefined}
        className="h-9 pl-9 pr-9"
      />
      {query ? <Button type="button" variant="ghost" size="icon-xs" aria-label="清除搜索" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => { setQuery(''); setActive(0); setOpen(false); input.current?.focus() }}>
        <X aria-hidden="true"/>
      </Button> : null}
    </label>
    {visible ? <div id={listId} role="listbox" aria-label="文档搜索结果" className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[min(28rem,70vh)] overflow-auto rounded-lg border border-border bg-card p-1 shadow-[var(--sh-2)]">
      {results.length ? <>
        {results.map((result, index) => <Button
          key={result.id}
          id={`${listId}-${index}`}
          role="option"
          aria-selected={index === active}
          type="button"
          variant="ghost"
          onMouseEnter={() => setActive(index)}
          onClick={() => choose(result)}
          className={cn(
            'h-auto w-full flex-col items-stretch gap-1 whitespace-normal rounded-md px-3 py-2.5 text-left',
            index === active ? 'bg-accent-soft' : 'bg-transparent',
          )}
        >
          <span className="text-xs font-medium text-accent">{result.articleTitle} <span className="font-normal text-foreground-3">/ {result.sectionTitle}</span></span>
          <span className="line-clamp-2 text-xs leading-body text-foreground-2">{result.snippet}</span>
        </Button>)}
        <p className="px-3 py-1.5 text-[11px] text-foreground-4">↑ ↓ 选择 · Enter 打开 · Esc 关闭</p>
      </> : <p className="px-3 py-6 text-sm text-foreground-3" role="status">没有匹配内容。换用按钮名称、页面名称或术语再试。</p>}
    </div> : null}
  </div>
}
