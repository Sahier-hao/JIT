export interface AnalyzeCommandOptions {
  backend: string
  python: string
  pythonArgs?: string[]
  repo: string
  base: string
  head: string
  modelId: string
  database: string
  artifactRoot: string
  output: string
}

function checked(value: string, label: string): string {
  if (!value.trim() || /[\r\n]/.test(value)) throw new Error(`${label}不能为空或包含换行`)
  return value.trim()
}

function quoted(value: string): string {
  return `"${checked(value, '参数').replace(/"/g, '\\"')}"`
}

const FLAGS = new Set(['-m', '--repo', '--base', '--head', '--model-id', '--database',
  '--artifact-root', '--output'])

/** 直接交给 execFile 的参数列表；与复制命令共用同一套校验。 */
export function buildAnalyzeArgs(options: AnalyzeCommandOptions): string[] {
  return [
    '-m', 'jit_baseline.cli', 'pr-check-analyze',
    '--repo', checked(options.repo, '仓库路径'),
    '--base', checked(options.base, '基准提交'),
    '--head', checked(options.head, '目标提交'),
    '--model-id', checked(options.modelId, '模型 ID'),
    '--database', checked(options.database, '目录库'),
    '--artifact-root', checked(options.artifactRoot, '模型产物根目录'),
    '--output', checked(options.output, '报告输出'),
  ]
}

/** Build a copyable command; the extension never executes it. */
export function buildAnalyzeCommand(options: AnalyzeCommandOptions): string {
  const args = buildAnalyzeArgs(options)
  return `cd ${quoted(options.backend)} && ${quoted(options.python)} ${args
    .map(arg => (FLAGS.has(arg) ? arg : quoted(arg))).join(' ')}`
}
