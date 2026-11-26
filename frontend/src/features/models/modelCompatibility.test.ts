import { expect, it } from 'vitest'
import { repositoryModelStatus, repositorySchemaReason } from '@/features/models/modelCompatibility'

it('explains current, legacy Git and offline 2013 schemas separately', () => {
  expect(repositorySchemaReason('kamei14-git-v2')).toBeNull()
  expect(repositorySchemaReason('openstack-six-v1')).toBeNull()
  expect(repositorySchemaReason('kamei14-git-v1')).toContain('旧版')
  expect(repositorySchemaReason('kamei14-git-v1')).toContain('v2')
  expect(repositorySchemaReason('kamei14-2013-v1')).toContain('离线')
})

it('marks unavailable models without claiming they are repository-compatible', () => {
  expect(repositoryModelStatus({ state: 'ready', enabled: true, featureSchemaVersion: 'kamei14-git-v2' })).toEqual({
    supported: true, label: '可用于仓库分析', reason: null,
  })
  expect(repositoryModelStatus({ state: 'ready', enabled: true, featureSchemaVersion: 'kamei14-git-v1' }).supported).toBe(false)
  expect(repositoryModelStatus({ state: 'ready', enabled: false, featureSchemaVersion: 'kamei14-git-v2' }).label).toBe('已停用')
})
