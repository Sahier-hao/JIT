export const KAMEI_2013_SCHEMA = 'kamei14-2013-v1'
export const CSV_HEADER_BYTES = 64 * 1024

const COMMIT_COLUMNS = 'commit_id author_date bugcount'
const FOURTEEN_COLUMNS = `${COMMIT_COLUMNS} ns nd nf entropy la ld lt fix ndev age nuc exp rexp sexp`
const MATURITY_COLUMNS = ['label_status', 'observed_through_epoch', 'maturity_days']

export const CSV_FORMATS = [
  {
    value: KAMEI_2013_SCHEMA,
    label: 'Kamei 2013 原始 CSV',
    required: 'transactionid commitdate ns nm nf entropy la ld lt fix ndev pd npt exp rexp sexp bug',
  },
  {
    value: 'kamei14-benchmark-v1',
    label: '标准化 Kamei 14 维',
    required: FOURTEEN_COLUMNS,
  },
  {
    value: 'openstack-six-v1',
    label: 'OpenStack 6 维',
    required: `${COMMIT_COLUMNS} ns nd nf ent la ld`,
  },
  {
    value: 'kamei14-v1',
    label: 'Kamei 旧版快照（12 维）',
    required: `${COMMIT_COLUMNS} fixcount ns nd nf ent la ld ndev age nuc aexp asexp`,
  },
  {
    value: 'kamei14-git-v1',
    label: 'Git 14 维 v1',
    required: FOURTEEN_COLUMNS,
  },
  {
    value: 'kamei14-git-v2',
    label: 'Git 14 维 v2',
    required: FOURTEEN_COLUMNS,
  },
].map(format => ({ ...format, columns: format.required.split(' ') }))

type Format = typeof CSV_FORMATS[number]

export type CsvInspection = {
  columns: string[]
  formats: Format[]
  suggestion?: Format
  error?: string
}

function readColumns(text: string, complete: boolean): string[] {
  const source = text.replace(/^\uFEFF/, '')
  const field = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))([,\r\n]|$)/y
  const columns: string[] = []
  let token = field.exec(source)
  while (token) {
    columns.push(token[1]?.replaceAll('""', '"') ?? token[2])
    if (token[3] !== ',') {
      if (!complete && !token[3]) throw new Error('CSV 表头超过 64 KiB，读不到完整的第一行。')
      if (columns.some(column => !column.trim() || column.includes('\0'))) {
        throw new Error('CSV 表头含有空列名或无效字符。')
      }
      if (new Set(columns).size !== columns.length) throw new Error('CSV 表头含有重复列名。')
      return columns
    }
    token = field.exec(source)
  }
  throw new Error('读不到有效的 CSV 表头，请检查引号和分隔符。')
}

export function missingColumns(columns: string[], format: Format): string[] {
  return format.columns.filter(column => !columns.includes(column))
}

export function inspectCsvHeader(text: string, complete = true): CsvInspection {
  const columns = readColumns(text, complete)
  const maturityCount = MATURITY_COLUMNS.filter(column => columns.includes(column)).length
  if (maturityCount > 0 && maturityCount < MATURITY_COLUMNS.length) {
    const missing = MATURITY_COLUMNS.filter(column => !columns.includes(column))
    return { columns, formats: [], error: `标签成熟字段须同时提供。缺少 ${missing.join('、')}。` }
  }
  // 表头相同的 Git v1/v2 需要数据来源确认，逐行成熟字段也无法区分采集版本。
  const eligible = maturityCount ? CSV_FORMATS.filter(format => (
    format.value !== KAMEI_2013_SCHEMA && format.value !== 'kamei14-benchmark-v1'
  )) : CSV_FORMATS
  const matched = eligible.filter(format => missingColumns(columns, format).length === 0)
  const formats = matched.filter(format => !matched.some(other =>
    other.columns.length > format.columns.length && format.columns.every(column => other.columns.includes(column)),
  ))
  if (formats.length) return { columns, formats }

  const suggestion = eligible.map(format => ({
    format,
    overlap: format.columns.filter(column => columns.includes(column)).length,
    adjustment: missingColumns(columns, format).length + columns.filter(column => !format.columns.includes(column)).length,
  })).filter(item => item.overlap > 0)
    .sort((a, b) => a.adjustment - b.adjustment || b.overlap - a.overlap)[0]?.format
  return { columns, formats, suggestion }
}
