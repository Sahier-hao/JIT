export interface ThresholdCounts {
  positives: number
  negatives: number
  truePositives: number[]
  falsePositives: number[]
}

export interface EvaluationPoint {
  threshold: number
  alerts: number
  hits: number
  falseAlarms: number
  missed: number
  precision: number | null
  recall: number | null
  f1: number | null
}

export function evaluationPoint(preview: ThresholdCounts, tick: number): EvaluationPoint {
  const hit = preview.truePositives[tick] ?? 0
  const falseAlarm = preview.falsePositives[tick] ?? 0
  const missed = preview.positives - hit
  const alerts = hit + falseAlarm
  const precision = alerts ? hit / alerts : null
  const recall = preview.positives ? hit / preview.positives : null
  const f1 = precision != null && recall != null && precision + recall
    ? 2 * precision * recall / (precision + recall) : null
  return {
    threshold: tick / 100,
    alerts,
    hits: hit,
    falseAlarms: falseAlarm,
    missed,
    precision,
    recall,
    f1,
  }
}

export function evaluationRows(preview: ThresholdCounts): EvaluationPoint[] {
  return preview.truePositives.map((_, tick) => evaluationPoint(preview, tick))
}

