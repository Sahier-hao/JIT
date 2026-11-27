import type { ThresholdPreview } from '@/features/predictions/predictionClient'

export interface ThresholdMetrics {
  flagged: number
  miss: number
  precision: number | null
  recall: number | null
  f1: number | null
  confusion: { tp: number; fp: number; tn: number; fn: number }
}

export function thresholdMetrics(
  preview: ThresholdPreview,
  tick: number,
): ThresholdMetrics {
  const index = Math.max(0, Math.min(100, Math.round(tick)))
  const tp = preview.truePositives[index]
  const fp = preview.falsePositives[index]
  const fn = preview.positives - tp
  const tn = preview.negatives - fp
  const precision = tp + fp ? tp / (tp + fp) : null
  const recall = preview.positives ? tp / preview.positives : null
  const f1 = precision !== null && recall !== null && precision + recall
    ? 2 * precision * recall / (precision + recall)
    : null
  return {
    flagged: tp + fp,
    miss: fn,
    precision,
    recall,
    f1,
    confusion: { tp, fp, tn, fn },
  }
}

export function metricCurve(preview: ThresholdPreview, metric: 'precision' | 'recall' | 'f1'): number[] {
  return preview.thresholds.map((_value, index) => {
    const current = thresholdMetrics(preview, index)
    return current[metric] ?? 0
  })
}
