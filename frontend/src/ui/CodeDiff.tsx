import { useMemo } from 'react'
import { Diff, parseDiff, tokenize } from 'react-diff-view'
import 'react-diff-view/style/index.css'
import { refractor } from 'refractor'
import type { ChangeData, GutterOptions } from 'react-diff-view'
import type { PRFile } from '../prReviewClient'

type Side = 'base' | 'head'

const LANGUAGES: Record<string, string> = {
  py: 'python', ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', html: 'markup', xml: 'markup', md: 'markdown', yml: 'yaml', yaml: 'yaml',
  sh: 'bash', bash: 'bash', sql: 'sql', toml: 'ini', ini: 'ini', c: 'c', h: 'c', cpp: 'cpp', go: 'go', rs: 'rust',
}

function languageOf(path: string) {
  const name = path.split('/').pop() ?? ''
  if (name === 'Dockerfile') return 'docker'
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const language = LANGUAGES[extension] ?? 'markup'
  return refractor.registered(language) ? language : 'markup'
}

function diffText(file: PRFile) {
  const previous = file.previousPath ?? file.path
  const header = [
    `diff --git a/${previous} b/${file.path}`,
    file.status === 'added' ? 'new file mode 100644' : '',
    file.status === 'removed' ? 'deleted file mode 100644' : '',
    `--- ${file.status === 'added' ? '/dev/null' : `a/${previous}`}`,
    `+++ ${file.status === 'removed' ? '/dev/null' : `b/${file.path}`}`,
  ].filter(Boolean)
  const patch = file.patch ?? ''
  return `${header.join('\n')}\n${patch}${patch.endsWith('\n') ? '' : '\n'}`
}

const diffTypeOf = (file: PRFile) => file.status === 'added' ? 'add'
  : file.status === 'removed' ? 'delete'
  : file.status === 'renamed' ? 'rename'
  : file.status === 'copied' ? 'copy'
  : 'modify'

/** 基准侧行号：删除行用它自己那行的号，新增行在基准侧不存在。 */
function baseLine(change: ChangeData) {
  return change.type === 'insert' ? null : change.type === 'delete' ? change.lineNumber : change.oldLineNumber
}

/** 目标侧行号：新增行用它自己那行的号，删除行在目标侧不存在。 */
function headLine(change: ChangeData) {
  return change.type === 'delete' ? null : change.type === 'insert' ? change.lineNumber : change.newLineNumber
}

/** 真实 GitHub patch 交给 react-diff-view：行号、语法高亮、统一/并排切换都由它负责。 */
export function CodeDiff({ file, view, onAnchor, location }: {
  file: PRFile
  view: 'unified' | 'split'
  onAnchor: (side: Side, line: number) => void
  location?: { side: Side; line: number }
}) {
  const parsed = useMemo(() => {
    try {
      const [entry] = parseDiff(diffText(file), { nearbySequences: 'zip' })
      return entry ? { hunks: entry.hunks, type: diffTypeOf(file) as 'add' | 'delete' | 'modify' | 'rename' | 'copy' } : null
    } catch {
      return null
    }
  }, [file])
  const tokens = useMemo(() => {
    if (!parsed) return null
    try {
      return tokenize(parsed.hunks, { highlight: true, refractor, language: languageOf(file.path) })
    } catch {
      return null
    }
  }, [parsed, file.path])
  if (!parsed || !parsed.hunks.length) {
    return <p className="wb-diff-empty">这个文件没有可解析的改动行（可能是二进制、重命名或超出接口上限）。请到 GitHub 核对原文件。</p>
  }
  const focused = (change: ChangeData) => {
    if (!location) return false
    return location.side === 'head' ? headLine(change) === location.line : baseLine(change) === location.line
  }
  const renderGutter = ({ change, side }: GutterOptions) => {
    const number = side === 'old' ? baseLine(change) : headLine(change)
    if (number == null) return null
    const target: 'base' | 'head' = side === 'old' ? 'base' : 'head'
    return <button
      type="button"
      className="wb-gutter-number"
      data-focused={focused(change) ? 'true' : undefined}
      aria-label={`关联 ${file.path}:${target}:${number}`}
      onClick={() => onAnchor(target, number)}
    >{number}</button>
  }
  /* react-diff-view 不渲染 @@ 块头，也没有折叠区间；每块单独成表并在上面标出位置。 */
  return <div className="wb-diff-scroll">
    {parsed.hunks.map((hunk, index) => <div className="wb-hunk" key={`${hunk.oldStart}-${hunk.newStart}-${index}`}>
      <div className="wb-hunk-head">
        <code>{hunk.content.trim() || `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</code>
        <span>{hunk.oldLines} 行基准 · {hunk.newLines} 行目标</span>
      </div>
      <Diff
        viewType={view}
        diffType={parsed.type}
        hunks={[hunk]}
        tokens={tokens}
        gutterType="default"
        renderGutter={renderGutter}
        generateAnchorID={change => {
          const head = headLine(change)
          if (head != null) return `line-head-${head}`
          const base = baseLine(change)
          return base == null ? undefined : `line-base-${base}`
        }}
        generateLineClassName={({ changes }) => changes.some(change => focused(change)) ? 'is-focused' : undefined}
        gutterEvents={{
          onClick: ({ change, side }) => {
            if (!change || !side) return
            const line = side === 'old' ? baseLine(change) : headLine(change)
            if (line != null) onAnchor(side === 'old' ? 'base' : 'head', line)
          },
        }}
      />
    </div>)}
  </div>
}
