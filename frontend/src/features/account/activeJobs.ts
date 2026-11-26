import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { ActiveJob } from '@/components/layout/ActiveJobsIndicator'
import { ApiError } from '@/lib/apiContract'
import { fetchRepositorySync } from '@/lib/apiClient'
import { userExperiments } from '@/features/account/userClient'
import { listUserDatasetBuilds, type DatasetBuildTask } from '@/features/datasets/datasetBuildClient'
import { importIsActive, importPercent, importStage, useDatasetImportJobs } from '@/features/datasets/datasetImportClient'
import type { TrainingExperiment } from '@/features/admin/adminContracts'
import { getProjectPRBatch, type PRBatch } from '@/features/projects/projectActivityClient'
import { forgetAnalysisJobs, trackedAnalysisJobs, type TrackedAnalysisJob } from '@/features/projects/analysisJobs'
import { syncProgressValue } from '@/features/projects/syncProgress'
import { ACTIVE_STATUSES, STATUS_LABELS, type SyncView } from '@/features/projects/repositoryContract'
import { trainingMethodName, trainingPhase } from '@/features/training/trainingPresentation'
import { queryKeys } from '@/lib/queryKeys'

const BUILD_STAGE_LABELS: Record<string, string> = {
  queued: '排队中', collecting: '采集中', registering: '登记中',
}

function repositoryLabel(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '') || url
  } catch {
    return url
  }
}

function buildJob(task: DatasetBuildTask): ActiveJob {
  const detail = BUILD_STAGE_LABELS[task.stage] ?? (task.status === 'queued' ? '排队中' : '采集中')
  return {
    id: `collection:${task.taskId}`,
    kind: 'collection',
    label: `采集 · ${repositoryLabel(task.repositoryUrl)}`,
    detail: task.queuePosition ? `${detail} · 队列 ${task.queuePosition}` : detail,
    route: { name: 'my-data', view: 'builds', taskId: task.taskId },
  }
}

function trainingJob(experiment: TrainingExperiment): ActiveJob {
  const runningTask = experiment.tasks.find(task => task.status === 'running')
  const queuedTask = experiment.tasks.find(task => task.status === 'queued')
  const running = experiment.status === 'running' || Boolean(runningTask)
  const phase = runningTask && trainingPhase(runningTask) === 2 ? '评估与保存' : running ? '训练中' : '训练排队中'
  const task = runningTask ?? queuedTask
  const history = runningTask?.trainingHistory
  const epoch = history?.entries.at(-1)?.epoch
  const detail = [phase, task ? trainingMethodName(task.method) : null,
    history && epoch != null && history.epochs > 0 ? `${epoch}/${history.epochs} 轮` : queuedTask?.queuePosition && !runningTask ? `队列第 ${queuedTask.queuePosition} 位` : null]
    .filter(Boolean).join(' · ')
  return {
    id: `training:${experiment.experimentId}`,
    kind: 'training',
    statusLabel: phase,
    label: `训练 · ${experiment.datasetVersion}`,
    detail,
    progress: history && epoch != null && history.epochs > 0 ? Math.min(100, 100 * epoch / history.epochs) : null,
    route: { name: 'my-training', experimentId: experiment.experimentId },
  }
}

function syncJob(sync: SyncView, tracked: TrackedAnalysisJob): ActiveJob | null {
  if (!(ACTIVE_STATUSES as readonly string[]).includes(sync.status)) return null
  const currentStage = STATUS_LABELS[sync.status === 'queued' ? 'queued' : sync.stage]
  const queue = sync.status === 'queued' && sync.queuePosition ? ` · 队列第 ${sync.queuePosition} 位` : ''
  return {
    id: `analysis:${sync.syncId}`,
    kind: 'analysis',
    statusLabel: currentStage,
    label: tracked.label,
    detail: `${currentStage}${queue}`,
    progress: syncProgressValue(sync.status, sync.stage, sync.requestedStrategy === 'generic-model'),
    route: tracked.route,
  }
}

function batchIsActive(batch: PRBatch): boolean {
  return batch.status === 'discovering' || batch.status === 'running'
    || batch.counts.queued > 0 || batch.counts.running > 0
}

function batchJob(batch: PRBatch, tracked: TrackedAnalysisJob): ActiveJob | null {
  if (!batchIsActive(batch)) return null
  const finished = batch.counts.completed + batch.counts.failed
    + batch.counts.cancelled + batch.counts.interrupted
  const running = batch.counts.queued + batch.counts.running
  const phase = batch.status === 'discovering' ? '发现开放 PR'
    : batch.submission.pending > 0 ? '提交分析任务'
      : running > 0 ? '分析中' : '等待完成'
  return {
    id: `analysis-batch:${batch.batchId}`,
    kind: 'analysis',
    statusLabel: phase,
    label: tracked.label,
    detail: `${phase} · 已处理 ${finished}/${batch.discovered}${running ? ` · 运行 ${running}` : ''}`,
    progress: batch.discovered ? Math.round(100 * finished / batch.discovered) : null,
    route: tracked.route,
  }
}

/** 服务端确认入队后，直接用返回的实验刷新任务入口。 */
export function publishTrainingExperiment(client: QueryClient, account: string | null, experiment: TrainingExperiment) {
  client.setQueryData(queryKeys.userTrainingExperiment(account, experiment.experimentId), experiment)
  if (!account || !hasActiveTraining(experiment)) return
  const queryKey = queryKeys.activeUserJobs(account)
  // 早于提交发出的列表请求不能覆盖刚确认的任务。
  void client.cancelQueries({ queryKey, exact: true })
  const job = trainingJob(experiment)
  client.setQueryData<ActiveJob[]>(queryKey, jobs => [job, ...(jobs ?? []).filter(item => item.id !== job.id)])
}

function hasActiveTraining(experiment: TrainingExperiment) {
  return experiment.status === 'queued' || experiment.status === 'running'
    || experiment.tasks.some(task => task.status === 'queued' || task.status === 'running')
}

/** 活跃任务每 6 秒轮询；后台标签页暂停，卸载自动取消。 */
export function useActiveUserJobs(account: string | null): ActiveJob[] {
  const imports = useDatasetImportJobs(account)
  const query = useQuery({
    queryKey: queryKeys.activeUserJobs(account),
    enabled: Boolean(account),
    queryFn: async ({ signal }) => {
      const [builds, experiments] = await Promise.all([
        listUserDatasetBuilds(signal).catch(() => [] as DatasetBuildTask[]),
        userExperiments(signal).catch(() => [] as TrainingExperiment[]),
      ])
      return [
        ...builds.filter(task => task.status === 'queued' || task.status === 'running').map(buildJob),
        ...experiments
          .filter(hasActiveTraining)
          .map(trainingJob),
      ]
    },
    refetchInterval: 6000,
    retry: false,
  })
  const analyses = useQuery({
    queryKey: [...queryKeys.activeUserJobs(account), 'analysis'],
    enabled: Boolean(account),
    queryFn: async ({ signal }) => {
      const tracked = trackedAnalysisJobs()
      if (!tracked.length) return []
      const completed: string[] = []
      const jobs = await Promise.all(tracked.map(async item => {
        try {
          if (item.batchId) {
            const batch = await getProjectPRBatch(item.repositoryId, item.batchId, signal)
            const job = batchJob(batch, item)
            if (!job) completed.push(item.id)
            return job
          }
          if (item.syncId) {
            const sync = await fetchRepositorySync(item.syncId, signal)
            const job = syncJob(sync, item)
            if (!job) completed.push(item.id)
            return job
          }
          completed.push(item.id)
          return null
        } catch (failure) {
          if (signal.aborted) return null
          if (failure instanceof ApiError && failure.status === 404) {
            completed.push(item.id)
            return null
          }
          return {
            id: `analysis:${item.id}`,
            kind: 'analysis' as const,
            statusLabel: '进度读取失败',
            label: item.label,
            detail: '点击返回任务页面查看最新状态',
            progress: null,
            route: item.route,
          }
        }
      }))
      if (completed.length) forgetAnalysisJobs(completed)
      return jobs.filter((job): job is ActiveJob => job !== null)
    },
    refetchInterval: query => (query.state.data?.length ?? 0) > 0 ? 3000 : false,
    retry: false,
  })
  const importsInProgress: ActiveJob[] = (imports.data ?? []).filter(importIsActive).map(task => ({
    id: `import:${task.taskId}`,
    kind: 'import',
    label: `导入 · ${task.filename}`,
    detail: task.total == null ? importStage(task) : `${importStage(task)} · ${task.processed}/${task.total}`,
    progress: importPercent(task),
    route: { name: 'my-data', view: 'imports', taskId: task.taskId },
  }))
  return [...importsInProgress, ...(analyses.data ?? []), ...(query.data ?? [])]
}
