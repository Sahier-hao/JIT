import { afterEach, expect, it, vi } from 'vitest'
import { adoptVersion, createWork, exportReview, mergeBackup, parseBackup, readWorks, saveWork, setFileState, parsePatchLines } from './prReview'
import { snapshot } from './prReview.fixture'


afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
it('anchors deletions to base lines and additions to head lines across hunks', () => {
  const lines = parsePatchLines('@@ -10,2 +10,2 @@\n-old\n+new\n same\n@@ -99 +100 @@\n-end\n+done')
  expect(lines[1]).toMatchObject({ side: 'base', line: 10 })
  expect(lines[2]).toMatchObject({ side: 'head', line: 10 })
  expect(lines[6]).toMatchObject({ side: 'head', line: 100 })
})
it('persists separate work and detects a newer tab instead of losing changes', () => {
  const original = createWork(snapshot())
  const saved = saveWork(original)
  expect(readWorks()[0].latestSnapshotId).toBe('v1')
  expect(() => saveWork(original)).toThrow(/其他页面/)
  expect(saveWork({ ...saved, interest: 'paused' }).interest).toBe('paused')
})
it('carries unchanged reading provenance, flags changed evidence and never resolves a question', () => {
  let work = createWork(snapshot())
  work = setFileState(work, 'v1', 'src/token.py', 'read', true)
  work = setFileState(work, 'v1', 'tests/token.py', 'read', true)
  work.rounds.v1.modelId = 'explicit-selected-model'
  work.rounds.v1.questions[0].evidence.push({ snapshotId: 'v1', path: 'src/token.py', side: 'head', line: 1, blobSha: 'c'.repeat(40), note: 'expiry branch' })
  const next = snapshot('v2', 'e'.repeat(40)); next.files[0].blobSha = 'f'.repeat(40)
  const updated = adoptVersion(work, next)
  expect(updated.rounds.v2.progress['src/token.py'].state).toBe('recheck')
  expect(updated.rounds.v2.progress['tests/token.py'].originSnapshotId).toBe('v1')
  expect(updated.rounds.v2.questions[0].requiresRecheck).toBe(true)
  expect(updated.rounds.v2.questions[0].status).toBe('open')
  expect(updated.rounds.v2.modelId).toBe('explicit-selected-model')
  expect(updated.rounds.v1.questions[0].evidence[0].snapshotId).toBe('v1')
  expect(adoptVersion(updated, next)).toBe(updated)
})
it('cannot mark unavailable code as read and reports uncovered content in output', () => {
  const work = createWork(snapshot())
  expect(() => setFileState(work, 'v1', 'src/token.py', 'read', false)).toThrow()
  const text = exportReview(work, 'v1', 'changes', 'Keep expiry handling explicit')
  expect(text).toContain('尚未覆盖')
  expect(text).toContain('尚未发送到 GitHub')
  expect(text).toContain('b'.repeat(40))
})
it('recognizes a second rename from the same baseline as needing review', () => {
  const first = snapshot(); first.files[0] = { ...first.files[0], path: 'src/first-name.py', previousPath: 'src/original.py', status: 'renamed' }
  const work = setFileState(createWork(first), 'v1', 'src/first-name.py', 'read', true)
  const next = snapshot('v2', 'f'.repeat(40)); next.files[0] = { ...next.files[0], path: 'src/next-name.py', previousPath: 'src/original.py', status: 'renamed' }
  expect(adoptVersion(work, next).rounds.v2.progress['src/next-name.py'].state).toBe('recheck')
})
it('backup preserves missing notes and requires conflict choices', () => {
  const current = createWork(snapshot())
  const backup = structuredClone(current)
  current.rounds.v1.scratch = 'newer private note'
  current.rounds.v1.deliveryDraft = { kind: 'defer', note: 'unfinished current conclusion' }
  backup.rounds.v1.deliveryDraft = { kind: 'changes', note: 'backup conclusion draft' }
  backup.rounds.v1.questions[0].body = 'different judgment'
  const parsed = parseBackup(JSON.stringify({ format: 'jit-pr-review-v1', work: backup }), current.key)
  const merged = mergeBackup(current, parsed, {})
  expect(merged.work.rounds.v1.scratch).toBe('newer private note')
  expect(merged.work.rounds.v1.deliveryDraft).toEqual(current.rounds.v1.deliveryDraft)
  expect(merged.conflicts).toContainEqual(expect.objectContaining({ key: 'v1:deliveryDraft' }))
  expect(mergeBackup(current, parsed, { 'v1:deliveryDraft': true }).work.rounds.v1.deliveryDraft).toEqual(backup.rounds.v1.deliveryDraft)
  delete parsed.rounds.v1.deliveryDraft
  expect(mergeBackup(current, parsed, {}).work.rounds.v1.deliveryDraft).toEqual(current.rounds.v1.deliveryDraft)
  expect(merged.conflicts.length).toBeGreaterThan(0)
  expect(() => parseBackup(JSON.stringify({ format: 'jit-pr-review-v1', work: backup }), 'other/pr#1')).toThrow()
})
