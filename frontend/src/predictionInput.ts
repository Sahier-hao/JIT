/**
 * 六字段表单的输入草稿与校验（MPW-05、design D5）。
 *
 * 草稿里的每一项都是字符串：空值保持空白，绝不在校验前被当成 0。只有整张表通过校验后
 * 才产出提交快照；计数必须是 JavaScript 安全整数，超出范围明确报错而不是悄悄舍入。
 */

import type { FeatureField } from './featureJson'
import type { Submission } from './predictionContract'
import { SIX_FIELD_SCHEMA } from './predictionContract'
import { COUNT_FIELDS, FEATURE_FIELDS } from './featureJson'

export interface Draft {
  project: string
  recordId: string
  commitId: string
  time: string
  ns: string
  nd: string
  nf: string
  ent: string
  la: string
  ld: string
}

export type DraftField = keyof Draft
export type DraftErrors = Partial<Record<DraftField, string>>

export const emptyDraft: Draft = {
  project: '',
  recordId: '',
  commitId: '',
  time: '',
  ns: '',
  nd: '',
  nf: '',
  ent: '',
  la: '',
  ld: '',
}

export const FIELD_LABELS: Record<DraftField, string> = {
  project: '项目',
  recordId: '记录编号',
  commitId: '提交 SHA',
  time: '提交时间',
  ns: 'ns · 涉及子系统数',
  nd: 'nd · 涉及目录数',
  nf: 'nf · 修改文件数',
  ent: 'ent · 修改分散程度（熵）',
  la: 'la · 增加行数',
  ld: 'ld · 删除行数',
}

const COUNT_SHAPE = /^\d+$/
const DECIMAL_SHAPE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const SHA_SHAPE = /^[0-9a-fA-F]{40}$/
const TIME_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

export interface ValidatedInput {
  sixFieldSchemaVersion: string
  values: Record<FeatureField, number>
  submission: Submission
}

export interface ValidationOutcome {
  errors: DraftErrors
  result: ValidatedInput | null
}

function countValue(name: FeatureField, raw: string, errors: DraftErrors): number | null {
  const label = FIELD_LABELS[name]
  const value = raw.trim()
  if (value === '') {
    errors[name] = `请填写${label}，空白不会按 0 处理`
    return null
  }
  if (!COUNT_SHAPE.test(value)) {
    errors[name] = `${label}只接受非负整数（当前为“${value}”）`
    return null
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    errors[name] = `${label}超出可精确表示的整数范围，请核对原始数值`
    return null
  }
  return parsed
}

function entropyValue(raw: string, errors: DraftErrors): number | null {
  const value = raw.trim()
  if (value === '') {
    errors.ent = `请填写${FIELD_LABELS.ent}，空白不会按 0 处理`
    return null
  }
  if (!DECIMAL_SHAPE.test(value)) {
    errors.ent = `${FIELD_LABELS.ent}只接受数字（当前为“${value}”）`
    return null
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    errors.ent = `${FIELD_LABELS.ent}必须是有限数值`
    return null
  }
  if (parsed < 0) {
    errors.ent = `${FIELD_LABELS.ent}不能是负数`
    return null
  }
  return parsed
}

function textField(value: string, label: string, field: DraftField, errors: DraftErrors): string | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    errors[field] = `请填写${label}`
    return null
  }
  if (trimmed.length > 128) {
    errors[field] = `${label}不能超过 128 个字符`
    return null
  }
  return trimmed
}

/**
 * 校验整张表；任一项失败都不产出提交快照，调用方据此保持按钮不可用。
 * `modelId` 为 null 表示还没有可提交的模型，此时不做字段判断。
 */
export function validateDraft(draft: Draft, modelId: string | null): ValidationOutcome {
  const errors: DraftErrors = {}
  const project = textField(draft.project, FIELD_LABELS.project, 'project', errors)
  const recordId = textField(draft.recordId, FIELD_LABELS.recordId, 'recordId', errors)

  const values = {} as Record<FeatureField, number>
  for (const name of FEATURE_FIELDS) {
    const parsed = name === 'ent' ? entropyValue(draft.ent, errors) : countValue(name, draft[name], errors)
    if (parsed !== null) values[name] = parsed
  }

  let commitId: string | null = null
  const commitRaw = draft.commitId.trim()
  if (commitRaw !== '') {
    if (!SHA_SHAPE.test(commitRaw)) {
      errors.commitId = `${FIELD_LABELS.commitId}必须是 40 位十六进制`
    } else {
      commitId = commitRaw.toLowerCase()
    }
  }

  let time: string | null = null
  const timeRaw = draft.time.trim()
  if (timeRaw !== '') {
    if (!TIME_SHAPE.test(timeRaw) || !Number.isFinite(Date.parse(timeRaw))) {
      errors.time = `${FIELD_LABELS.time}必须是带时区的 ISO 时间，例如 2026-01-02T03:04:05+08:00`
    } else {
      time = timeRaw
    }
  }

  if (Object.keys(errors).length > 0 || project === null || recordId === null || modelId === null) {
    return { errors, result: null }
  }
  return {
    errors,
    result: {
      sixFieldSchemaVersion: SIX_FIELD_SCHEMA,
      values,
      submission: { modelId, project, recordId, features: values, commitId, time },
    },
  }
}

/** 特征 JSON 导入只改这六项，项目、记录编号与所选模型保持原样。 */
export function draftWithFeatures(draft: Draft, features: Record<FeatureField, number>): Draft {
  const next = { ...draft }
  for (const name of FEATURE_FIELDS) next[name] = String(features[name])
  return next
}

/** 表单里当前已填写、且能明确表达为数值的六项（仅用于展示，不用于提交）。 */
export function draftValues(draft: Draft): Partial<Record<FeatureField, string>> {
  const values: Partial<Record<FeatureField, string>> = {}
  for (const name of FEATURE_FIELDS) {
    if (draft[name].trim() !== '') values[name] = draft[name].trim()
  }
  return values
}

export { COUNT_FIELDS }
