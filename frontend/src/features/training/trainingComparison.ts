import type { TrainingExperimentComparison } from '@/features/admin/adminContracts'

export function comparisonExportText(comparison: TrainingExperimentComparison): string {
  return JSON.stringify(comparison, null, 2)
}
