import type { TrainingExperimentStatus } from '@/features/admin/adminContracts'

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

export function trainingMethodName(method: string) {
  return METHOD_NAMES[method] ?? method
}

export function isActiveTraining(status: TrainingExperimentStatus) {
  return status === 'running' || status === 'queued'
}
