export const FEATURE_LABELS: Record<string, string> = {
  ns: '修改子系统数',
  nd: '修改目录数',
  nf: '修改文件数',
  ent: '变更分布熵',
  entropy: '变更分布熵',
  la: '新增行数',
  ld: '删除行数',
  lt: '变更前文件规模',
  fix: '修复关键词',
  ndev: '涉及开发者数',
  age: '最近变更时间',
  nuc: '唯一变更文件数',
  exp: '开发者经验',
  rexp: '近期开发者经验',
  sexp: '子系统经验',
}

export function featureLabel(name: string): string {
  return FEATURE_LABELS[name] ?? name
}
