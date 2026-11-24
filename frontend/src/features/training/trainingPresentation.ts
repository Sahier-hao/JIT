import type { TrainingExperimentStatus, TrainingTask } from '@/features/admin/adminContracts'

export const trainingStatus: Record<TrainingExperimentStatus, { label: string; color: string; dot: string }> = {
  queued: { label: '排队中', color: 'text-foreground-3', dot: 'bg-foreground-4' },
  running: { label: '训练中', color: 'text-accent', dot: 'bg-accent' },
  succeeded: { label: '已完成', color: 'text-accent', dot: 'bg-accent' },
  partial: { label: '部分完成', color: 'text-foreground-2', dot: 'bg-amber' },
  failed: { label: '训练失败', color: 'text-rose', dot: 'bg-rose' },
  cancelled: { label: '已取消', color: 'text-foreground-3', dot: 'bg-foreground-4' },
  interrupted: { label: '已中断', color: 'text-rose', dot: 'bg-rose' },
  empty: { label: '无任务', color: 'text-foreground-3', dot: 'bg-foreground-4' },
}

export function trainingPhase(task: TrainingTask): 0 | 1 | 2 | 3 | null {
  if (task.status === 'queued') return 0
  if (task.status === 'succeeded') return 3
  if (task.status !== 'running') return null
  const history = task.trainingHistory
  return history && history.epochs > 0 && (history.entries.at(-1)?.epoch ?? 0) >= history.epochs ? 2 : 1
}

const METHOD_NAMES: Record<string, string> = {
  'logistic-regression-l2-v1': '逻辑回归',
  'decision-tree-v1': '决策树',
  'random-forest-v1': '随机森林',
  'gaussian-naive-bayes-v1': '高斯朴素贝叶斯',
  'gradient-boosting-v1': '梯度提升树',
  'mlp-v1': 'MLP',
  'wide-deep-v1': '宽深双塔',
  'tabular-resnet-v1': '表格 ResNet',
  'ft-transformer-v1': 'FT-Transformer',
}

export function trainingMethodName(method: string, fallback = method) {
  return METHOD_NAMES[method] ?? fallback
}

export function isActiveTraining(status: TrainingExperimentStatus) {
  return status === 'running' || status === 'queued'
}
