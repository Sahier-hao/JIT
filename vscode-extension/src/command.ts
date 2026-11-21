export interface AnalyzeCommandOptions {
  backend: string
  python: string
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

/** Build a copyable command; the extension never executes it. */
export function buildAnalyzeCommand(options: AnalyzeCommandOptions): string {
  const args = [
    quoted(options.python), '-m', 'jit_baseline.cli', 'pr-check-analyze',
    '--repo', quoted(options.repo),
    '--base', quoted(options.base),
    '--head', quoted(options.head),
    '--model-id', quoted(options.modelId),
    '--database', quoted(options.database),
    '--artifact-root', quoted(options.artifactRoot),
    '--output', quoted(options.output),
  ]
  return `cd ${quoted(options.backend)} && ${args.join(' ')}`
}
