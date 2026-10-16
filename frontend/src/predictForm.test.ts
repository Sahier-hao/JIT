/**
 * 六字段表单校验与粘贴 JSON 导入（任务 4.1、4.2；MPW-05、MPW-06、design D5）。
 *
 * 两条硬要求：空白绝不被当成 0；导入失败时草稿一个字都不变（原子性）。
 */

import { describe, expect, it } from 'vitest'
import { COUNT_FIELDS, FEATURE_FIELDS, FeatureJsonError, importFeatureJson, parseStrictJson } from './featureJson'
import type { Draft } from './predictionInput'
import { draftValues, draftWithFeatures, emptyDraft, validateDraft } from './predictionInput'
import { MODEL_ID, SIX_VALUES } from './testFixtures'

const complete: Draft = {
  ...emptyDraft,
  project: 'openstack',
  recordId: 'demo-0001',
  ns: '4',
  nd: '7',
  nf: '12',
  ent: '2.25',
  la: '120',
  ld: '9',
}

describe('validateDraft 的六字段约束', () => {
  it('完整合法的表单产出提交快照', () => {
    const outcome = validateDraft(complete, MODEL_ID)
    expect(outcome.errors).toEqual({})
    expect(outcome.result?.sixFieldSchemaVersion).toBe('openstack-six-v1')
    expect(outcome.result?.values).toEqual(SIX_VALUES)
    expect(outcome.result?.submission).toMatchObject({
      modelId: MODEL_ID,
      project: 'openstack',
      recordId: 'demo-0001',
      features: SIX_VALUES,
      commitId: null,
      time: null,
    })
  })

  it('空白字段报错且绝不按 0 处理', () => {
    for (const name of FEATURE_FIELDS) {
      const outcome = validateDraft({ ...complete, [name]: '' }, MODEL_ID)
      expect(outcome.result).toBeNull()
      expect(outcome.errors[name]).toContain('空白不会按 0 处理')
    }
    const whitespace = validateDraft({ ...complete, ns: '   ' }, MODEL_ID)
    expect(whitespace.result).toBeNull()
    expect(whitespace.errors.ns).toContain('空白不会按 0 处理')
  })

  it('计数只接受非负安全整数', () => {
    for (const name of COUNT_FIELDS) {
      for (const bad of ['-1', '1.5', '1e3', 'abc', '0x10', '+2']) {
        const outcome = validateDraft({ ...complete, [name]: bad }, MODEL_ID)
        expect(outcome.result).toBeNull()
        expect(outcome.errors[name]).toBeTruthy()
      }
      expect(validateDraft({ ...complete, [name]: '0' }, MODEL_ID).errors[name]).toBeUndefined()
    }
    const huge = String(Number.MAX_SAFE_INTEGER + 1)
    expect(validateDraft({ ...complete, nf: huge }, MODEL_ID).errors.nf).toContain('超出可精确表示的整数范围')
  })

  it('ent 是有限非负浮点，可以是小数与科学计数法', () => {
    expect(validateDraft({ ...complete, ent: '0' }, MODEL_ID).errors.ent).toBeUndefined()
    expect(validateDraft({ ...complete, ent: '.5' }, MODEL_ID).result?.values.ent).toBe(0.5)
    expect(validateDraft({ ...complete, ent: '1e-3' }, MODEL_ID).result?.values.ent).toBe(0.001)
    // 负数在形状阶段就被拒绝（十进制形状不接受前置减号），不会走到值域判断。
    expect(validateDraft({ ...complete, ent: '-0.5' }, MODEL_ID).errors.ent).toContain('只接受数字')
    expect(validateDraft({ ...complete, ent: 'NaN' }, MODEL_ID).errors.ent).toBeTruthy()
    expect(validateDraft({ ...complete, ent: 'Infinity' }, MODEL_ID).errors.ent).toBeTruthy()
  })

  it('项目与记录编号去掉首尾空格后必须非空且不超长', () => {
    expect(validateDraft({ ...complete, project: '  ' }, MODEL_ID).errors.project).toContain('请填写项目')
    expect(validateDraft({ ...complete, recordId: '' }, MODEL_ID).errors.recordId).toContain('请填写记录编号')
    expect(validateDraft({ ...complete, project: 'x'.repeat(129) }, MODEL_ID).errors.project).toContain('128')
    expect(validateDraft({ ...complete, project: ' openstack ' }, MODEL_ID).result?.submission.project).toBe('openstack')
  })

  it('提交 SHA 可选，但给了就必须是 40 位十六进制并规范成小写', () => {
    const bad = validateDraft({ ...complete, commitId: 'abc' }, MODEL_ID)
    expect(bad.result).toBeNull()
    expect(bad.errors.commitId).toContain('40 位十六进制')
    const ok = validateDraft({ ...complete, commitId: 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678' }, MODEL_ID)
    expect(ok.result?.submission.commitId).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678')
    expect(validateDraft({ ...complete, commitId: '' }, MODEL_ID).result?.submission.commitId).toBeNull()
  })

  it('提交时间可选，但必须带时区', () => {
    expect(validateDraft({ ...complete, time: '2026-10-15T18:00:00' }, MODEL_ID).errors.time).toContain('带时区')
    expect(validateDraft({ ...complete, time: '2026-10-15T18:00:00Z' }, MODEL_ID).result?.submission.time).toBe(
      '2026-10-15T18:00:00Z',
    )
    expect(
      validateDraft({ ...complete, time: '2026-10-15T18:00:00+08:00' }, MODEL_ID).result?.submission.time,
    ).toBe('2026-10-15T18:00:00+08:00')
    expect(validateDraft({ ...complete, time: '2026-13-45T99:00:00Z' }, MODEL_ID).errors.time).toBeTruthy()
  })

  it('没有可提交的模型时不产出快照', () => {
    const outcome = validateDraft(complete, null)
    expect(outcome.result).toBeNull()
  })

  it('只要有一项失败就不产出任何部分结果', () => {
    const outcome = validateDraft({ ...complete, ns: '', ent: '-1' }, MODEL_ID)
    expect(outcome.result).toBeNull()
    expect(Object.keys(outcome.errors).sort()).toEqual(['ent', 'ns'])
  })
})

describe('parseStrictJson', () => {
  it('拒绝重复键，包括转义后等价的键', () => {
    expect(() => parseStrictJson('{"ns":1,"ns":2}')).toThrow(FeatureJsonError)
    expect(() => parseStrictJson('{"ns":1,"\\u006es":2}')).toThrow(FeatureJsonError)
  })

  it('拒绝非法转义、未转义控制字符与尾随内容', () => {
    expect(() => parseStrictJson('{"a":"\\x"}')).toThrow(FeatureJsonError)
    expect(() => parseStrictJson('{"a":"\n"}')).toThrow(FeatureJsonError)
    expect(() => parseStrictJson('{"a":1} trailing')).toThrow(FeatureJsonError)
    expect(() => parseStrictJson('{"a":01}')).toThrow(FeatureJsonError)
    expect(() => parseStrictJson('{"a":1px}')).toThrow(FeatureJsonError)
  })
})

describe('importFeatureJson', () => {
  it('恰含六个数值字段时一次填满草稿', () => {
    const result = importFeatureJson(JSON.stringify(SIX_VALUES))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.features).toEqual(SIX_VALUES)
    const draft = draftWithFeatures(complete, result.features)
    expect(draft).toEqual({ ...complete, ns: '4', nd: '7', nf: '12', ent: '2.25', la: '120', ld: '9' })
  })

  it('导入只覆盖六项，项目、记录编号与提交元数据保持原样', () => {
    const draft: Draft = { ...complete, commitId: 'a'.repeat(40), time: '2026-10-15T18:00:00Z' }
    const result = importFeatureJson('{"ns":1,"nd":2,"nf":3,"ent":0.5,"la":4,"ld":5}')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const next = draftWithFeatures(draft, result.features)
    expect(next.project).toBe('openstack')
    expect(next.recordId).toBe('demo-0001')
    expect(next.commitId).toBe('a'.repeat(40))
    expect(next.time).toBe('2026-10-15T18:00:00Z')
  })

  it('拒绝请求包装、数组、缺失与额外字段', () => {
    const wrapped = importFeatureJson(JSON.stringify({ modelId: MODEL_ID, record: { features: SIX_VALUES } }))
    expect(wrapped.ok).toBe(false)
    if (!wrapped.ok) expect(wrapped.message).toContain('请求包装字段')

    expect(importFeatureJson('[]').ok).toBe(false)
    expect(importFeatureJson('[1,2,3]').ok).toBe(false)
    const { ld: _dropped, ...missing } = SIX_VALUES
    const missingResult = importFeatureJson(JSON.stringify(missing))
    expect(missingResult.ok).toBe(false)
    if (!missingResult.ok) expect(missingResult.message).toContain('缺少字段：ld')

    const extra = importFeatureJson(JSON.stringify({ ...SIX_VALUES, label: 1 }))
    expect(extra.ok).toBe(false)
    if (!extra.ok) expect(extra.message).toContain('未支持的字段：label')
  })

  it('拒绝 label 这类标签字段、字符串与布尔值', () => {
    expect(importFeatureJson(JSON.stringify({ ...SIX_VALUES, label: 0 })).ok).toBe(false)
    expect(importFeatureJson(JSON.stringify({ ...SIX_VALUES, ns: '4' })).ok).toBe(false)
    expect(importFeatureJson(JSON.stringify({ ...SIX_VALUES, ent: true })).ok).toBe(false)
    const negative = importFeatureJson(JSON.stringify({ ...SIX_VALUES, la: -1 }))
    expect(negative.ok).toBe(false)
    if (!negative.ok) expect(negative.field).toBe('la')
    expect(importFeatureJson(JSON.stringify({ ...SIX_VALUES, nf: 1.5 })).ok).toBe(false)
  })

  it('拒绝空输入、语法错误与超长内容，并给出可读原因', () => {
    expect(importFeatureJson('   ').ok).toBe(false)
    const broken = importFeatureJson('{"ns":')
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.message).toContain('不是合法 JSON')
    const tooLong = importFeatureJson('x'.repeat(64 * 1024 + 1))
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) expect(tooLong.message).toContain('上限')
  })

  it('导入失败时调用方拿不到任何部分结果', () => {
    const result = importFeatureJson('{"ns":1,"nd":2,"nf":3,"ent":0.5,"la":4,"ld":"5"}')
    expect(result.ok).toBe(false)
    expect(Object.keys(result)).not.toContain('features')
  })
})

describe('draftValues', () => {
  it('只回报已填写的项，便于展示而不参与提交', () => {
    expect(draftValues({ ...emptyDraft, ns: '4', ent: ' 2.25 ' })).toEqual({ ns: '4', ent: '2.25' })
    expect(draftValues(emptyDraft)).toEqual({})
  })
})
