export const CURRENT_REPOSITORY_SCHEMAS = ['openstack-six-v1', 'kamei14-git-v2'] as const

export function repositorySchemaReason(schema: string | null | undefined): string | null {
  if (!schema) return '字段规范未记录，不能确认仓库分析兼容性。'
  if (schema === 'openstack-six-v1' || schema === 'kamei14-git-v2') return null
  if (schema === 'kamei14-git-v1') {
    return '旧版 kamei14-git-v1 口径；当前仓库分析只生成 kamei14-git-v2，需重训 v2 模型。'
  }
  if (schema === 'kamei14-2013-v1') {
    return 'Kamei 2013 导入数据口径；仅用于对应数据试算或离线评价，不进入仓库分析。'
  }
  return `当前仓库分析不支持字段规范 ${schema}。`
}

export interface RepositoryModelStatus {
  supported: boolean
  label: string
  reason: string | null
}

export function repositoryModelStatus(model: {
  state: string
  enabled: boolean
  featureSchemaVersion: string | null | undefined
}): RepositoryModelStatus {
  if (model.state !== 'ready') return { supported: false, label: '模型未就绪', reason: '模型产物尚未通过校验。' }
  if (!model.enabled) return { supported: false, label: '已停用', reason: '模型已停用，不能用于新分析。' }
  const reason = repositorySchemaReason(model.featureSchemaVersion)
  return reason
    ? { supported: false, label: '不可用于仓库分析', reason }
    : { supported: true, label: '可用于仓库分析', reason: null }
}
