import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MouseEvent, ReactNode } from 'react'

const headingAnchor = /\s*\{#([A-Za-z][A-Za-z0-9_-]*)\}\s*$/

function textOf(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(textOf).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    return textOf((children as { props?: { children?: ReactNode } }).props?.children)
  }
  return ''
}

function DocumentHeading({ level, children }: { level: 2 | 3 | 4; children: ReactNode }) {
  const text = textOf(children)
  const id = text.match(headingAnchor)?.[1]
  const visible = id ? text.replace(headingAnchor, '') : text
  const Tag = `h${level}` as const
  return <Tag id={id} data-doc-heading={id ? 'anchored' : undefined}>{visible}</Tag>
}

/**
 * 只读 Markdown 正文：标题、列表、表格、行内代码与代码块。
 * 文档模式额外支持稳定小节标识和站内应用链接；默认模式保持既有新标签页行为。
 */
export function Markdown({ children, mode = 'default', onNavigate, className }: {
  children: string
  mode?: 'default' | 'document'
  onNavigate?: (href: string) => void
  className?: string
}) {
  const components: Components = {
    a: ({ href, children: linkChildren }) => {
      const internal = mode === 'document' && Boolean(href?.startsWith('#/'))
      function follow(event: MouseEvent<HTMLAnchorElement>) {
        if (!internal || !onNavigate) return
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        onNavigate(href!)
      }
      return <a href={href} onClick={follow} target={internal ? undefined : '_blank'} rel={internal ? undefined : 'noopener noreferrer'}>{linkChildren}</a>
    },
    img: ({ src, alt }) => <img src={src} alt={alt ?? ''} loading="lazy"/>,
    table: ({ children: tableChildren }) => <div className="w-full max-w-full overflow-x-auto"><table>{tableChildren}</table></div>,
    ...(mode === 'document' ? {
      h2: ({ children: headingChildren }) => <DocumentHeading level={2}>{headingChildren}</DocumentHeading>,
      h3: ({ children: headingChildren }) => <DocumentHeading level={3}>{headingChildren}</DocumentHeading>,
      h4: ({ children: headingChildren }) => <DocumentHeading level={4}>{headingChildren}</DocumentHeading>,
    } : {}),
  }
  return <div className={['md-prose', mode === 'document' ? 'docs-prose' : '', className].filter(Boolean).join(' ')}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
  </div>
}
