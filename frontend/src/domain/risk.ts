/**
 * 风险分数的唯一解释口径（CRR-03 / IP-06）：
 * 只接受 0–1 的有限数；两位小数显示；分档只用于排序与配色，不当作缺陷结论。
 */

/** 风险分档与三色一一对应：高 ≥25%、中 10–25%、低 <10%（repo-distribution-v1）。 */
export type RiskTone = 'high' | 'medium' | 'low' | 'unknown'

export function validRisk(risk: unknown): risk is number {
  return typeof risk === 'number' && Number.isFinite(risk) && risk >= 0 && risk <= 1
}

/** 旧数据里 risk 是 unknown，界面只接受 0–1 的有限数；其余按"未知"处理。 */
export function safeRisk(value: unknown): number | null {
  return validRisk(value) ? value : null
}

export function riskLabel(risk: unknown): string {
  if (risk == null) return '暂无预测'
  return validRisk(risk) ? risk.toFixed(2) : '风险数据无效'
}

/** 列表里的紧凑分数：缺失值显示破折号，而不是"暂无预测"这类长文案。 */
export function scoreText(risk: number | null | undefined): string {
  return risk === null || risk === undefined || !Number.isFinite(risk) ? '—' : risk.toFixed(2)
}

export function riskTone(risk: number | null | undefined): RiskTone {
  if (risk === null || risk === undefined || !Number.isFinite(risk)) return 'unknown'
  if (risk >= 0.25) return 'high'
  if (risk >= 0.1) return 'medium'
  return 'low'
}
