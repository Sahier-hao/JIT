import { apiRequest } from './apiClient'
import { finiteNumber, hexDigest, record, recordList, text, textList, textOrNull } from './apiContract'

export interface LineResearchMetadata {
  languages: string[]
  training: { repos: string[]; commits: number | null; samples: number | null; positives: number | null }
  holdout: { repo: string | null; commits: number | null; samples: number | null; positives: number | null }
  metrics: { rocAuc: number | null; prAuc: number | null; brier: number | null; randomPrAuc: number | null }
  localization: { proxy: boolean; top5: number | null; recallAt20PercentLines: number | null }
  positionFeatures: boolean
  textFeatures: boolean
  artifactSha256: string
  generatedAt: string | null
  limitations: string[]
  caveats: string[]
  limits: { maxLines: number; maxCharacters: number }
}

export interface LineScore {
  rank: number
  line: number
  text: string
  score: number
}

export interface LineScoreResult {
  language: string
  lines: LineScore[]
  count: number
  skippedBlank: number
  caveats: string[]
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function group(raw: unknown): Record<string, unknown> {
  return raw == null ? {} : record(raw)
}

export async function lineResearchMetadata(signal?: AbortSignal): Promise<LineResearchMetadata> {
  const body = record(await apiRequest({ path: '/api/v1/research/line-model', method: 'GET', signal }))
  const training = group(body.training)
  const holdout = group(body.holdout)
  const metrics = group(body.metrics)
  const localization = group(body.localization)
  const model = group(body.model)
  const limits = group(body.limits)
  return {
    languages: textList(body.languages),
    training: {
      repos: textList(training.repos), commits: numberOrNull(training.commits),
      samples: numberOrNull(training.samples), positives: numberOrNull(training.positives),
    },
    holdout: {
      repo: textOrNull(holdout.repo), commits: numberOrNull(holdout.commits),
      samples: numberOrNull(holdout.samples), positives: numberOrNull(holdout.positives),
    },
    metrics: {
      rocAuc: numberOrNull(metrics.rocAuc), prAuc: numberOrNull(metrics.prAuc),
      brier: numberOrNull(metrics.brier), randomPrAuc: numberOrNull(metrics.randomPrAuc),
    },
    localization: {
      proxy: localization.proxy === true,
      top5: numberOrNull(localization.top5),
      recallAt20PercentLines: numberOrNull(localization.recallAt20PercentLines),
    },
    positionFeatures: model.positionFeatures !== false,
    textFeatures: model.textFeatures !== false,
    artifactSha256: hexDigest(body.artifactSha256),
    generatedAt: textOrNull(body.generatedAt),
    limitations: textList(body.limitations),
    caveats: textList(body.caveats),
    limits: {
      maxLines: finiteNumber(limits.maxLines), maxCharacters: finiteNumber(limits.maxCharacters),
    },
  }
}

export async function scoreLineResearch(code: string, language: string): Promise<LineScoreResult> {
  const body = record(await apiRequest({
    path: '/api/v1/research/line-model/score', method: 'POST', body: { code, language },
  }))
  return {
    language: text(body.language),
    lines: recordList(body.lines).map(raw => {
      const value = record(raw)
      return {
        rank: finiteNumber(value.rank), line: finiteNumber(value.line),
        text: typeof value.text === 'string' ? value.text : '', score: finiteNumber(value.score),
      }
    }),
    count: finiteNumber(body.count),
    skippedBlank: finiteNumber(body.skippedBlank),
    caveats: textList(body.caveats),
  }
}
