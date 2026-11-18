import { useEffect, useState } from 'react'
import type { ActiveJob } from '@/components/layout/ActiveJobsIndicator'
import { userExperiments } from '@/features/account/userClient'
import { listUserDatasetBuilds, type DatasetBuildTask } from '@/features/datasets/datasetBuildClient'
import type { TrainingExperiment } from '@/features/admin/adminContracts'

const ACTIVE = new Set(['queued', 'running'])
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
    route: task.repositoryId
      ? { name: 'repository', repositoryId: task.repositoryId, buildTaskId: task.taskId }
      : { name: 'my-data', view: 'builds', taskId: task.taskId },
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

export function useActiveUserJobs(): ActiveJob[] {
  const [jobs, setJobs] = useState<ActiveJob[]>([])
  useEffect(() => {
    let alive = true
    let running = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const controller = new AbortController()
    async function load() {
      if (!alive || running) return
      if (timer) { clearTimeout(timer); timer = null }
      if (document.visibilityState === 'hidden') { timer = setTimeout(load, 6000); return }
      running = true
      const [builds, experiments] = await Promise.all([
        listUserDatasetBuilds(controller.signal).catch(() => [] as DatasetBuildTask[]),
        userExperiments(controller.signal).catch(() => [] as TrainingExperiment[]),
      ])
      running = false
      if (!alive || controller.signal.aborted) return
      setJobs([
        ...builds.filter(task => ACTIVE.has(task.status)).map(buildJob),
        ...experiments
          .filter(experiment => ACTIVE.has(experiment.status) || experiment.tasks.some(task => ACTIVE.has(task.status)))
          .map(trainingJob),
      ])
      timer = setTimeout(load, 6000)
    }
    void load()
    const onFocus = () => { if (document.visibilityState !== 'hidden') void load() }
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      controller.abort()
      if (timer) clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])
  return jobs
}
