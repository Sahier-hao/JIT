/** 报告解析与身份核对；不依赖 vscode，便于用 node 测试。 */

export interface AnalysisCommit {
  commitId: string
  risk: number
  subject: string
  authorName: string
  time: string
  addedLines: number
  deletedLines: number
  files: number
  filePaths: string[]
}

export interface AnalysisCandidate {
  side: string
  path: string
  line: number
  ruleId: string
  ruleVersion: string
  message: string
  evidence: string
  suggestion?: { title: string; rationale: string; manualChecks: string[] } | null
}

export interface CommitAnalysisReport {
  format: 'jit-commit-analysis-v1'
  analysisId: string
  contentSha256: string
  repository: { path: string; baseSha: string; headSha: string; commitsInRange: number }
  model: { modelId: string | null; name: string | null; runId: string; method: string; featureSchema: string }
  coverage: { commitsTotal: number; commitsScored: number; candidateFiles: number }
  commits: AnalysisCommit[]
  candidates: AnalysisCandidate[]
  limitations: string[]
}

export interface IdentityResult {
  state: 'match' | 'stale' | 'unknown'
  message: string
}

function fail(message: string): never {
  throw new Error(message)
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`报告字段 ${field} 无效`)
  return value
}

function number(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`报告字段 ${field} 不是数值`)
  return value
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail('报告列表字段无效')
  return value
}

function safeRelativePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.startsWith('\\')
    || /^[A-Za-z]:/.test(value)) {
    fail(`候选路径无效：${String(value)}`)
  }
  const parts = value.split(/[\\/]+/)
  if (parts.some(part => part === '..')) fail(`候选路径不能越过工作区：${value}`)
  return parts.join('/')
}

/** 把报告解析为固定结构；格式或关键字段不合法时直接拒绝。内容一律视为数据。 */
export function parseReport(raw: unknown): CommitAnalysisReport {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('报告不是 JSON 对象')
  const value = raw as Record<string, unknown>
  if (value.format !== 'jit-commit-analysis-v1') fail('不是受支持的 JIT 提交分析报告')
  const repository = value.repository as Record<string, unknown>
  const model = value.model as Record<string, unknown>
  const coverage = value.coverage as Record<string, unknown>
  if (!repository || !model || !coverage) fail('报告缺少仓库、模型或覆盖信息')
  return {
    format: 'jit-commit-analysis-v1',
    analysisId: text(value.analysisId, 'analysisId'),
    contentSha256: text(value.contentSha256, 'contentSha256'),
    repository: {
      path: text(repository.path, 'repository.path'),
      baseSha: text(repository.baseSha, 'repository.baseSha'),
      headSha: text(repository.headSha, 'repository.headSha'),
      commitsInRange: number(repository.commitsInRange, 'repository.commitsInRange'),
    },
    model: {
      modelId: typeof model.modelId === 'string' ? model.modelId : null,
      name: typeof model.name === 'string' ? model.name : null,
      runId: text(model.runId, 'model.runId'),
      method: text(model.method, 'model.method'),
      featureSchema: text(model.featureSchema, 'model.featureSchema'),
    },
    coverage: {
      commitsTotal: number(coverage.commitsTotal, 'coverage.commitsTotal'),
      commitsScored: number(coverage.commitsScored, 'coverage.commitsScored'),
      candidateFiles: number(coverage.candidateFiles ?? 0, 'coverage.candidateFiles'),
    },
    commits: list(value.commits).map(item => {
      const commit = item as Record<string, unknown>
      return {
        commitId: text(commit.commitId, 'commit.commitId'),
        risk: number(commit.risk, 'commit.risk'),
        subject: typeof commit.subject === 'string' ? commit.subject : '',
        authorName: typeof commit.authorName === 'string' ? commit.authorName : '',
        time: typeof commit.time === 'string' ? commit.time : '',
        addedLines: number(commit.addedLines ?? 0, 'commit.addedLines'),
        deletedLines: number(commit.deletedLines ?? 0, 'commit.deletedLines'),
        files: number(commit.files ?? 0, 'commit.files'),
        filePaths: Array.isArray(commit.filePaths) ? commit.filePaths.map(path => safeRelativePath(path)) : [],
      }
    }),
    candidates: list(value.candidates).map(item => {
      const candidate = item as Record<string, unknown>
      const suggestion = candidate.suggestion as Record<string, unknown> | null | undefined
      return {
        side: text(candidate.side, 'candidate.side'),
        path: safeRelativePath(candidate.path),
        line: number(candidate.line, 'candidate.line'),
        ruleId: text(candidate.ruleId, 'candidate.ruleId'),
        ruleVersion: typeof candidate.ruleVersion === 'string' ? candidate.ruleVersion : '',
        message: typeof candidate.message === 'string' ? candidate.message : '',
        evidence: typeof candidate.evidence === 'string' ? candidate.evidence : '',
        suggestion: suggestion ? {
          title: text(suggestion.title, 'suggestion.title'),
          rationale: text(suggestion.rationale, 'suggestion.rationale'),
          manualChecks: Array.isArray(suggestion.manualChecks) ? suggestion.manualChecks.filter((check): check is string => typeof check === 'string') : [],
        } : null,
      }
    }),
    limitations: Array.isArray(value.limitations) ? value.limitations.filter((item): item is string => typeof item === 'string') : [],
  }
}

/** 比较报告目标提交与当前检出；只知道其中一方时标为未核对，不在错误版本上标注。 */
export function identity(report: CommitAnalysisReport, currentHead: string | null, dirty = false): IdentityResult {
  if (!currentHead) {
    return { state: 'unknown', message: '无法读取当前工作区的 Git HEAD，报告只读展示，不定位到代码行。' }
  }
  if (report.repository.headSha !== currentHead) {
    return {
      state: 'stale',
      message: `报告对应提交 ${report.repository.headSha.slice(0, 12)}，当前 HEAD 为 ${currentHead.slice(0, 12)}；只读展示，不在当前代码上标注。`,
    }
  }
  return {
    state: 'match',
    message: dirty
      ? '报告提交与当前 HEAD 一致，但工作区有未提交改动；行号可能已变化。'
      : '报告提交与当前 HEAD 一致。',
  }
}

/** 行号必须在文档范围内才允许跳转。 */
export function validLine(documentText: string, line: number): boolean {
  if (!Number.isSafeInteger(line) || line < 1) return false
  return line <= documentText.split(/\r\n|\r|\n/).length
}
