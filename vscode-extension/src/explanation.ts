import type { AnalysisCommit, CommitAnalysisReport, AnalysisExplanationItem } from './report'

export const FEATURE_LABELS: Record<string, string> = {
  ns: '修改子系统数',
  nd: '修改目录数',
  nf: '修改文件数',
  entropy: '修改分布熵',
  la: '新增行数',
  ld: '删除行数',
  lt: '变更前文件规模',
  fix: '修复关键词',
  ndev: '涉及开发者数',
  age: '最近变更时间',
  nuc: '唯一变更文件数',
  exp: '开发者经验',
  rexp: '近期开发者经验',
  sexp: '子系统经验',
}

export function featureLabel(name: string): string {
  return FEATURE_LABELS[name] ?? name
}

/** 只替换已声明特征名，不把报告文本当作模板或指令。 */
export function localizeExplanationSummary(summary: string): string {
  const names = Object.keys(FEATURE_LABELS).sort((left, right) => right.length - left.length)
  let result = summary.replace(/本次预测风险为/g, '本次提交级预测分数为')
  for (const name of names) {
    result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), FEATURE_LABELS[name])
  }
  return result
}

function contributionLine(item: AnalysisExplanationItem): string {
  const sign = item.delta > 0 ? '+' : ''
  const direction = item.direction === 'increases' ? '推高' : '拉低'
  return `| ${featureLabel(item.feature)} | ${item.value.toFixed(4)} | ${item.baseline.toFixed(4)} | ${sign}${item.delta.toFixed(6)} | ${direction} |`
}

/** 生成纯 Markdown 数据视图；不包含 HTML、链接或可执行指令。 */
export function explanationMarkdown(report: CommitAnalysisReport, commit: AnalysisCommit): string {
  const lines = [
    '# 提交解释',
    '',
    `- 提交 SHA：\`${commit.commitId}\``,
    `- 提交级预测分数：${commit.risk.toFixed(6)}`,
    `- 模型：${report.model.name ?? '未提供'}（${report.model.modelId ?? 'modelId 未提供'}）`,
    `- 方法：${report.model.method}`,
    `- 运行：\`${report.model.runId}\``,
    `- 特征 schema：${report.model.featureSchema}`,
    '',
    '> 提交级预测分数是模型估计，不是已确认缺陷；以下是模型对本次输入的特征敏感度，不是缺陷原因。',
    '',
  ]
  const explanation = commit.explanation
  if (!explanation) {
    lines.push('本次报告没有保存提交解释。', '', '模型分数仍然有效。')
    return lines.join('\n')
  }
  lines.push('## 中文摘要', '', localizeExplanationSummary(explanation.summary), '')
  if (explanation.status !== 'supported' || explanation.items.length === 0) {
    lines.push('## 特征贡献', '', '本次没有可展示的特征归因。', '')
    return lines.join('\n')
  }
  lines.push(
    '## Top 特征贡献（遮挡均值基线，概率分数变化）',
    '',
    '| 特征 | 本次值 | 基线 | 贡献 | 方向 |',
    '| --- | ---: | ---: | ---: | --- |',
    ...explanation.items.map(contributionLine),
  )
  return lines.join('\n')
}
