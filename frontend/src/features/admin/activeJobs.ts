import { useQuery } from '@tanstack/react-query'
import type { ActiveJob } from '@/components/layout/ActiveJobsIndicator'
import { fetchTrainingTasks, type TrainingTask } from '@/features/admin/adminContracts'
import { queryKeys } from '@/lib/queryKeys'

const ACTIVE = new Set(['queued', 'running'])
const STAGE_LABELS: Record<string, string> = {
  queued: '排队中', running: '训练中',
}

function taskJob(task: TrainingTask): ActiveJob {
  return {
    id: `training:${task.taskId}`,
    kind: 'training',
    label: `训练 · ${task.method}`,
    detail: `${STAGE_LABELS[task.stage] ?? (task.status === 'queued' ? '排队中' : '训练中')}${task.queuePosition ? ` · 队列 ${task.queuePosition}` : ''} · ${task.datasetVersion}`,
    route: { name: 'admin', view: 'training', resourceId: task.taskId },
  }
}

/** 管理员活跃训练任务；关闭时停止轮询，后台标签页暂停。 */
export function useActiveAdminJobs(enabled: boolean): ActiveJob[] {
  const query = useQuery({
    queryKey: queryKeys.activeAdminJobs,
    enabled,
    queryFn: async ({ signal }) => {
      const page = await fetchTrainingTasks(50, 0, signal)
      return page.tasks.filter(task => ACTIVE.has(task.status)).map(taskJob)
    },
    staleTime: 6000,
    refetchInterval: query => query.state.data?.length ? 6000 : 60000,
    retry: false,
  })
  return enabled ? query.data ?? [] : []
}
