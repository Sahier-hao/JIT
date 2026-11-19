import type { ModelCard as GeneratedModelCard } from '@/lib/api-generated/types.gen'
import type { ModelCard } from '@/features/models/modelCardClient'

/**
 * Compile-time alignment check: every field the handwritten model card exposes
 * must remain assignable from the generated public contract. If a field is
 * renamed or its type changes, `npm run typecheck` fails here first.
 */
type ScalarKeys =
  | 'available' | 'reason' | 'modelId' | 'name' | 'method' | 'featureSchemaVersion'
  | 'runId' | 'artifactRunId' | 'modelSha256' | 'datasetVersion' | 'datasetSha256'
  | 'metricSet' | 'threshold' | 'splitRule' | 'limitations'
type CardFromContract = Pick<GeneratedModelCard, ScalarKeys>
type _Aligned = ModelCard extends CardFromContract ? true : never
const _aligned: _Aligned = true

export { _aligned }
