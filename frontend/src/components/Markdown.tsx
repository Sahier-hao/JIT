import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './markdown.css'

const components: Components = {
  // 外部链接新开标签页，避免把固定版本页面导航走；正文不启用原始 HTML。
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
}

/** 只读 Markdown 正文：标题、列表、表格、行内代码与代码块。 */
export function Markdown({ children }: { children: string }) {
  return <div className="md-prose">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
  </div>
}
