import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ModelChoice } from '@/features/models/modelClient'

/** 可参与仓库分析/试算的模型：已校验、启用且字段规范兼容。 */
export function usableModel(model?: ModelChoice | null): boolean {
  return Boolean(model && model.state === 'ready' && model.enabled && model.repositoryPredictionSupported)
}

export function modelUnavailableReason(model: ModelChoice): string {
  if (model.state !== 'ready') return '模型未就绪'
  if (!model.enabled) return '已停用'
  if (!model.repositoryPredictionSupported) {
    return `字段规范 ${model.featureSchemaVersion ?? '未知'} 不适用于仓库分析`
  }
  return '不可用'
}

function optionLabel(model: ModelChoice, duplicate: boolean): string {
  const name = duplicate ? `${model.name} · ${model.modelId.slice(0, 8)}` : model.name
  return `${name}${model.isDefault ? ' · 默认' : ''}`
}

export interface ModelSelectProps {
  models: ModelChoice[]
  value: string
  onValueChange: (value: string) => void
  label: string
  placeholder?: string
  disabled?: boolean
  /** 保留不可用模型并标出原因；默认只列可选模型。 */
  allowUnavailable?: boolean
  excludeIds?: string[]
  /** 原选模型不在当前可选范围时的说明。 */
  missingLabel?: string
  /** 不可用模型的明确原因；缺省时使用通用原因。 */
  unavailableReason?: (model: ModelChoice) => string
}

/**
 * 统一的模型选择器：按“我的模型 / 共享模型”分组，只列可选模型。
 * 原选模型不可见时保留为禁用项，避免静默替换。
 */
export function ModelSelect({ models, value, onValueChange, label, placeholder = '选择模型', disabled, allowUnavailable = false, excludeIds = [], missingLabel, unavailableReason }: ModelSelectProps) {
  const excluded = new Set(excludeIds)
  const pool = models.filter(model => !excluded.has(model.modelId))
  const shown = allowUnavailable ? pool : pool.filter(usableModel)
  const groups = [
    { key: 'mine', label: '我的模型', items: shown.filter(model => model.mine) },
    { key: 'shared', label: '共享模型', items: shown.filter(model => model.shared && !model.mine) },
    { key: 'other', label: '其他模型', items: shown.filter(model => !model.mine && !model.shared) },
  ].filter(group => group.items.length)
  const names = new Map<string, number>()
  for (const model of shown) names.set(model.name, (names.get(model.name) ?? 0) + 1)
  const missing = Boolean(value) && !shown.some(model => model.modelId === value)
  const triggerPlaceholder = missing ? (missingLabel ?? '原选模型（不可用）') : placeholder
  return <Select value={value} onValueChange={onValueChange} disabled={disabled}>
    <SelectTrigger aria-label={label}><SelectValue placeholder={triggerPlaceholder}/></SelectTrigger>
    <SelectContent>
      {missing ? <SelectGroup>
        <SelectLabel>原选模型</SelectLabel>
        <SelectItem value={value} disabled>{missingLabel ?? '原选模型（不可用）'}</SelectItem>
      </SelectGroup> : null}
      {groups.map(group => <SelectGroup key={group.key}>
        <SelectLabel>{group.label}</SelectLabel>
        {group.items.map(model => {
          const unavailable = allowUnavailable && !usableModel(model)
          return <SelectItem key={model.modelId} value={model.modelId} disabled={unavailable}>
            {optionLabel(model, (names.get(model.name) ?? 0) > 1)}
            {unavailable ? `（${unavailableReason?.(model) ?? modelUnavailableReason(model)}）` : ''}
          </SelectItem>
        })}
      </SelectGroup>)}
    </SelectContent>
  </Select>
}
