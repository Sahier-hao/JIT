import { apiRequest } from '@/lib/apiClient'
import { contractFailed, finiteNumber, hexDigest, record, recordList, text, textList, textOrNull } from '@/lib/apiContract'

export type LineEvidenceStatus =
  | 'supported'
  | 'unsupported-language'
  | 'generated-or-skipped-path'
  | 'deleted'
  | 'patch-incomplete'
  | 'no-candidates'
  | 'content-unavailable'
  | 'source-unavailable'
  | 'model-unavailable'

export interface LineEvidenceContext {
  sourceKind: 'pr-snapshot' | 'repository-commit'
  resourceId: string
  repositoryId: string | null
  commitId: string
  path: string
  side: 'head'
}

export interface LineEvidenceContribution {
  feature: string
  label: string
  value: number
  weight: number
  contribution: number
  direction: 'increases' | 'decreases'
}

export interface LineEvidenceRow {
  rank: number
  path: string
  side: 'head'
  line: number
  text: string
  score: number
  logit: number
  languageContribution: number
  contributions: LineEvidenceContribution[]
  contributionTotal: number
  otherContribution: number
}

export interface LineReviewEvidence {
  status: LineEvidenceStatus
  reason: string | null
  sourceKind: LineEvidenceContext['sourceKind']
  resourceId: string
  repositoryId: string | null
  commitId: string
  ref: string
  path: string
  side: 'head'
  language: 'javascript' | 'typescript' | null
  coverage: {
    patchComplete: boolean
    status: string
    addedLines: number | null
    eligibleLines: number
    skippedBlank: number | null
    textSource: 'patch'
    usesFullFile: false
  }
  explanationMethod: 'linear-logodds-line-v1'
  explanationUnit: 'logit'
  contributionCaveat: string
  artifactSha256: string | null
  intercept: number | null
  lines: LineEvidenceRow[]
  caveats: string[]
}

const STATUSES: LineEvidenceStatus[] = [
  'supported', 'unsupported-language', 'generated-or-skipped-path', 'deleted',
  'patch-incomplete', 'no-candidates', 'content-unavailable', 'source-unavailable',
  'model-unavailable',
]

function integer(value: unknown, minimum = 0): number {
  const parsed = finiteNumber(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) contractFailed('行级证据整数无效')
  return parsed
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : finiteNumber(value)
}

function nullableCount(value: unknown): number | null {
  return value == null ? null : integer(value)
}

function status(value: unknown): LineEvidenceStatus {
  const parsed = text(value)
  if (!STATUSES.includes(parsed as LineEvidenceStatus)) contractFailed('未知行级证据状态')
  return parsed as LineEvidenceStatus
}

function contribution(value: unknown): LineEvidenceContribution {
  const item = record(value)
  const feature = text(item.feature)
  const label = text(item.label)
  const valueNumber = finiteNumber(item.value)
  const weight = finiteNumber(item.weight)
  const effect = finiteNumber(item.contribution)
  const direction = text(item.direction)
  if (effect === 0) contractFailed('行级特征贡献不能为零')
  if (valueNumber < 0) contractFailed('行级特征值不能为负')
  if (direction !== (effect > 0 ? 'increases' : 'decreases')) contractFailed('行级特征方向不一致')
  return {
    feature,
    label,
    value: valueNumber,
    weight,
    contribution: effect,
    direction,
  }
}

export function parseLineReviewEvidence(value: unknown, expected: LineEvidenceContext): LineReviewEvidence {
  const raw = record(value)
  if (text(raw.schema) !== 'line-review-evidence-v1') contractFailed('行级证据格式无效')
  if (text(raw.sourceKind) !== expected.sourceKind || text(raw.resourceId) !== expected.resourceId
    || text(raw.commitId) !== expected.commitId || text(raw.path) !== expected.path
    || text(raw.side) !== expected.side) contractFailed('行级证据对象身份不一致')
  if (textOrNull(raw.repositoryId) !== expected.repositoryId) contractFailed('行级证据仓库身份不一致')
  const parsedStatus = status(raw.status)
  const language = raw.language == null ? null : text(raw.language)
  if (language !== null && language !== 'javascript' && language !== 'typescript') contractFailed('未知行级证据语言')
  if (raw.explanationMethod !== 'linear-logodds-line-v1' || raw.explanationUnit !== 'logit') contractFailed('行级证据方法或单位无效')
  const coverageRaw = record(raw.coverage)
  if (coverageRaw.textSource !== 'patch' || coverageRaw.usesFullFile !== false) {
    contractFailed('行级证据文本来源无效')
  }
  const coverage = {
    patchComplete: coverageRaw.patchComplete === true,
    status: text(coverageRaw.status),
    addedLines: nullableCount(coverageRaw.addedLines),
    eligibleLines: integer(coverageRaw.eligibleLines),
    skippedBlank: nullableCount(coverageRaw.skippedBlank),
    textSource: 'patch' as const,
    usesFullFile: false as const,
  }
  const artifactSha256 = raw.artifactSha256 == null ? null : hexDigest(raw.artifactSha256)
  const intercept = nullableNumber(raw.intercept)
  const caveat = text(raw.contributionCaveat)
  const lines = recordList(raw.lines).map((item, index) => {
    const row = record(item)
    if (text(row.path) !== expected.path || text(row.side) !== 'head') contractFailed('行级证据路径或侧别不一致')
    const rank = integer(row.rank, 1)
    const line = integer(row.line, 1)
    const score = finiteNumber(row.score)
    if (rank !== index + 1 || score < 0 || score > 1) contractFailed('行级证据排名或研究分无效')
    const contributions = recordList(row.contributions).map(contribution)
    if (contributions.length > 3
      || new Set(contributions.map(item => item.feature)).size !== contributions.length
      || contributions.some((item, itemIndex) => itemIndex > 0
        && Math.abs(item.contribution) > Math.abs(contributions[itemIndex - 1].contribution))) {
      contractFailed('行级特征贡献排序或去重无效')
    }
    return {
      rank,
      path: text(row.path),
      side: 'head' as const,
      line,
      text: typeof row.text === 'string' ? row.text : '',
      score,
      logit: finiteNumber(row.logit),
      languageContribution: finiteNumber(row.languageContribution),
      contributions,
      contributionTotal: finiteNumber(row.contributionTotal),
      otherContribution: finiteNumber(row.otherContribution),
    }
  })
  if (new Set(lines.map(item => item.line)).size !== lines.length
    || lines.some((item, index) => index > 0 && (item.score > lines[index - 1].score
      || item.score === lines[index - 1].score && item.line <= lines[index - 1].line))) {
    contractFailed('行级候选行不唯一或排序无效')
  }
  if (parsedStatus !== 'supported' && lines.length) contractFailed('不可用行级证据不应包含候选行')
  if (parsedStatus === 'supported'
    && (!language || !artifactSha256 || intercept === null || !lines.length || !caveat)) {
    contractFailed('可用行级证据缺少模型、候选或说明')
  }
  return {
    status: parsedStatus,
    reason: textOrNull(raw.reason),
    sourceKind: expected.sourceKind,
    resourceId: expected.resourceId,
    repositoryId: expected.repositoryId,
    commitId: expected.commitId,
    ref: text(raw.ref),
    path: expected.path,
    side: 'head',
    language: language as LineReviewEvidence['language'],
    coverage,
    explanationMethod: 'linear-logodds-line-v1',
    explanationUnit: 'logit',
    contributionCaveat: caveat,
    artifactSha256,
    intercept,
    lines,
    caveats: textList(raw.caveats),
  }
}

export async function requestPRLineEvidence(
  context: LineEvidenceContext,
  signal?: AbortSignal,
): Promise<LineReviewEvidence> {
  if (context.sourceKind !== 'pr-snapshot') contractFailed('PR 行级证据上下文无效')
  const params = new URLSearchParams({ path: context.path, side: context.side })
  const body = await apiRequest({
    path: `/api/v1/pr-snapshots/${encodeURIComponent(context.resourceId)}/line-evidence?${params}`,
    method: 'GET',
    signal,
  })
  return parseLineReviewEvidence(body, context)
}

export async function requestCommitLineEvidence(
  context: LineEvidenceContext,
  viewSyncId: string,
  signal?: AbortSignal,
): Promise<LineReviewEvidence> {
  if (context.sourceKind !== 'repository-commit') contractFailed('提交行级证据上下文无效')
  const params = new URLSearchParams({ viewSyncId, path: context.path })
  const body = await apiRequest({
    path: `/api/v1/repositories/${encodeURIComponent(context.resourceId)}/commits/${encodeURIComponent(context.commitId)}/line-evidence?${params}`,
    method: 'GET',
    signal,
  })
  return parseLineReviewEvidence(body, context)
}
