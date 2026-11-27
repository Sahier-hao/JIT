import type { AnalysisCandidate, AnalysisCommit, CommitAnalysisReport } from './report'

export interface CheckSummary {
  risk: number | null
  commitId: string | null
  subject: string
  commits: number
  candidates: number
}

/** 取本次范围内最高的提交分；没有可评分提交时返回 null。 */
export function summarize(report: CommitAnalysisReport): CheckSummary {
  const scored = report.commits.reduce<AnalysisCommit | null>(
    (best, commit) => (best === null || commit.risk > best.risk ? commit : best), null)
  return {
    risk: scored?.risk ?? null,
    commitId: scored?.commitId ?? null,
    subject: scored?.subject ?? '',
    commits: report.commits.length,
    candidates: report.candidates.length,
  }
}

export interface CandidateEntry {
  path: string
  line: number
  ruleId: string
  message: string
}

/** 只保留能落到有效行号的候选，供编辑器诊断使用。 */
export function candidateEntries(report: CommitAnalysisReport): CandidateEntry[] {
  return report.candidates
    .filter(candidate => Number.isSafeInteger(candidate.line) && candidate.line >= 1)
    .map(candidate => ({
      path: candidate.path,
      line: candidate.line,
      ruleId: candidate.ruleId,
      message: messageFor(candidate),
    }))
}

function messageFor(candidate: AnalysisCandidate): string {
  const description = candidate.message || '静态规则命中'
  const evidence = candidate.evidence ? `；命中证据：${candidate.evidence}` : ''
  const suggestion = candidate.suggestion?.title
  const hint = suggestion ? `；建议：${suggestion}` : ''
  return `${candidate.ruleId}：${description}${evidence}${hint}`
}

export function formatRisk(risk: number | null): string {
  return risk === null ? '未评分' : risk.toFixed(2)
}
