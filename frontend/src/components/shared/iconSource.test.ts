/**
 * 图标来源守卫：业务代码直接使用 lucide-react，品牌标志单独保留。
 *
 * 目的：防止旧 Icon.tsx 适配层回流，保持图标来源和可访问属性可核对。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(tsx?|jsx?)$/.test(full)) out.push(full)
  }
  return out
}

describe('图标来源', () => {
  it('业务直接使用 lucide-react，不重新引入旧图标适配层', () => {
    const root = process.cwd()
    const offenders = walk(join(root, 'src'))
      .filter(file => !/\.test\./.test(file))
      .filter(file => /from ["'](?:\.\.?\/)+Icon["']/.test(readFileSync(file, 'utf8')))
      .map(file => relative(root, file).replace(/\\/g, '/'))
    expect(offenders).toEqual([])
  })
})
