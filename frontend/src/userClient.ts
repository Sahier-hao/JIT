import { useEffect, useState } from 'react'
import { apiRequest } from './apiClient'
import { record, recordList, text, textOrNull, finiteNumber, textList } from './apiContract'
import {
  experimentMethodResult, trainingExperiment, trainingTask,
  type Row, type TrainingExperiment, type TrainingExperimentComparison,
  type TrainingExperimentMethodResult, type TrainingTask,
} from './adminContracts'

export interface UserSession { authenticated: boolean; username: string | null }
export interface UserDataset {
  version: string
  dataset: string
  schema: string
  timeRange: Row
  quality: Row
  file: Row
  source: Row
  labelRule: string | null
  limitations: string[]
  mine: boolean
  shared: boolean
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

function userDataset(raw: unknown): UserDataset {
  const value = record(raw)
  return {
    version: text(value.version), dataset: text(value.dataset), schema: text(value.schema),
    timeRange: record(value.timeRange), quality: record(value.quality), file: record(value.file),
    source: record(value.source), labelRule: textOrNull(value.labelRule),
    limitations: textList(value.limitations), mine: value.mine === true, shared: value.shared === true,
  }
}

export async function userSession(signal?: AbortSignal): Promise<UserSession> {
  const body = record(await apiRequest({ path: '/api/user/session', method: 'GET', signal }))
  return { authenticated: body.authenticated === true, username: textOrNull(body.username) }
}

export async function userRegister(username: string, password: string): Promise<UserSession> {
  const body = record(await apiRequest({ path: '/api/user/register', method: 'POST', body: { username, password } }))
  return { authenticated: body.authenticated === true, username: textOrNull(body.username) }
}

export async function userLogin(username: string, password: string): Promise<UserSession> {
  const body = record(await apiRequest({ path: '/api/user/login', method: 'POST', body: { username, password } }))
  return { authenticated: body.authenticated === true, username: textOrNull(body.username) }
}

export async function userLogout(): Promise<void> {
  await apiRequest({ path: '/api/user/logout', method: 'POST' })
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

export function exportDataset(version: string): void {
  window.location.href = `/api/v1/user/datasets/${encodeURIComponent(version)}/export`
}

export async function splitPreview(version: string, preset: string, signal?: AbortSignal) {
  const body = record(await apiRequest({ path: `/api/v1/user/datasets/${encodeURIComponent(version)}/split-preview?preset=${encodeURIComponent(preset)}`, method: 'GET', signal }))
  return body
}

export async function previewCuration(version: string, recipe: unknown) {
  return record(await apiRequest({ path: `/api/v1/user/datasets/${encodeURIComponent(version)}/curation/preview`, method: 'POST', body: { recipe } }))
}

export async function deriveCuration(version: string, recipe: unknown) {
  return record(await apiRequest({ path: `/api/v1/user/datasets/${encodeURIComponent(version)}/curation/derive`, method: 'POST', body: { recipe } }))
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
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    userSession(controller.signal).then(value => { if (!controller.signal.aborted) setSession(value) })
      .catch(() => { if (!controller.signal.aborted) setSession({ authenticated: false, username: null }) })
    return () => controller.abort()
  }, [revision])
  return { session, setSession, reload: () => setRevision(value => value + 1) }
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
}

export async function userProfile(signal?: AbortSignal): Promise<UserProfile> {
  const body = record(await apiRequest({ path: '/api/v1/user/profile', method: 'GET', signal }))
  return {
    username: text(body.username), displayName: textOrNull(body.displayName),
    createdAt: finiteNumber(body.createdAt), datasetCount: finiteNumber(body.datasetCount),
    modelCount: finiteNumber(body.modelCount), experimentCount: finiteNumber(body.experimentCount),
  }
}

export async function updateUserProfile(displayName: string): Promise<{ displayName: string | null }> {
  const body = record(await apiRequest({ path: '/api/v1/user/profile', method: 'PATCH', body: { displayName } }))
  return { displayName: textOrNull(body.displayName) }
}

export async function changeUserPassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiRequest({ path: '/api/user/password', method: 'POST', body: { currentPassword, newPassword } })
}
