/**
 * 排版边界（design D13 / 6.4）：日期与中文句子不得使用等宽字族。
 *
 * 起因：等宽字体的斜杠零会把 `2011-11` 读成 "2811-11"（实测踩到）。
 * 这里只禁止"日期与句子"这两类，标识、KPI、刻度、序号、凭据与 JSON 仍可用等宽。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styleDir = resolve(process.cwd(), 'src/styles')
const files = [
  ...readdirSync(styleDir).filter((f) => f.endsWith('.css')).map((f) => resolve(styleDir, f)),
  resolve(process.cwd(), 'src/trend.css'),
]

/** 禁止用等宽的选择器：日期主体与中文句子。 */
const FORBIDDEN = [
  /\bh1\b|\bh2\b|\bh3\b/,
  /\.lede\b/,
  /\.commit-title\b/,
  /\.page-foot\b|\.foot\b/,
  /\.notice\b/,
  /\.field-help\b/,
  /\.detail-identity time\b/,
  // 时间列主体：只允许内部的 span（秒级时间戳）用等宽
  /\.time-cell\s*$/,
  /\.c-time\s*$/,
]

function declarations(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
    selector: m[1].trim().split('\n').pop()?.trim() ?? '',
    body: m[2],
  }))
}

describe('日期与句子不使用等宽字族', () => {
  it('日期主体与中文句子未使用等宽', () => {
    const offenders: string[] = []

    for (const file of files) {
      for (const { selector, body } of declarations(readFileSync(file, 'utf8'))) {
        const mono = /font-family:\s*var\(--mono\)/.test(body) || /font:\s*[^;]*var\(--mono\)/.test(body)
        if (!mono) continue
        if (FORBIDDEN.some((pattern) => pattern.test(selector))) {
          offenders.push(`${file.split(/[\\/]/).pop()}: ${selector}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
