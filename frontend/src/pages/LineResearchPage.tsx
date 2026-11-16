import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../apiContract'
import type { Route } from '../navigation'
import {
  lineResearchMetadata, scoreLineResearch,
  type LineResearchMetadata, type LineScoreResult,
} from '../lineResearch'
import { Icon } from '../Icon'
import { Button, Select } from '../ui/controls'
import '../styles/entry.css'
import '../styles/research.css'

const LANGUAGE_LABELS: Record<string, string> = { typescript: 'TypeScript', javascript: 'JavaScript' }

function number(value: number | null, digits = 3): string {
  return value === null ? '—' : value.toFixed(digits)
}

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

function count(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('zh-CN')
}

/** 独立的行级模型研究预览：只读口径 + 请求内按行打分，不进入项目分析。 */
export function LineResearchPage({ navigate }: { navigate: (route: Route) => void }) {
  const [meta, setMeta] = useState<LineResearchMetadata | null>(null)
  const [metaError, setMetaError] = useState('')
  const [reload, setReload] = useState(0)
  const [language, setLanguage] = useState('')
  const [code, setCode] = useState('')
  const [result, setResult] = useState<LineScoreResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const resultRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    lineResearchMetadata(controller.signal).then(value => {
      if (controller.signal.aborted) return
      setMeta(value)
      setLanguage(current => current && value.languages.includes(current)
        ? current
        : value.languages.includes('typescript') ? 'typescript' : value.languages[0] ?? '')
    }).catch(failure => {
      if (!controller.signal.aborted) setMetaError(failure instanceof Error ? failure.message : '研究模型读取失败')
    })
    return () => controller.abort()
  }, [reload])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!code.trim()) return
    setBusy(true); setError('')
    try {
      const value = await scoreLineResearch(code, language)
      setResult(value)
      window.requestAnimationFrame(() => resultRef.current?.scrollIntoView?.({ block: 'nearest' }))
    } catch (failure) {
      setError(failure instanceof ApiError || failure instanceof Error ? failure.message : '分析失败')
    } finally { setBusy(false) }
  }

  const lines = code ? code.split('\n').length : 0
  return <div className="entry-page research-page">
    <header className="entry-header">
      <button className="entry-brand" onClick={() => navigate({ name: 'landing' })}>
        <span className="brand-glyph"><Icon name="logo" size={22}/></span>
        <span>JIT<span className="brand-caption">REVIEW</span></span>
      </button>
      <div className="research-head-actions">
        <span className="research-badge">研究预览</span>
        <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'landing' })}>返回首页</Button>
      </div>
    </header>
    <main className="research-main">
      <section className="research-intro">
        <p className="entry-eyebrow">行级模型 · 实验性</p>
        <h1>按行查看研究模型的排序分数</h1>
        <p className="research-warning" role="note">
          <Icon name="warning" size={16}/>
          分数来自弱标签抽样，未做概率校准，不是缺陷概率；不参与项目分析、PR 审查或默认模型。
        </p>
      </section>
      {metaError ? <div className="research-unavailable" role="alert">
        <p>{metaError}</p>
        <Button onClick={() => { setMetaError(''); setReload(value => value + 1) }}>重试</Button>
      </div> : <div className="research-layout">
        <section className="research-sandbox" aria-label="行级打分">
          <div className="research-sandbox-head">
            <h2>提交代码</h2>
            <Select ariaLabel="代码语言" value={language} onChange={setLanguage}
              options={(meta?.languages ?? []).map(value => ({ value, label: LANGUAGE_LABELS[value] ?? value }))}
              disabled={!meta}/>
          </div>
          <form onSubmit={submit}>
            <label className="research-code-label" htmlFor="research-code">代码</label>
            <textarea id="research-code" value={code} onChange={event => setCode(event.target.value)}
              placeholder="粘贴 TypeScript 或 JavaScript 代码" rows={14} spellCheck={false}/>
            <div className="research-actions">
              <Button variant="primary" type="submit" loading={busy} disabled={!meta || !code.trim()}>分析这些行</Button>
              <span>{lines} 行{meta ? ` · 上限 ${meta.limits.maxLines.toLocaleString('zh-CN')} 行` : ''}</span>
            </div>
            {error ? <p className="field-error" role="alert">{error}</p> : null}
          </form>
        </section>
        <aside className="research-card" aria-label="模型口径">
          {meta ? <>
            <div className="research-card-head"><h2>模型口径</h2><span>{meta.languages.map(value => LANGUAGE_LABELS[value] ?? value).join(' / ')}</span></div>
            <dl className="research-facts">
              <div><dt>训练</dt><dd>{meta.training.repos.join('、')} · {count(meta.training.commits)} 提交 · {count(meta.training.samples)} 行</dd></div>
              <div><dt>留出</dt><dd>{meta.holdout.repo ?? '—'} · {count(meta.holdout.commits)} 提交 · {count(meta.holdout.samples)} 行</dd></div>
              <div><dt>ROC-AUC</dt><dd>{number(meta.metrics.rocAuc)}</dd></div>
              <div><dt>PR-AUC</dt><dd>{number(meta.metrics.prAuc)} · 随机基线 {number(meta.metrics.randomPrAuc)}</dd></div>
              <div><dt>Brier</dt><dd>{number(meta.metrics.brier)}</dd></div>
              <div><dt>Top-5 命中</dt><dd>{percent(meta.localization.top5)} · 抽样代理</dd></div>
              <div><dt>20% 行预算召回</dt><dd>{percent(meta.localization.recallAt20PercentLines)} · 抽样代理</dd></div>
            </dl>
            <ul className="research-limits">{meta.limitations.map(item => <li key={item}>{item}</li>)}</ul>
          </> : <p className="quiet-empty">正在读取研究模型…</p>}
        </aside>
      </div>}
      {result ? <section className="research-results" ref={resultRef} aria-live="polite">
        <div className="research-results-head">
          <h2>排序结果</h2>
          <span>{result.count} 行{result.skippedBlank ? ` · 跳过 ${result.skippedBlank} 个空行` : ''}</span>
        </div>
        <div className="research-table-scroll">
          <table className="research-table">
            <caption>按分数降序；分数不是缺陷概率。</caption>
            <thead><tr><th scope="col">排名</th><th scope="col">行</th><th scope="col">代码</th><th scope="col">分数</th></tr></thead>
            <tbody>{result.lines.map(row => <tr key={row.line}>
              <td>{row.rank}</td>
              <td>{row.line}</td>
              <td><code title={row.text}>{row.text || ' '}</code></td>
              <td><span className="research-score"><span className="research-score-track"><span style={{ width: `${row.score * 100}%` }}/></span><b>{row.score.toFixed(3)}</b></span></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section> : null}
    </main>
  </div>
}
