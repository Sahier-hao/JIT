import { useQuery } from '@tanstack/react-query'
import type { ActiveJob } from '@/components/layout/ActiveJobsIndicator'
import { userExperiments } from '@/features/account/userClient'
import { listUserDatasetBuilds, type DatasetBuildTask } from '@/features/datasets/datasetBuildClient'
import { importIsActive, importPercent, importStage, useDatasetImportJobs } from '@/features/datasets/datasetImportClient'
import type { TrainingExperiment } from '@/features/admin/adminContracts'
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
  const running = experiment.status === 'running' || experiment.tasks.some(task => task.status === 'running')
  return {
    id: `training:${experiment.experimentId}`,
    kind: 'training',
    label: `训练 · ${experiment.datasetVersion}`,
    detail: `${running ? '训练中' : '排队中'} · ${experiment.tasks.length} 个方法`,
    route: { name: 'my-training', experimentId: experiment.experimentId },
  }
}

/** 活跃任务每 6 秒轮询；后台标签页暂停，卸载自动取消。 */
export function useActiveUserJobs(account: string | null): ActiveJob[] {
  const imports = useDatasetImportJobs(account)
  const query = useQuery({
    queryKey: queryKeys.activeUserJobs,
    queryFn: async ({ signal }) => {
      const [builds, experiments] = await Promise.all([
        listUserDatasetBuilds(signal).catch(() => [] as DatasetBuildTask[]),
        userExperiments(signal).catch(() => [] as TrainingExperiment[]),
      ])
      return [
        ...builds.filter(task => task.status === 'queued' || task.status === 'running').map(buildJob),
        ...experiments
          .filter(experiment => experiment.status === 'queued' || experiment.status === 'running'
            || experiment.tasks.some(task => task.status === 'queued' || task.status === 'running'))
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
