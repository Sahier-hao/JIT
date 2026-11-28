import { ArrowLeft, ArrowRight, BookOpenText, ChevronDown, ListTree } from 'lucide-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { AppearanceControl } from '@/components/layout/AppearanceControl'
import { EntryFooter, EntryHeader, EntryPage } from '@/components/layout/EntryChrome'
import { EmptyState } from '@/components/shared/Feedback'
import { Markdown } from '@/components/shared/Markdown'
import { Button } from '@/components/ui/button'
import { hashFor, parseHash, type Route } from '@/app/navigation'
import {
  articleBySlug, articlesInGroup, DOC_ARTICLES, DOC_GROUPS, type DocArticle,
} from '@/features/docs/catalog'
import { DocsSearch } from '@/features/docs/components/DocsSearch'
import { docsSections, type DocsHeading, type DocsSearchResult } from '@/features/docs/docsContent'
import { cn } from '@/lib/utils'

type Navigate = (route: Route) => void

function docsRoute(article: DocArticle, section?: string): Route {
  return { name: 'docs', slug: article.slug, ...(section ? { section } : {}) }
}

function DocsLink({ route, navigate, className, children, current = false }: {
  route: Route
  navigate: Navigate
  className?: string
  children: ReactNode
  current?: boolean
}) {
  return <a
    href={hashFor(route)}
    aria-current={current ? 'page' : undefined}
    className={className}
    onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      navigate(route)
    }}
  >
    {children}
  </a>
}

function DocsHeader({ navigate, current }: { navigate: Navigate; current?: DocArticle }) {
  function openResult(result: DocsSearchResult) {
    navigate({ name: 'docs', slug: result.articleSlug, section: result.sectionId })
  }
  return <>
    <EntryHeader
      onHome={() => navigate({ name: 'landing' })}
      right={<>
        <Button variant="ghost" size="sm" asChild><a href="#/docs">文档首页</a></Button>
        <Button variant="ghost" size="sm" asChild><a href="#/">产品首页</a></Button>
        <AppearanceControl/>
      </>}
    />
    <div className="sticky top-0 z-40 border-b border-border-soft bg-card/95 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <BookOpenText aria-hidden="true" size={16} className="shrink-0 text-foreground-3"/>
          <a href="#/docs" className="shrink-0 font-medium text-foreground" onClick={event => { event.preventDefault(); navigate({ name: 'docs' }) }}>产品文档</a>
          {current ? <><span className="text-foreground-4" aria-hidden="true">/</span><span className="truncate text-foreground-3">{current.title}</span></> : null}
        </div>
        <div className="ml-auto w-full sm:w-auto"><DocsSearch onOpen={openResult}/></div>
      </div>
    </div>
  </>
}

function ArticleCard({ article, navigate, featured = false }: { article: DocArticle; navigate: Navigate; featured?: boolean }) {
  return <DocsLink
    route={docsRoute(article)}
    navigate={navigate}
    className={cn(
      'group flex min-w-0 items-start justify-between gap-4 rounded-lg border border-border-soft bg-card text-left transition-colors hover:border-border hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      featured ? 'p-5 sm:p-6' : 'p-4',
    )}
  >
    <span className="grid min-w-0 gap-1.5">
      <span className={cn('font-semibold text-foreground', featured ? 'text-xl' : 'text-sm')}>{article.title}</span>
      <span className={cn('leading-body text-foreground-3', featured ? 'text-sm' : 'text-xs')}>{article.summary}</span>
    </span>
    <ArrowRight aria-hidden="true" size={featured ? 20 : 16} className="mt-0.5 shrink-0 text-foreground-4 transition-transform group-hover:translate-x-0.5 group-hover:text-accent"/>
  </DocsLink>
}

function DocsHome({ navigate }: { navigate: Navigate }) {
  const featured = articleBySlug('first-pr-review')!
  return <main id="docs-main" tabIndex={-1} className="mx-auto grid w-full max-w-[1160px] flex-1 gap-10 px-4 py-9 outline-none sm:px-8 sm:py-14">
    <header className="grid max-w-[760px] gap-3">
      <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">产品文档</h1>
      <p className="text-sm leading-[1.85] text-foreground-2 sm:text-base">从第一次 PR 审查开始，或直接查当前界面里的分数、代码线索、标签和失败处理。</p>
    </header>

    <section className="grid gap-3" aria-labelledby="docs-quick-start">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="docs-quick-start" className="text-lg font-semibold text-foreground">快速开始</h2>
        <span className="text-xs text-foreground-3">从公开 PR 完成一次可导出的审查</span>
      </div>
      <ArticleCard article={featured} navigate={navigate} featured/>
    </section>

    <div className="grid gap-7 md:grid-cols-3 md:gap-5">
      {DOC_GROUPS.filter(group => group.id !== 'quick-start').map(group => {
        const articles = articlesInGroup(group.id)
        return <section key={group.id} className="grid content-start gap-3" aria-labelledby={`docs-group-${group.id}`}>
          <h2 id={`docs-group-${group.id}`} className="text-base font-semibold text-foreground">{group.label}</h2>
          <div className="grid gap-2">
            {articles.map(article => <ArticleCard key={article.slug} article={article} navigate={navigate}/>)}
          </div>
        </section>
      })}
    </div>
  </main>
}

function ChapterNavigation({ current, navigate, mobile = false }: { current: DocArticle; navigate: Navigate; mobile?: boolean }) {
  return <nav aria-label={mobile ? '文档章节（窄屏）' : '文档章节'} className="grid gap-5">
    {DOC_GROUPS.map(group => <section key={group.id} className="grid gap-1">
      <h2 className="px-2 font-mono text-[11px] font-medium uppercase tracking-[.12em] text-foreground-4">{group.label}</h2>
      {articlesInGroup(group.id).map(article => {
        const active = article.slug === current.slug
        return <DocsLink
          key={article.slug}
          route={docsRoute(article)}
          navigate={navigate}
          current={active}
          className={cn(
            'block rounded-sm border-l-2 px-2 py-1.5 text-sm leading-snug transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            active ? 'border-accent bg-accent-soft font-medium text-foreground' : 'border-transparent text-foreground-2 hover:bg-hover hover:text-foreground',
          )}
        >
          {article.title}
        </DocsLink>
      })}
    </section>)}
  </nav>
}

function TableOfContents({ headings, article, navigate }: { headings: DocsHeading[]; article: DocArticle; navigate: Navigate }) {
  if (!headings.length) return null
  return <nav aria-label="本页目录" className="grid gap-1">
    <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-foreground-2"><ListTree aria-hidden="true" size={14}/>本页目录</h2>
    {headings.map(heading => <DocsLink
      key={heading.id}
      route={docsRoute(article, heading.id)}
      navigate={navigate}
      className={cn(
        'block border-l border-transparent py-1 text-xs leading-snug text-foreground-3 hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        heading.level === 3 ? 'pl-4' : 'pl-2',
      )}
    >
      {heading.title}
    </DocsLink>)}
  </nav>
}

function DocsArticle({ article, section, navigate }: { article: DocArticle; section?: string; navigate: Navigate }) {
  const parsed = useMemo(() => docsSections(article), [article])
  const toc = useMemo(() => parsed.filter(heading => heading.level <= 3), [parsed])
  const valid = !section || toc.some(heading => heading.id === section)
  const ordered = [...DOC_ARTICLES].sort((left, right) => left.order - right.order)
  const at = ordered.findIndex(item => item.slug === article.slug)
  const previous = at > 0 ? ordered[at - 1] : null
  const next = at >= 0 && at < ordered.length - 1 ? ordered[at + 1] : null
  const group = DOC_GROUPS.find(item => item.id === article.group)

  useEffect(() => {
    if (section && valid) {
      const target = document.getElementById(section)
      if (target) {
        target.scrollIntoView({ block: 'start' })
        target.setAttribute('tabindex', '-1')
        target.focus({ preventScroll: true })
        return
      }
    }
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [article.slug, section, valid])

  function openHref(href: string) {
    const route = parseHash(href)
    if (route.name === 'unknown') return
    navigate(route)
  }

  return <main id="docs-main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 outline-none sm:px-6 sm:py-8">
    <details className="mb-4 rounded-lg border border-border-soft bg-card lg:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground">章节导航<ChevronDown aria-hidden="true" size={16}/></summary>
      <div className="max-h-[65vh] overflow-auto border-t border-border-soft p-3"><ChapterNavigation current={article} navigate={navigate} mobile/></div>
    </details>
    <div className="grid min-w-0 gap-8 lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_190px] xl:gap-10">
      <aside className="hidden min-w-0 lg:block">
        <div className="sticky top-[74px] max-h-[calc(100vh-90px)] overflow-y-auto pb-6 pr-2"><ChapterNavigation current={article} navigate={navigate}/></div>
      </aside>
      <article className="min-w-0 max-w-[760px]">
        <header className="mb-6 grid gap-2 border-b border-border-soft pb-5">
          <p className="text-xs font-medium text-accent">{group?.label}</p>
          <h1 className="font-sans text-2xl font-semibold leading-title tracking-tight text-foreground sm:text-3xl">{article.title}</h1>
          <p className="text-sm leading-body text-foreground-3">{article.summary}</p>
        </header>
        {!valid ? <p id="docs-section-missing" role="alert" tabIndex={-1} className="mb-5 rounded-md border border-amber/30 bg-amber-soft px-3 py-2 text-sm text-amber-deep focus:outline-none">
          没有找到“{section}”这个本节。请从本页目录重新选择。
        </p> : null}
        <Markdown mode="document" onNavigate={openHref}>{article.body}</Markdown>
        <nav aria-label="上一篇和下一篇" className="mt-10 grid gap-3 border-t border-border-soft pt-5 sm:grid-cols-2">
          {previous ? <DocsLink route={docsRoute(previous)} navigate={navigate} className="group grid gap-1 rounded-md border border-border-soft p-3 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span className="flex items-center gap-1 text-xs text-foreground-3"><ArrowLeft aria-hidden="true" size={13}/>上一篇</span>
            <span className="text-sm font-medium text-foreground">{previous.title}</span>
          </DocsLink> : <span/>}
          {next ? <DocsLink route={docsRoute(next)} navigate={navigate} className="group grid gap-1 rounded-md border border-border-soft p-3 text-right hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:col-start-2">
            <span className="flex items-center justify-end gap-1 text-xs text-foreground-3">下一篇<ArrowRight aria-hidden="true" size={13}/></span>
            <span className="text-sm font-medium text-foreground">{next.title}</span>
          </DocsLink> : null}
        </nav>
      </article>
      <aside className="hidden min-w-0 xl:block">
        <div className="sticky top-[74px] max-h-[calc(100vh-90px)] overflow-y-auto pb-6"><TableOfContents headings={toc} article={article} navigate={navigate}/></div>
      </aside>
    </div>
  </main>
}

export function DocsPage({ route, navigate }: {
  route: Extract<Route, { name: 'docs' }>
  navigate: Navigate
}) {
  const article = route.slug ? articleBySlug(route.slug) : undefined
  return <EntryPage>
    <a className="sr-only z-[100] rounded-sm border border-border bg-card px-3.5 py-2.5 text-sm text-foreground focus:not-sr-only focus:fixed focus:left-2.5 focus:top-2.5" href="#docs-main" onClick={event => { event.preventDefault(); document.getElementById('docs-main')?.focus() }}>跳到主要内容</a>
    <DocsHeader navigate={navigate} current={article}/>
    {route.slug && !article
      ? <main className="mx-auto w-full max-w-[960px] flex-1 px-4 py-16 sm:px-8"><EmptyState title="没有这篇文档" description="地址里的文章不在已发布清单中。"><Button type="button" onClick={() => navigate({ name: 'docs' })}>返回文档首页</Button></EmptyState></main>
      : article
        ? <DocsArticle article={article} section={route.section} navigate={navigate}/>
        : <DocsHome navigate={navigate}/>}
    <EntryFooter><span>文档与当前界面版本一同构建发布。</span><span>模型分数是未经校准的审查线索，不是缺陷概率。</span></EntryFooter>
  </EntryPage>
}
