import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Alert, Space } from '../../ui/feedback'
import { Button, Checkbox, Select, TextArea } from '../../ui/controls'
import { downloadText, evidenceURL, mergeBackup, parseBackup, type Conclusion, type Evidence, type PRWork, type ReviewQuestion } from '../../prReview'
import { verifyBackupSources, type PRSnapshot } from '../../prReviewClient'

const message = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试'
function backup(work: PRWork) { downloadText(`review-${work.owner}-${work.name}-${work.number}.json`, JSON.stringify({ format: 'jit-pr-review-v1', work }, null, 2), 'application/json') }

export function QuestionEditor({ value: q, source, onChange, onJump, work }: { value: ReviewQuestion; source: PRSnapshot; onChange: (value: ReviewQuestion) => void; onJump: (e: Evidence) => void; work: PRWork }) {
  const [error, setError] = useState('')
  return <div className="pr-question-editor"><p className="pr-source-label">来源：{q.source === 'author' ? '作者原始说明中的核对目标' : q.source === 'change' ? '已加载文件事实，规则生成的核对问题' : '人工提出'} · 原版本 {q.originSnapshotId.slice(0, 12)}</p>
    {q.requiresRecheck ? <p className="warning">相关代码已变化，旧证据可能过期。原问题和判断保留，请人工核对。</p> : null}
    <label>问题、疑问或建议<textarea aria-label="审查问题内容" value={q.body} onChange={e => onChange({ ...q, body: e.target.value })}/></label>
    <label>记录类型<select aria-label="审查记录类型" value={q.kind} onChange={e => onChange({ ...q, kind: e.target.value as ReviewQuestion['kind'] })}><option value="question">待确认的问题</option><option value="finding">人工确认的问题</option><option value="suggestion">一般建议</option></select></label>
    <details><summary>关联实现与测试文件（{q.relatedFiles.length}）</summary>{source.files.map(f => <label key={f.path}><input type="checkbox" checked={q.relatedFiles.includes(f.path)} onChange={e => onChange({ ...q, relatedFiles: e.target.checked ? [...q.relatedFiles, f.path] : q.relatedFiles.filter(p => p !== f.path) })}/>{f.path}</label>)}</details>
    <label>人工判断<textarea aria-label="人工判断" value={q.judgment} onChange={e => onChange({ ...q, judgment: e.target.value })}/></label>
    <label>处理理由<textarea aria-label="问题处理理由" value={q.reason} onChange={e => onChange({ ...q, reason: e.target.value })}/></label>
    <label>处理状态<select aria-label="问题处理状态" value={q.status} onChange={e => { const status = e.target.value as ReviewQuestion['status']; if (status !== 'open' && !q.reason.trim()) { setError('先填写处理理由，原内容会保留'); return } setError(''); onChange({ ...q, status }) }}><option value="open">待核对 / 重新打开</option><option value="resolved">人工标记已解决</option><option value="deferred">暂不处理</option><option value="withdrawn">撤回记录（保留原文）</option></select></label>
    {error ? <p className="field-error">{error}</p> : null}
    {q.requiresRecheck ? <Button size="sm" disabled={!q.reason.trim()} onClick={() => onChange({ ...q, requiresRecheck: false })}>已人工复核当前版本</Button> : null}
    <h3>位置与证据（{q.evidence.length}）</h3>{q.evidence.map((e, index) => <article key={index} className="pr-evidence"><Button variant="link" size="sm" onClick={() => onJump(e)}>{e.path}:{e.line ?? '整体'} · {e.side === 'head' ? '目标' : '基准'} · 原版本</Button><a href={evidenceURL(work.rounds[e.snapshotId]?.source ?? source, e)} target="_blank" rel="noreferrer">核对原代码</a><input aria-label={`证据说明 ${index + 1}`} value={e.note} placeholder="已核对什么，还缺什么证据" onChange={event => onChange({ ...q, evidence: q.evidence.map((a, i) => i === index ? { ...a, note: event.target.value } : a) })}/><Button variant="link" size="sm" onClick={() => onChange({ ...q, evidence: q.evidence.filter((_, i) => i !== index) })}>移除此证据</Button></article>)}
    <label>对线索的反馈<select aria-label="线索反馈" value={q.feedback} onChange={e => onChange({ ...q, feedback: e.target.value as ReviewQuestion['feedback'] })}><option value="">尚未反馈</option><option value="helpful">有帮助</option><option value="irrelevant">无关</option><option value="more-evidence">需要更多证据</option></select></label><input aria-label="线索反馈理由" value={q.feedbackReason} onChange={e => onChange({ ...q, feedbackReason: e.target.value })} placeholder="反馈理由（仅保存在当前浏览器）"/>
  </div>
}

export function DeliveryForm({ onPrepare, busy, draft, onDraft }: { onPrepare: (kind: Conclusion, note: string) => Promise<void>; busy: boolean; draft?: { kind: Conclusion; note: string }; onDraft: (value: { kind: Conclusion; note: string }) => void }) {
  const kind = draft?.kind ?? 'changes', note = draft?.note ?? ''
  return <form className="pr-delivery-form" onSubmit={event => { event.preventDefault(); void onPrepare(kind, note) }}>
    <div className="pr-field">
      <span className="pr-field-label">本轮结论</span>
      <Select
        aria-label="本轮结论"
        value={kind}
        onChange={value => onDraft({ kind: value as Conclusion, note })}
        style={{ width: '100%' }}
        options={[{ value: 'changes', label: '建议修改' }, { value: 'complete', label: '本轮审查完成' }, { value: 'defer', label: '暂缓并说明原因' }]}
      />
    </div>
    <div className="pr-field">
      <span className="pr-field-label">说明与未完成事项</span>
      <TextArea aria-label="本轮结论说明" value={note} onChange={event => onDraft({ kind, note: event.target.value })}/>
    </div>
    <Button variant="primary" type="submit" disabled={busy}>检查版本并预览意见</Button>
  </form>
}
export function WorkBackup({ work, onMerge }: { work: PRWork; onMerge: (work: PRWork) => unknown }) {
  const [incoming, setIncoming] = useState<PRWork | null>(null), [choices, setChoices] = useState<Record<string, boolean>>({}), [error, setError] = useState('')
  const file = useRef<HTMLInputElement | null>(null)
  const preview = incoming ? mergeBackup(work, incoming, choices) : null
  async function pick(picked: File) {
    try {
      if (picked.size > 1024 * 1024) throw new Error('备份超过 1 MiB')
      const next = parseBackup(await picked.text(), work.key)
      await verifyBackupSources(next)
      mergeBackup(work, next, {})
      setIncoming(next); setChoices({}); setError('')
    } catch (failure) { setError(message(failure)) }
  }
  return <section className="pr-backups">
    <div className="pr-backups-head">
      <div>
        <h3>个人草稿备份</h3>
        <p>包含此 PR 各版本的个人笔记、问题、反馈和结论。仅在你选择导出时生成本地文件，不上传。</p>
      </div>
      <Space>
        <Button icon={<Download/>} aria-label="导出完整草稿" onClick={() => backup(work)}>导出完整草稿</Button>
        <Button icon={<Upload/>} aria-label="选择备份以预览合并" onClick={() => file.current?.click()}>选择备份以预览合并</Button>
      </Space>
      <input ref={file} type="file" hidden accept=".json,application/json" aria-label="导入完整草稿" onChange={event => { const picked = event.target.files?.[0]; event.target.value = ''; if (picked) void pick(picked) }}/>
    </div>
    {error ? <Alert type="warning" showIcon title={error}/> : null}
    {preview ? <div className="pr-merge-preview">
      <h4>备份合并预览 · {preview.conflicts.length} 处差异</h4>
      <p>默认保留当前判断；备份缺少的笔记和问题不会清空当前记录。新增条目会追加。</p>
      <div className="pr-merge-diff-list">
        {preview.conflicts.map(c => <details key={c.key} className="pr-merge-diff-item">
          <summary>{c.label}</summary>
          <div className="pr-merge-diff">
            <p>当前内容</p><pre>{c.current}</pre>
            <p>备份内容</p><pre>{c.incoming}</pre>
            <Checkbox checked={choices[c.key] ?? false} onCheckedChange={checked => setChoices({ ...choices, [c.key]: checked })}>对此项采用备份内容</Checkbox>
          </div>
        </details>)}
      </div>
      <Space>
        <Button variant="primary" onClick={() => { onMerge(mergeBackup(work, incoming!, choices).work); setIncoming(null) }}>确认合并草稿</Button>
        <Button onClick={() => setIncoming(null)}>取消恢复</Button>
      </Space>
    </div> : null}
  </section>
}

export function FeedbackCases({ work, version }: { work: PRWork; version: string }) {
  const [selected, setSelected] = useState<string[]>([]), [preview, setPreview] = useState('')
  const questions = work.rounds[version].questions.filter(q => q.feedback)
  return <section className="pr-feedback">
    <h3>反馈案例导出</h3>
    <p>反馈不会自动上传、公开给管理员、成为训练标签或修改模型。仅导出你选择的问题、位置、反馈与理由；不会附带个人笔记和其他问题。</p>
    <div className="pr-feedback-list">
      {questions.map(q => <Checkbox key={q.id} checked={selected.includes(q.id)} onCheckedChange={checked => { setPreview(''); setSelected(checked ? [...selected, q.id] : selected.filter(id => id !== q.id)) }}>{q.body.slice(0, 80)}</Checkbox>)}
    </div>
    <Space wrap>
      <Button disabled={!selected.length} onClick={() => setPreview(JSON.stringify({ format: 'jit-review-feedback-v1', pr: work.rounds[version].source.url, headSha: work.rounds[version].source.headSha, cases: questions.filter(q => selected.includes(q.id)).map(q => ({ question: q.body, source: q.source, evidence: q.evidence, feedback: q.feedback, reason: q.feedbackReason })) }, null, 2))}>预览将导出的字段</Button>
      {preview ? <Button variant="primary" onClick={() => downloadText('selected-review-feedback.json', preview, 'application/json')}>确认导出所选案例</Button> : null}
    </Space>
    {preview ? <TextArea aria-label="反馈导出预览" value={preview} readOnly/> : null}
  </section>
}
