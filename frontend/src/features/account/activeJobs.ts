import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { ActiveJob } from '@/components/layout/ActiveJobsIndicator'
import { userExperiments } from '@/features/account/userClient'
import { listUserDatasetBuilds, type DatasetBuildTask } from '@/features/datasets/datasetBuildClient'
import { importIsActive, importPercent, importStage, useDatasetImportJobs } from '@/features/datasets/datasetImportClient'
import type { TrainingExperiment } from '@/features/admin/adminContracts'
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
  const importsInProgress: ActiveJob[] = (imports.data ?? []).filter(importIsActive).map(task => ({
    id: `import:${task.taskId}`,
    kind: 'import',
    label: `导入 · ${task.filename}`,
    detail: task.total == null ? importStage(task) : `${importStage(task)} · ${task.processed}/${task.total}`,
    progress: importPercent(task),
    route: { name: 'my-data', view: 'imports', taskId: task.taskId },
  }))
  return [...importsInProgress, ...(query.data ?? [])]
}
