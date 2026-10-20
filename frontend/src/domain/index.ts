/**
 * 领域层唯一出口：只依赖纯数据与纯规则，不 import React、不碰 window。
 * 页面与 hook 一律从这里取类型和规则，避免各自复制一份口径。
 */
export { displayTime, shanghaiDate, toCommit, type Commit } from './commit'
export { parseDataset, parseRepository, type Dataset, type RepositoryMeta } from './dataset'
export { applyQuery, emptyQuery, queryCommits, readSeedQuery, validDate, type Query } from './query'
export { riskLabel, riskTone, safeRisk, scoreText, validRisk, type RiskTone } from './risk'
export type { Mode, Score } from './types'

export { parseHistorical } from '../api/historical'
export type { BaselineSummary } from '../api/historical'
