import { useEffect, useState } from 'react'
import type { ActiveJob } from '@/components/layout/ActiveJobsIndicator'
import { fetchTrainingTasks, type TrainingTask } from '@/features/admin/adminContracts'

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

export function useActiveAdminJobs(enabled: boolean): ActiveJob[] {
  const [jobs, setJobs] = useState<ActiveJob[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let running = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const controller = new AbortController()
    async function load() {
      if (!alive || running) return
      if (timer) { clearTimeout(timer); timer = null }
      if (document.visibilityState === 'hidden') { timer = setTimeout(load, 6000); return }
      running = true
      try {
        const page = await fetchTrainingTasks(50, 0, controller.signal)
        if (alive && !controller.signal.aborted) {
          setJobs(page.tasks.filter(task => ACTIVE.has(task.status)).map(taskJob))
        }
      } catch {
        if (alive && !controller.signal.aborted) setJobs([])
      } finally {
        running = false
        if (alive && !controller.signal.aborted) timer = setTimeout(load, 6000)
      }
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
  }, [enabled])
  return enabled ? jobs : []
}
