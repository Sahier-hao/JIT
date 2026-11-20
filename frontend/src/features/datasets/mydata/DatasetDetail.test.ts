import { expect, it } from 'vitest'
import { datasetNeedsRebuild } from '@/features/datasets/mydata/DatasetDetail'

it('offers a rebuild for legacy labels by the returned admission code', () => {
  expect(datasetNeedsRebuild({
    available: false,
    reason: {
      code: 'LABEL_OBSERVATION_UNKNOWN',
      message: '这份数据缺少标签成熟度记录，无法安全判断哪些提交可用于训练',
    },
  })).toBe(true)
})

it('does not attach a rebuild action to unrelated split failures', () => {
  expect(datasetNeedsRebuild({
    available: false,
    reason: { code: 'SPLIT_INVALID', message: '切分后只有一类标签' },
  })).toBe(false)
  expect(datasetNeedsRebuild(null)).toBe(false)
})
