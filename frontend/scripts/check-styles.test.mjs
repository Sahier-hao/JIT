/**
 * 样式来源守卫的自检。
 *
 * 一半验证真实仓库当前状态，一半用合成清单证明守卫真的会拦住新增页面 CSS、
 * 未登记导入与 Mantine 回流——否则守卫只是一个永远通过的摆设。
 */
import { describe, expect, it } from 'vitest'
import { ALLOWED_ENTRY_IMPORTS, ALLOWED_STYLE_FILES, ALLOWED_TSX_IMPORTS, MANTINE_PENDING, checkStyles, validateInventory } from './check-styles.mjs'

const emptyAllowed = { styleFiles: [], entryImports: [], tsxImports: [], mantineRefs: [] }
const cleanInventory = { styleFiles: ['src/index.css'], entryImports: [], tsxImports: [], mantineRefs: [] }

describe('样式来源守卫', () => {
  it('当前仓库没有违规', () => {
    expect(checkStyles()).toEqual([])
  })

  it('新增未登记的样式表会失败', () => {
    const violations = validateInventory(
      { ...cleanInventory, styleFiles: ['src/index.css', 'src/pages/extra.css'] },
      emptyAllowed,
    )
    expect(violations.join('\n')).toContain('src/pages/extra.css')
  })

  it('入口出现未登记导入会失败', () => {
    const violations = validateInventory(
      { ...cleanInventory, entryImports: ['./styles/extra.css'] },
      emptyAllowed,
    )
    expect(violations.join('\n')).toContain('未登记的样式导入')
  })

  it('页面直接导入页面级样式会失败', () => {
    const violations = validateInventory(
      { ...cleanInventory, tsxImports: [['src/features/projects/pages/ProjectPage.tsx', '../../../styles/project.css']] },
      emptyAllowed,
    )
    expect(violations.join('\n')).toContain('直接导入了页面级样式')
  })

  it('新增 Mantine 引用会失败', () => {
    const violations = validateInventory(
      { ...cleanInventory, mantineRefs: ['src/features/projects/pages/ProjectPage.tsx'] },
      emptyAllowed,
    )
    expect(violations.join('\n')).toContain('新增 Mantine 引用')
  })

  it('重新引入旧基础控件或从业务直接使用底层交互库会失败', () => {
    const violations = validateInventory({ ...cleanInventory,
      legacyUiRefs: ['src/features/projects/pages/ProjectPage.tsx'],
      primitiveRefs: ['src/features/account/pages/ProfilePage.tsx'],
    }, emptyAllowed)
    expect(violations.join('\n')).toContain('旧基础控件')
    expect(violations.join('\n')).toContain('绕过官方组件')
  })

  it('允许清单与入口导入一致', () => {
    const files = new Set(ALLOWED_STYLE_FILES)
    for (const spec of ALLOWED_ENTRY_IMPORTS) {
      expect(files.has(`src/${spec.replace(/^\.\//, '')}`), `入口导入未登记：${spec}`).toBe(true)
    }
    expect(MANTINE_PENDING.length).toBeGreaterThanOrEqual(0)
    expect(ALLOWED_TSX_IMPORTS.length).toBeGreaterThan(0)
  })
})
