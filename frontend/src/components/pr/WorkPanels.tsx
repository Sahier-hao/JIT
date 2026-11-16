import { Icon } from '../../Icon'
import { useRef, useState } from 'react'
import { Alert, Space } from '../../ui/feedback'
import { Button, Checkbox, NativeSelect, TextArea } from '../../ui/controls'
import { backupText, downloadText, evidenceURL, mergeBackup, parseBackupInfo, type Conclusion, type Evidence, type PRWork, type ReviewQuestion } from '../../prReview'
import { verifyBackupSources, type PRSnapshot } from '../../prReviewClient'

const message = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试'
function backup(work: PRWork, account: string | null) { downloadText(`review-${work.owner}-${work.name}-${work.number}.json`, backupText(work, account), 'application/json') }
const field = 'grid gap-1.5'
const fieldLabel = 'text-xs font-medium text-foreground-2'

export function QuestionEditor({ value: q, source, onChange, onJump, work }: { value: ReviewQuestion; source: PRSnapshot; onChange: (value: ReviewQuestion) => void; onJump: (e: Evidence) => void; work: PRWork }) {
  const [error, setError] = useState('')
  return <div className="grid gap-3">
    <p className="text-xs text-foreground-3">来源：{q.source === 'author' ? '作者原始说明中的核对目标' : q.source === 'change' ? '已加载文件事实，规则生成的核对问题' : '人工提出'} · 原版本 {q.originSnapshotId.slice(0, 12)}</p>
    {q.requiresRecheck ? <p className="text-xs text-amber-deep">相关代码已变化，旧证据可能过期。原问题和判断保留，请人工核对。</p> : null}
    <label className={field}><span className={fieldLabel}>问题、疑问或建议</span><TextArea aria-label="审查问题内容" value={q.body} onChange={e => onChange({ ...q, body: e.target.value })}/></label>
    <label className={field}><span className={fieldLabel}>记录类型</span><NativeSelect aria-label="审查记录类型" value={q.kind} onChange={e => onChange({ ...q, kind: e.target.value as ReviewQuestion['kind'] })}><option value="question">待确认的问题</option><option value="finding">人工确认的问题</option><option value="suggestion">一般建议</option></NativeSelect></label>
    <details className="rounded-sm border border-border-soft">
      <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-foreground-2">关联实现与测试文件（{q.relatedFiles.length}）</summary>
      <div className="grid max-h-40 gap-1 overflow-auto border-t border-border-soft p-2.5">{source.files.map(f => <Checkbox key={f.path} checked={q.relatedFiles.includes(f.path)} onCheckedChange={checked => onChange({ ...q, relatedFiles: checked ? [...q.relatedFiles, f.path] : q.relatedFiles.filter(p => p !== f.path) })}>{f.path}</Checkbox>)}</div>
    </details>
    <label className={field}><span className={fieldLabel}>人工判断</span><TextArea aria-label="人工判断" value={q.judgment} onChange={e => onChange({ ...q, judgment: e.target.value })}/></label>
    <label className={field}><span className={fieldLabel}>处理理由</span><TextArea aria-label="问题处理理由" value={q.reason} onChange={e => onChange({ ...q, reason: e.target.value })}/></label>
    <label className={field}><span className={fieldLabel}>处理状态</span><NativeSelect aria-label="问题处理状态" value={q.status} onChange={e => { const status = e.target.value as ReviewQuestion['status']; if (status !== 'open' && !q.reason.trim()) { setError('先填写处理理由，原内容会保留'); return } setError(''); onChange({ ...q, status }) }}><option value="open">待核对 / 重新打开</option><option value="resolved">人工标记已解决</option><option value="deferred">暂不处理</option><option value="withdrawn">撤回记录（保留原文）</option></NativeSelect></label>
    {error ? <p className="text-xs text-rose">{error}</p> : null}
    {q.requiresRecheck ? <Button size="sm" className="justify-self-start" disabled={!q.reason.trim()} onClick={() => onChange({ ...q, requiresRecheck: false })}>已人工复核当前版本</Button> : null}
    <h3 className="text-sm font-semibold text-foreground">位置与证据（{q.evidence.length}）</h3>
    <div className="grid gap-1.5">{q.evidence.map((e, index) => <article key={index} className="grid gap-1 rounded-sm border border-border-soft p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="link" size="sm" onClick={() => onJump(e)}>{e.path}:{e.line ?? '整体'} · {e.side === 'head' ? '目标' : '基准'} · 原版本</Button>
        <a className="text-accent underline-offset-2 hover:underline" href={evidenceURL(work.rounds[e.snapshotId]?.source ?? source, e)} target="_blank" rel="noreferrer">核对原代码</a>
      </div>
      <input className="h-8 w-full rounded-sm border border-input bg-card px-2 text-xs text-foreground" aria-label={`证据说明 ${index + 1}`} value={e.note} placeholder="已核对什么，还缺什么证据" onChange={event => onChange({ ...q, evidence: q.evidence.map((a, i) => i === index ? { ...a, note: event.target.value } : a) })}/>
      <Button variant="link" size="sm" className="justify-self-start" onClick={() => onChange({ ...q, evidence: q.evidence.filter((_, i) => i !== index) })}>移除此证据</Button>
    </article>)}</div>
    <label className={field}><span className={fieldLabel}>对线索的反馈</span><NativeSelect aria-label="线索反馈" value={q.feedback} onChange={e => onChange({ ...q, feedback: e.target.value as ReviewQuestion['feedback'] })}><option value="">尚未反馈</option><option value="helpful">有帮助</option><option value="irrelevant">无关</option><option value="more-evidence">需要更多证据</option></NativeSelect></label>
    <input className="h-8 w-full rounded-sm border border-input bg-card px-2 text-xs text-foreground" aria-label="线索反馈理由" value={q.feedbackReason} onChange={e => onChange({ ...q, feedbackReason: e.target.value })} placeholder="反馈理由（仅保存在当前浏览器）"/>
  </div>
}

export function DeliveryForm({ onPrepare, busy, draft, onDraft }: { onPrepare: (kind: Conclusion, note: string) => Promise<void>; busy: boolean; draft?: { kind: Conclusion; note: string }; onDraft: (value: { kind: Conclusion; note: string }) => void }) {
  const kind = draft?.kind ?? 'changes', note = draft?.note ?? ''
  return <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void onPrepare(kind, note) }}>
    <div className={field}>
      <span className={fieldLabel}>本轮结论</span>
      <NativeSelect aria-label="本轮结论" value={kind} onChange={event => onDraft({ kind: event.target.value as Conclusion, note })}>
        <option value="changes">建议修改</option><option value="complete">本轮审查完成</option><option value="defer">暂缓并说明原因</option>
      </NativeSelect>
    </div>
    <div className={field}>
      <span className={fieldLabel}>说明与未完成事项</span>
      <TextArea aria-label="本轮结论说明" value={note} onChange={event => onDraft({ kind, note: event.target.value })}/>
    </div>
    <Button variant="primary" type="submit" className="justify-self-start" disabled={busy}>检查版本并预览意见</Button>
  </form>
}
export function WorkBackup({ work, onMerge, account }: { work: PRWork; onMerge: (work: PRWork) => unknown; account: string | null }) {
  const [incoming, setIncoming] = useState<PRWork | null>(null), [choices, setChoices] = useState<Record<string, boolean>>({}), [error, setError] = useState('')
  const [accountHint, setAccountHint] = useState<string | null>(null)
  const file = useRef<HTMLInputElement | null>(null)
  const preview = incoming ? mergeBackup(work, incoming, choices) : null
  async function pick(picked: File) {
    try {
      if (picked.size > 1024 * 1024) throw new Error('备份超过 1 MiB')
      const info = parseBackupInfo(await picked.text(), work.key)
      if (info.accountHint && info.accountHint !== account
          && !window.confirm(`备份归属 ${info.accountHint}，将导入当前账户 ${account}。继续？`)) return
      await verifyBackupSources(info.work)
      mergeBackup(work, info.work, {})
      setIncoming(info.work); setAccountHint(info.accountHint); setChoices({}); setError('')
    } catch (failure) { setError(message(failure)) }
  }
  return <section className="grid gap-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">个人草稿备份</h3>
        <p className="mt-0.5 text-xs leading-body text-foreground-3">包含此 PR 各版本的个人笔记、问题、反馈和结论。仅在你选择导出时生成本地文件，不上传。</p>
      </div>
      <Space wrap>
        <Button icon={<Icon name="download"/>} aria-label="导出完整草稿" onClick={() => backup(work, account)}>导出完整草稿</Button>
        <Button icon={<Icon name="upload"/>} aria-label="选择备份以预览合并" onClick={() => file.current?.click()}>选择备份以预览合并</Button>
      </Space>
      <input ref={file} type="file" hidden accept=".json,application/json" aria-label="导入完整草稿" onChange={event => { const picked = event.target.files?.[0]; event.target.value = ''; if (picked) void pick(picked) }}/>
    </div>
    {error ? <Alert type="warning" title={error}/> : null}
    {preview ? <div className="grid gap-2 rounded-sm border border-border-soft p-3">
      <h4 className="text-sm font-semibold text-foreground">备份合并预览 · {preview.conflicts.length} 处差异</h4>
      <p className="text-xs text-foreground-3">导入目标：{account ?? '身份尚未确认'}；备份归属：{accountHint ?? '未知'}。</p>
      <p className="text-xs leading-body text-foreground-3">默认保留当前判断；备份缺少的笔记和问题不会清空当前记录。新增条目会追加。</p>
      <div className="grid gap-1.5">
        {preview.conflicts.map(c => <details key={c.key} className="rounded-sm border border-border-soft">
          <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-foreground-2">{c.label}</summary>
          <div className="grid gap-1.5 border-t border-border-soft p-2.5 text-xs">
            <p className="text-foreground-3">当前内容</p><pre className="overflow-auto rounded-sm bg-soft p-2 font-mono text-[11px] text-foreground-2">{c.current}</pre>
            <p className="text-foreground-3">备份内容</p><pre className="overflow-auto rounded-sm bg-soft p-2 font-mono text-[11px] text-foreground-2">{c.incoming}</pre>
            <Checkbox checked={choices[c.key] ?? false} onCheckedChange={checked => setChoices({ ...choices, [c.key]: checked })}>对此项采用备份内容</Checkbox>
          </div>
        </details>)}
      </div>
      <Space wrap>
        <Button variant="primary" onClick={() => { onMerge(mergeBackup(work, incoming!, choices).work); setIncoming(null) }}>确认合并草稿</Button>
        <Button onClick={() => setIncoming(null)}>取消恢复</Button>
      </Space>
    </div> : null}
  </section>
}

export function FeedbackCases({ work, version }: { work: PRWork; version: string }) {
  const [selected, setSelected] = useState<string[]>([]), [preview, setPreview] = useState('')
  const questions = work.rounds[version].questions.filter(q => q.feedback)
  return <section className="grid gap-2 rounded-sm border border-border-soft p-3">
    <h3 className="text-sm font-semibold text-foreground">反馈案例导出</h3>
    <p className="text-xs leading-body text-foreground-3">反馈不会自动上传、公开给管理员、成为训练标签或修改模型。仅导出你选择的问题、位置、反馈与理由；不会附带个人笔记和其他问题。</p>
    <div className="grid gap-1">
      {questions.map(q => <Checkbox key={q.id} checked={selected.includes(q.id)} onCheckedChange={checked => { setPreview(''); setSelected(checked ? [...selected, q.id] : selected.filter(id => id !== q.id)) }}>{q.body.slice(0, 80)}</Checkbox>)}
    </div>
    <Space wrap>
      <Button disabled={!selected.length} onClick={() => setPreview(JSON.stringify({ format: 'jit-review-feedback-v1', pr: work.rounds[version].source.url, headSha: work.rounds[version].source.headSha, cases: questions.filter(q => selected.includes(q.id)).map(q => ({ question: q.body, source: q.source, evidence: q.evidence, feedback: q.feedback, reason: q.feedbackReason })) }, null, 2))}>预览将导出的字段</Button>
      {preview ? <Button variant="primary" onClick={() => downloadText('selected-review-feedback.json', preview, 'application/json')}>确认导出所选案例</Button> : null}
    </Space>
    {preview ? <TextArea aria-label="反馈导出预览" value={preview} readOnly/> : null}
  </section>
}
