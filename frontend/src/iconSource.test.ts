/**
 * 图标来源守卫：除 Icon.tsx 外不得直接引用图标库。
 *
 * 目的：保持 24 网格与 1.5 描边只有一个调整点；页面新增图标时先登记到 Icon.tsx。
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
  it('lucide-react 只被 Icon.tsx 引用', () => {
    const root = process.cwd()
    const offenders = walk(join(root, 'src'))
      .filter((file) => !/\.test\./.test(file))
      .filter((file) => readFileSync(file, 'utf8').includes("from 'lucide-react'"))
      .map((file) => relative(root, file).replace(/\\/g, '/'))
      .filter((file) => file !== 'src/Icon.tsx')
    expect(offenders, `直接引用 lucide-react 的文件：${offenders.join(', ')}`).toEqual([])
  })
})
