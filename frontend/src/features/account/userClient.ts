import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { record, recordList, text, textOrNull, finiteNumber, textList } from '@/lib/apiContract'
import {
  experimentMethodResult, trainingExperiment, trainingTask,
  type Row, type TrainingExperiment, type TrainingExperimentComparison,
  type TrainingExperimentMethodResult, type TrainingTask,
} from '@/features/admin/adminContracts'

export interface UserSession {
  authenticated: boolean
  username: string | null
  status: 'authenticated' | 'anonymous' | 'failed'
}
export const SESSION_EPOCH_KEY = 'jit:user-session-epoch'
function markSessionChanged() {
  try { localStorage.setItem(SESSION_EPOCH_KEY, String(Date.now())) } catch { /* 存储不可用时仍由服务端会话决定 */ }
}
function activeSession(username: string | null, authenticated: boolean): UserSession {
  return { authenticated: authenticated && Boolean(username), username,
           status: authenticated && username ? 'authenticated' : 'anonymous' }
}
export interface UserDataset {
  version: string
  dataset: string
  schema: string
  timeRange: Row
  quality: Row
  file: Row
  source: Row
  fieldCount: number | null
  fieldNames: string[]
  featureFields: string[]
  labelRule: string | null
  labelMaturity: Row | null
  labelObservations: Row | null
  limitations: string[]
  curation: Row | null
  integrity: Row
  mine: boolean
  shared: boolean
  usage: string
  timestamps: {
    registeredAt: string | null
    importedAt: string | null
    ownedAt: string | null
    builtAt: string | null
  }
}
export interface UserModel {
  modelId: string
  name: string
  method: string
  featureSchemaVersion: string
  state: string
  enabled: boolean
  parameters: Row | null
  datasetVersion: string | null
}

export interface UserSplitPreview {
  available: boolean
  reason: { code: string; message: string } | null
  eligibleRecords: number
  admission: Row | null
  partitions: Record<'train' | 'validation' | 'test', {
    records: number
    positives: number
    start: string
    end: string
  }> | null
}

export interface UserCurationPreview {
  sourceVersion: string
  recipeSha256: string
  stats: {
    rawRows: number
    includedRows: number
    excludedRows: number
    positiveLabels: number
    timeRange: Row | null
    excluded: Row
    sampleExcluded: Row[]
  }
}

export interface UserCurationDerived {
  version: string
  preview: UserCurationPreview
}

function userDataset(raw: unknown): UserDataset {
  const value = record(raw)
  const timestamps = value.timestamps == null ? null : record(value.timestamps)
  return {
    version: text(value.version), dataset: text(value.dataset), schema: text(value.schema),
    timeRange: record(value.timeRange), quality: record(value.quality), file: record(value.file),
    source: record(value.source),
    fieldCount: typeof value.fieldCount === 'number' && Number.isInteger(value.fieldCount) && value.fieldCount >= 0
      ? value.fieldCount : null,
    fieldNames: value.fieldNames == null ? [] : textList(value.fieldNames),
    featureFields: value.featureFields == null ? [] : textList(value.featureFields),
    labelRule: textOrNull(value.labelRule),
    labelMaturity: value.labelMaturity == null ? null : record(value.labelMaturity),
    labelObservations: value.labelObservations == null ? null : record(value.labelObservations),
    limitations: textList(value.limitations), mine: value.mine === true, shared: value.shared === true,
    curation: value.curation == null ? null : record(value.curation),
    integrity: value.integrity == null ? {} : record(value.integrity),
    usage: textOrNull(value.usage) ?? 'branch',
    timestamps: {
      registeredAt: timestamps ? textOrNull(timestamps.registeredAt) : null,
      importedAt: timestamps ? textOrNull(timestamps.importedAt) : null,
      ownedAt: timestamps ? textOrNull(timestamps.ownedAt) : null,
      builtAt: timestamps ? textOrNull(timestamps.builtAt) : null,
    },
  }
}

export async function userSession(signal?: AbortSignal): Promise<UserSession> {
  const body = record(await apiRequest({ path: '/api/user/session', method: 'GET', signal }))
  return activeSession(textOrNull(body.username), body.authenticated === true)
}

export async function userRegister(username: string, password: string): Promise<UserSession> {
  const body = record(await apiRequest({ path: '/api/user/register', method: 'POST', body: { username, password } }))
  markSessionChanged()
  return activeSession(textOrNull(body.username), body.authenticated === true)
}

export async function userLogin(username: string, password: string): Promise<UserSession> {
  const body = record(await apiRequest({ path: '/api/user/login', method: 'POST', body: { username, password } }))
  markSessionChanged()
  return activeSession(textOrNull(body.username), body.authenticated === true)
}

export async function userLogout(): Promise<void> {
  await apiRequest({ path: '/api/user/logout', method: 'POST' })
  markSessionChanged()
}

export async function userDatasets(scope: 'mine' | 'usable' = 'usable', signal?: AbortSignal): Promise<UserDataset[]> {
  const body = record(await apiRequest({ path: `/api/v1/user/datasets?scope=${scope}`, method: 'GET', signal }))
  return recordList(body.datasets).map(userDataset)
}

export async function userModels(signal?: AbortSignal): Promise<UserModel[]> {
  const body = record(await apiRequest({ path: '/api/v1/user/models', method: 'GET', signal }))
  return recordList(body.models).map(raw => {
    const value = record(raw)
    return {
      modelId: text(value.modelId), name: text(value.name), method: text(value.method),
      featureSchemaVersion: text(value.featureSchemaVersion), state: text(value.state),
      enabled: value.enabled === true, parameters: value.parameters == null ? null : record(value.parameters),
      datasetVersion: textOrNull(value.datasetVersion),
    }
  })
}

export async function deleteUserDataset(version: string) {
  return record(await apiRequest({ path: `/api/v1/user/datasets/${encodeURIComponent(version)}`, method: 'DELETE', expectEmpty: false }))
}

export async function importUserDataset(file: Blob, options: {
  filename: string
  dataset?: string
  schema: string
}): Promise<UserDataset> {
  const query = new URLSearchParams({ filename: options.filename, schema: options.schema })
  if (options.dataset?.trim()) query.set('dataset', options.dataset.trim())
  return userDataset(await apiRequest({
    path: `/api/v1/user/datasets/import?${query}`,
    method: 'POST',
    rawBody: file,
    contentType: 'text/csv',
  }))
}

export function exportDataset(version: string): void {
  window.location.href = `/api/v1/user/datasets/${encodeURIComponent(version)}/export`
}

export async function splitPreview(version: string, preset: string, signal?: AbortSignal): Promise<UserSplitPreview> {
  const body = record(await apiRequest({ path: `/api/v1/user/datasets/${encodeURIComponent(version)}/split-preview?preset=${encodeURIComponent(preset)}`, method: 'GET', signal }))
  const reason = body.reason == null ? null : record(body.reason)
  const parts = body.partitions == null ? null : record(body.partitions)
  const partition = (raw: unknown) => {
    const value = record(raw)
    return {
      records: finiteNumber(value.records),
      positives: finiteNumber(value.positives),
      start: textOrNull(value.start) ?? '',
      end: textOrNull(value.end) ?? '',
    }
  }
  return {
    available: body.available === true,
    reason: reason ? { code: text(reason.code), message: text(reason.message) } : null,
    eligibleRecords: finiteNumber(body.eligibleRecords ?? body.datasetRecords),
    admission: body.admission == null ? null : record(body.admission),
    partitions: parts == null ? null : {
      train: partition(parts.train),
      validation: partition(parts.validation),
      test: partition(parts.test),
    },
  }
}

function curationPreview(raw: unknown): UserCurationPreview {
  const value = record(raw)
  const stats = record(value.stats)
  return {
    sourceVersion: text(value.sourceVersion),
    recipeSha256: text(value.recipeSha256),
    stats: {
      rawRows: finiteNumber(stats.rawRows),
      includedRows: finiteNumber(stats.includedRows),
      excludedRows: finiteNumber(stats.excludedRows),
      positiveLabels: finiteNumber(stats.positiveLabels),
      timeRange: stats.timeRange == null ? null : record(stats.timeRange),
      excluded: stats.excluded == null ? {} : record(stats.excluded),
      sampleExcluded: stats.sampleExcluded == null ? [] : recordList(stats.sampleExcluded),
    },
  }
}

export async function previewCuration(version: string, recipe: unknown) {
  return curationPreview(await apiRequest({ path: `/api/v1/user/datasets/${encodeURIComponent(version)}/curation/preview`, method: 'POST', body: { recipe } }))
}

export async function deriveCuration(version: string, recipe: unknown): Promise<UserCurationDerived> {
  const value = record(await apiRequest({ path: `/api/v1/user/datasets/${encodeURIComponent(version)}/curation/derive`, method: 'POST', body: { recipe } }))
  return { version: text(record(value.dataset).version), preview: curationPreview(value.preview) }
}

export async function createUserExperiment(options: {
  datasetVersion: string
  methods: { method: string; params?: Row }[]
  splitPreset?: string
  metricSet?: string
}): Promise<TrainingExperiment> {
  return trainingExperiment(await apiRequest({
    path: '/api/v1/user/training-experiments', method: 'POST',
    body: { datasetVersion: options.datasetVersion, methods: options.methods,
      splitPreset: options.splitPreset ?? 'temporal-70-15-15', metricSet: options.metricSet ?? 'metric-set-v2' },
  }))
}

export async function userExperiments(signal?: AbortSignal): Promise<TrainingExperiment[]> {
  const body = record(await apiRequest({ path: '/api/v1/user/training-experiments', method: 'GET', signal }))
  return recordList(body.experiments).map(trainingExperiment)
}

export async function userExperiment(experimentId: string, signal?: AbortSignal): Promise<TrainingExperiment> {
  return trainingExperiment(await apiRequest({
    path: `/api/v1/user/training-experiments/${encodeURIComponent(experimentId)}`, method: 'GET', signal,
  }))
}

export async function userComparison(experimentId: string, signal?: AbortSignal): Promise<TrainingExperimentComparison> {
  const body = record(await apiRequest({
    path: `/api/v1/user/training-experiments/${encodeURIComponent(experimentId)}/comparison`, method: 'GET', signal,
  }))
  return {
    format: text(body.format), experimentId: text(body.experimentId), datasetVersion: text(body.datasetVersion),
    manifestSha256: text(body.manifestSha256), metricSet: text(body.metricSet),
    splitPreset: text(body.splitPreset), classPolicy: body.classPolicy == null ? null : record(body.classPolicy),
    seed: finiteNumber(body.seed), status: text(body.status) as TrainingExperimentComparison['status'], comparable: body.comparable === true,
    notes: textList(body.notes),
    methods: recordList(body.methods).map(experimentMethodResult) as TrainingExperimentMethodResult[],
  }
}

export async function registerUserExperiment(experimentId: string) {
  return record(await apiRequest({
    path: `/api/v1/user/training-experiments/${encodeURIComponent(experimentId)}/register`,
    method: 'POST',
  }))
}

export async function cancelUserTask(taskId: string): Promise<TrainingTask> {
  return trainingTask(await apiRequest({ path: `/api/v1/user/training-tasks/${encodeURIComponent(taskId)}/cancel`, method: 'POST' }))
}

export async function retryUserTask(taskId: string): Promise<TrainingTask> {
  return trainingTask(await apiRequest({ path: `/api/v1/user/training-tasks/${encodeURIComponent(taskId)}/retry`, method: 'POST', body: {} }))
}

export function useUserSession() {
  const [session, setSession] = useState<UserSession | null>(null)
  const [generation, setGeneration] = useState(0)
  const [verifying, setVerifying] = useState(true)
  const verify = useCallback(() => {
    setVerifying(true)
    userSession()
      .then(value => setSession(value))
      .catch(() => setSession({ authenticated: false, username: null, status: 'failed' }))
      .finally(() => { setVerifying(false); setGeneration(value => value + 1) })
  }, [])
  useEffect(() => {
    verify()
    const bump = () => verify()
    const storage = (event: StorageEvent) => {
      if (event.key === SESSION_EPOCH_KEY || event.key === null || (event.key ?? '').startsWith('jit:pr-review:')) bump()
    }
    const focus = () => { if (document.visibilityState !== 'hidden') verify() }
    window.addEventListener(USER_CHANGED, bump)
    window.addEventListener('storage', storage)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => {
      window.removeEventListener(USER_CHANGED, bump)
      window.removeEventListener('storage', storage)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [verify])
  return { session, setSession, reload: verify, generation, verifying }
}


export const USER_CHANGED = 'jit:user-changed'
export function notifyUserChanged() { window.dispatchEvent(new Event(USER_CHANGED)) }
export function useUserRevision() {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const bump = () => setRevision(value => value + 1)
    window.addEventListener(USER_CHANGED, bump)
    return () => window.removeEventListener(USER_CHANGED, bump)
  }, [])
  return revision
}

export interface UserProfile {
  username: string
  displayName: string | null
  createdAt: number
  datasetCount: number
  modelCount: number
  experimentCount: number
  github: { connected: boolean; login: string | null }
}

export async function userProfile(signal?: AbortSignal): Promise<UserProfile> {
  const body = record(await apiRequest({ path: '/api/v1/user/profile', method: 'GET', signal }))
  const github = body.github == null ? null : record(body.github)
  return {
    username: text(body.username), displayName: textOrNull(body.displayName),
    createdAt: finiteNumber(body.createdAt), datasetCount: finiteNumber(body.datasetCount),
    modelCount: finiteNumber(body.modelCount), experimentCount: finiteNumber(body.experimentCount),
    github: {
      connected: github?.connected === true,
      login: github ? textOrNull(github.login) : null,
    },
  }
}

export async function linkUserGitHub(): Promise<{ connected: boolean; login: string | null }> {
  const body = record(await apiRequest({ path: '/api/v1/user/github/link', method: 'POST' }))
  return { connected: body.connected === true, login: textOrNull(body.login) }
}

export async function updateUserProfile(displayName: string): Promise<{ displayName: string | null }> {
  const body = record(await apiRequest({ path: '/api/v1/user/profile', method: 'PATCH', body: { displayName } }))
  return { displayName: textOrNull(body.displayName) }
}

export async function changeUserPassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiRequest({ path: '/api/user/password', method: 'POST', body: { currentPassword, newPassword } })
}
