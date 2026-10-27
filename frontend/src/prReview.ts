import { parseSnapshot, type PRSnapshot } from './prReviewClient'

export type FileState = 'unread' | 'read' | 'recheck' | 'uncovered'
export const readStatusLabels: Record<FileState, string> = { unread: '未阅读', read: '已阅读', recheck: '需要复核', uncovered: '暂未覆盖' }
export const reviewStatusLabels = { open: '待核对', resolved: '人工标记已解决', deferred: '暂不处理', withdrawn: '已撤回' }
export function parsePatchLines(patch: string): { text: string; side: 'base' | 'head'; line: number | null; kind: 'hunk' | 'add' | 'delete' | 'context' }[] {
  let old = 0, next = 0
  const result: ReturnType<typeof parsePatchLines> = []
  for (const text of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) { old = Number(hunk[1]); next = Number(hunk[2]); result.push({ text, side: 'head', line: null, kind: 'hunk' }); continue }
    const side = text.startsWith('-') ? 'base' : 'head', line = side === 'base' ? old : next
    result.push({ text, side, line: line > 0 ? line : null, kind: text.startsWith('-') ? 'delete' : text.startsWith('+') ? 'add' : 'context' })
    if (text.startsWith('-')) old++; else if (text.startsWith('+')) next++; else if (text.startsWith(' ')) { old++; next++ }
  }
  return result
}
export interface Evidence { snapshotId: string; path: string; side: 'base' | 'head'; line: number | null; blobSha: string; note: string }
export interface ReviewQuestion {
  id: string; body: string; kind: 'question' | 'finding' | 'suggestion'; source: 'author' | 'change' | 'manual'
  originSnapshotId: string; relatedFiles: string[]; evidence: Evidence[]; status: 'open' | 'resolved' | 'deferred' | 'withdrawn'
  judgment: string; reason: string; requiresRecheck: boolean; feedback: '' | 'helpful' | 'irrelevant' | 'more-evidence'; feedbackReason: string
}
export interface ReviewRound {
  source: PRSnapshot; progress: Record<string, { state: FileState; originSnapshotId: string }>; questions: ReviewQuestion[]
  currentFile: string; scratch: string; conclusion: { kind: Conclusion; note: string; markdown: string; createdAt: string } | null
  location?: { side: 'base' | 'head'; line: number }
  modelId?: string
  historyNotice?: string
  scratchOriginSnapshotId?: string
  selectedQuestionId?: string
  deliveryDraft?: { kind: Conclusion; note: string }
}
export type Conclusion = 'changes' | 'complete' | 'defer'
export interface PRWork {
  key: string; owner: string; name: string; number: number; latestSnapshotId: string; viewedSnapshotId: string
  remoteState: 'open' | 'closed' | 'merged'; checkedAt: string; checkError: string; interest: 'active' | 'paused' | 'ended'
  rounds: Record<string, ReviewRound>; revision: number; savedAt: string
}
export const WORK_KEY = 'jit:pr-review:works:v1'
export const workKey = (owner: string, name: string, number: number) => `${owner.toLowerCase()}/${name.toLowerCase()}#${number}`
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
export function question(source: PRSnapshot, body = '', origin: ReviewQuestion['source'] = 'manual'): ReviewQuestion {
  return { id: crypto.randomUUID(), body, source: origin, kind: 'question', originSnapshotId: source.snapshotId, relatedFiles: [], evidence: [], status: 'open', judgment: '', reason: '', requiresRecheck: false, feedback: '', feedbackReason: '' }
}
function localSource(source: PRSnapshot): PRSnapshot { return { ...source, files: source.files.map(file => ({ ...file, patch: null, patchComplete: false })) } }
function round(source: PRSnapshot): ReviewRound {
  const questions = [question(source, `这次改动在实现和相关测试中是否保持一致？（${source.files.length} 个已加载文件，请补充具体核对目标）`, 'change')]
  if (source.body.trim()) questions.unshift(question(source, `核对作者说明中的目标：${source.body.slice(0, 500)}`, 'author'))
  return { source: localSource(source), progress: Object.fromEntries(source.files.map(file => [file.path, { state: 'unread', originSnapshotId: source.snapshotId }])), currentFile: source.files[0]?.path ?? '', scratch: '', questions, conclusion: null }
}
export function createWork(source: PRSnapshot): PRWork {
  return { key: workKey(source.owner, source.name, source.number), owner: source.owner, name: source.name, number: source.number, latestSnapshotId: source.snapshotId, viewedSnapshotId: source.snapshotId,
    remoteState: source.remoteState, checkedAt: source.capturedAt, checkError: '', interest: 'active', rounds: { [source.snapshotId]: round(source) }, revision: 0, savedAt: '' }
}
export function adoptVersion(work: PRWork, source: PRSnapshot): PRWork {
  if (work.key !== workKey(source.owner, source.name, source.number)) throw new Error('工作单来源不一致')
  if (work.rounds[source.snapshotId]) return work
  const next = copy(work), previous = work.rounds[work.latestSnapshotId], fresh = round(source)
  fresh.modelId = previous.modelId
  fresh.selectedQuestionId = previous.selectedQuestionId
  fresh.scratch = previous.scratch
  if (previous.scratch) fresh.scratchOriginSnapshotId = previous.scratchOriginSnapshotId ?? previous.source.snapshotId
  const baseChanged = previous.source.baseSha !== source.baseSha
  fresh.historyNotice = baseChanged ? 'PR 基准版本已变化，可能来自目标分支更新或历史改写；所有先前已读文件需要重新核对。'
    : source.previousSnapshotId !== previous.source.snapshotId || source.historyRelation === 'unknown' ? '两轮提交的继承关系尚未确认；可能存在强制推送。旧意见继续绑定原版本，不自动迁移或解决。'
      : source.historyRelation === 'diverged' || source.historyRelation === 'behind' ? '远端提交历史已分叉或回退，可能存在强制推送。请重新核对关联代码；旧版本和旧意见保留。'
        : '作者提交了新的代码版本；按文件内容核对变化，旧判断保留，未变化文件标明原阅读出处。'
  for (const file of source.files) {
    const old = previous.source.files.find(item => item.path === file.path || item.path === file.previousPath
      || item.status === 'renamed' && file.status === 'renamed' && item.previousPath && item.previousPath === file.previousPath)
    const oldProgress = previous.progress[old?.path ?? file.path]
    if (oldProgress && old && old.path === file.path && old.blobSha === file.blobSha && old.status === file.status && !baseChanged) fresh.progress[file.path] = copy(oldProgress)
    else if (oldProgress?.state === 'read' || oldProgress?.state === 'recheck') fresh.progress[file.path].state = 'recheck'
  }
  fresh.questions = previous.questions.map(item => ({ ...copy(item), requiresRecheck: item.requiresRecheck || baseChanged || !item.relatedFiles.length && !item.evidence.length || item.relatedFiles.some(path => {
    const old = previous.source.files.find(file => file.path === path), latest = source.files.find(file => file.path === path)
    return !old || !latest || old.blobSha !== latest.blobSha
  }) || item.evidence.some(anchor => {
    const file = source.files.find(file => file.path === anchor.path)
    return !file || file.blobSha !== anchor.blobSha
  }) }))
  next.rounds[source.snapshotId] = fresh
  next.latestSnapshotId = source.snapshotId
  return next
}
export function setFileState(work: PRWork, version: string, path: string, state: FileState, readable: boolean): PRWork {
  if (!work.rounds[version]?.source.files.some(file => file.path === path) || state === 'read' && !readable) throw new Error('文件未完整读取，不能标为已阅读')
  const result = copy(work)
  result.rounds[version].progress[path] = { state, originSnapshotId: version }
  return result
}
function validWork(raw: unknown): PRWork {
  const work = raw as PRWork
  if (!work || typeof work !== 'object' || work.key !== workKey(work.owner, work.name, work.number) || !Number.isInteger(work.revision) || work.revision < 0 || !['active', 'paused', 'ended'].includes(work.interest) || !work.rounds?.[work.latestSnapshotId] || !work.rounds[work.viewedSnapshotId]) throw new Error('工作单备份格式无效')
  for (const [id, item] of Object.entries(work.rounds)) {
    const source = parseSnapshot(item.source)
    if (item.modelId !== undefined && typeof item.modelId !== 'string') throw new Error('模型选择格式无效')
    if (item.scratch === undefined) item.scratch = ''
    if (item.selectedQuestionId !== undefined && typeof item.selectedQuestionId !== 'string' || item.historyNotice !== undefined && typeof item.historyNotice !== 'string'
      || item.scratchOriginSnapshotId !== undefined && typeof item.scratchOriginSnapshotId !== 'string'
      || item.location && (!['base', 'head'].includes(item.location.side) || !Number.isInteger(item.location.line) || item.location.line < 1)) throw new Error('工作单位置或版本说明无效')
    if (id !== source.snapshotId || workKey(source.owner, source.name, source.number) !== work.key || typeof item.scratch !== 'string' || !Array.isArray(item.questions) || item.questions.length > 500) throw new Error('工作单版本或记录无效')
    const ids = new Set<string>()
    for (const q of item.questions) {
      if (!q.id || ids.has(q.id) || typeof q.body !== 'string' || typeof q.reason !== 'string' || typeof q.judgment !== 'string' || typeof q.feedbackReason !== 'string' || typeof q.requiresRecheck !== 'boolean' || !['question', 'finding', 'suggestion'].includes(q.kind) || !['author', 'change', 'manual'].includes(q.source) || !['open', 'resolved', 'deferred', 'withdrawn'].includes(q.status) || !['', 'helpful', 'irrelevant', 'more-evidence'].includes(q.feedback) || !Array.isArray(q.relatedFiles) || !q.relatedFiles.every(p => typeof p === 'string') || !Array.isArray(q.evidence)) throw new Error('审查问题格式无效')
      ids.add(q.id)
      for (const e of q.evidence) if (typeof e.snapshotId !== 'string' || typeof e.path !== 'string' || !['base', 'head'].includes(e.side) || e.line !== null && (!Number.isInteger(e.line) || e.line < 1) || typeof e.note !== 'string' || typeof e.blobSha !== 'string') throw new Error('证据位置无效')
    }
    for (const [path, progress] of Object.entries(item.progress)) if (!source.files.some(f => f.path === path) || !['read', 'recheck', 'unread', 'uncovered'].includes(progress.state) || typeof progress.originSnapshotId !== 'string') throw new Error('阅读进度无效')
    if (item.conclusion && (typeof item.conclusion.markdown !== 'string' || typeof item.conclusion.note !== 'string' || !['changes', 'complete', 'defer'].includes(item.conclusion.kind))) throw new Error('结论格式无效')
    if (item.deliveryDraft && (typeof item.deliveryDraft.note !== 'string' || !['changes', 'complete', 'defer'].includes(item.deliveryDraft.kind))) throw new Error('结论草稿格式无效')
  }
  return work
}
export function readWorks(): PRWork[] {
  const raw = JSON.parse(localStorage.getItem(WORK_KEY) ?? '{}')
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('个人工作单存储不可读，请先导出或恢复备份')
  return Object.values(raw).map(validWork)
}
export function saveWork(work: PRWork): PRWork {
  const works = readWorks(), old = works.find(item => item.key === work.key)
  if (old && old.revision !== work.revision) throw new Error('其他页面已保存较新工作单，请导出当前草稿后通过备份合并，未覆盖任何记录')
  const next = { ...work, revision: work.revision + 1, savedAt: new Date().toISOString() }
  localStorage.setItem(WORK_KEY, JSON.stringify(Object.fromEntries([...works.filter(item => item.key !== work.key), next].map(item => [item.key, item]))))
  window.dispatchEvent(new Event('jit:pr-work-changed'))
  return next
}
export function parseBackup(text: string, key?: string): PRWork {
  if (new Blob([text]).size > 1024 * 1024) throw new Error('备份不能超过 1 MiB')
  const parsed = JSON.parse(text)
  if (parsed.format !== 'jit-pr-review-v1') throw new Error('不支持的工作单备份格式')
  const work = validWork(parsed.work)
  if (key && work.key !== key) throw new Error('备份不属于当前 PR')
  return work
}
export interface MergeConflict { key: string; label: string; current: string; incoming: string }
export function mergeBackup(current: PRWork, incoming: PRWork, choices: Record<string, boolean>): { work: PRWork; conflicts: MergeConflict[] } {
  if (current.key !== incoming.key) throw new Error('备份来源不一致')
  const result = copy(current), conflicts: MergeConflict[] = []
  for (const [id, imported] of Object.entries(incoming.rounds)) {
    const old = result.rounds[id]
    if (!old) { result.rounds[id] = copy(imported); continue }
    if (old.source.baseSha !== imported.source.baseSha || old.source.headSha !== imported.source.headSha) throw new Error('同一版本的来源冲突，拒绝合并')
    for (const field of ['scratch', 'conclusion', 'deliveryDraft'] as const) {
      if (!imported[field] || JSON.stringify(old[field]) === JSON.stringify(imported[field])) continue
      const key = `${id}:${field}`
      if (old[field]) conflicts.push({ key, label: field === 'scratch' ? '个人笔记' : field === 'conclusion' ? '本轮结论' : '未完成的结论草稿', current: JSON.stringify(old[field]), incoming: JSON.stringify(imported[field]) })
      if (!old[field] || choices[key]) {
        if (field === 'scratch') old.scratch = imported.scratch
        else if (field === 'conclusion') old.conclusion = copy(imported.conclusion)
        else old.deliveryDraft = copy(imported.deliveryDraft)
      }
    }
    for (const q of imported.questions) {
      const index = old.questions.findIndex(item => item.id === q.id)
      if (index < 0) old.questions.push(copy(q))
      else if (JSON.stringify(old.questions[index]) !== JSON.stringify(q)) {
        const key = `${id}:question:${q.id}`
        conflicts.push({ key, label: q.body.slice(0, 50) || '审查问题', current: JSON.stringify(old.questions[index]), incoming: JSON.stringify(q) })
        if (choices[key]) old.questions[index] = copy(q)
      }
    }
    for (const [path, p] of Object.entries(imported.progress)) {
      const previous = old.progress[path]
      if (!previous) old.progress[path] = copy(p)
      else if (JSON.stringify(previous) !== JSON.stringify(p)) {
        const key = `${id}:progress:${path}`
        conflicts.push({ key, label: `阅读进度 ${path}`, current: JSON.stringify(previous), incoming: JSON.stringify(p) })
        if (choices[key]) old.progress[path] = copy(p)
      }
    }
  }
  return { work: result, conflicts }
}
export const conclusionLabels: Record<Conclusion, string> = { changes: '建议修改', complete: '本轮审查完成', defer: '暂缓审查' }
export function evidenceURL(source: PRSnapshot, e: Evidence): string {
  const repository = e.side === 'base' ? source.baseRepository : source.headRepository
  const ref = e.side === 'base' ? source.baseSha : source.headSha
  const path = e.side === 'base' ? source.files.find(f => f.path === e.path)?.previousPath ?? e.path : e.path
  return `https://github.com/${repository ?? source.baseRepository}/blob/${ref}/${path.split('/').map(encodeURIComponent).join('/')}${e.line ? '#L' + e.line : ''}`
}
export function exportReview(work: PRWork, version: string, kind: Conclusion, note: string): string {
  const item = work.rounds[version], s = item.source, read = s.files.filter(f => item.progress[f.path]?.state === 'read'), unreviewed = s.files.filter(f => item.progress[f.path]?.state !== 'read')
  return [`# ${conclusionLabels[kind]}：${s.title}`, `PR：${s.url}`, `基准版本：${s.baseSha}\n目标版本：${s.headSha}`, `意见属于此固定版本；最近检查：${work.checkedAt}。尚未发送到 GitHub，个人完成状态不代表远端批准或合并。`,
    `## 本轮说明\n${note || '未补充'}`, `## 已阅读范围（${read.length}/${s.totalFiles}）\n${read.map(f => '- ' + f.path).join('\n') || '无'}`, `## 尚未覆盖\n${unreviewed.map(f => '- ' + f.path + ' · ' + readStatusLabels[item.progress[f.path]?.state ?? 'unread']).join('\n') || '无已加载文件待阅读'}${!s.filesComplete ? '\n- 尚有 ' + (s.totalFiles - s.files.length) + ' 个文件未加载' : ''}`,
    '## 人工记录与待核对问题', ...item.questions.filter(q => q.status !== 'withdrawn').map(q => `### ${q.kind === 'finding' ? '人工确认的问题' : q.kind === 'suggestion' ? '一般建议' : '待确认问题'} · ${reviewStatusLabels[q.status]}\n${q.body}\n人工判断：${q.judgment || '待核对'}\n处理理由：${q.reason || '未补充'}${q.requiresRecheck ? '\n旧证据涉及的代码变化，仍需复核。' : ''}\n${q.evidence.map(e => `- [${e.path}${e.line ? ':' + e.line : ''}](${evidenceURL(work.rounds[e.snapshotId]?.source ?? s, e)}) · ${e.note}`).join('\n')}`)].join('\n\n')
}
export function downloadText(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` })), link = document.createElement('a')
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
