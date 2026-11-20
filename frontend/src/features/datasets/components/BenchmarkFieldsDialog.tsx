import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CircleHelp } from 'lucide-react'

const FEATURE_GROUPS = [
  ['改动范围', [
    ['ns', '改动涉及的子系统数'],
    ['nm / nd', '改动涉及的目录数'],
    ['nf', '改动涉及的文件数'],
    ['entropy', '改动在文件间的分散程度'],
  ]],
  ['改动规模', [
    ['la', '新增行数相对于原文件规模的比例'],
    ['ld', '删除行数相对于原文件规模的比例'],
    ['lt', '改动前涉及文件的平均行数'],
  ]],
  ['变更历史', [
    ['fix', '本次改动是否用于修复已有缺陷（1 是，0 否）'],
    ['ndev', '曾修改过相关文件的开发者数'],
    ['pd / age', '相关文件距上次改动的平均时间间隔'],
    ['npt / nuc', '过去改动次数（按文件数归一化）'],
  ]],
  ['开发者经验', [
    ['exp', '开发者过去的改动次数'],
    ['rexp', '对近期改动加权后的经验'],
    ['sexp', '开发者在相关子系统的改动经验'],
  ]],
] as const

export function BenchmarkFieldsDialog() {
  return <Dialog>
    <DialogTrigger asChild>
      <Button type="button" variant="outline" size="sm"><CircleHelp size={15} aria-hidden="true"/>字段与标签说明</Button>
    </DialogTrigger>
    <DialogContent className="max-h-[86dvh] overflow-y-auto overscroll-contain" style={{ width: 'min(92vw, 540px)' }}>
      <DialogHeader>
        <DialogTitle>字段与标签说明</DialogTitle>
        <DialogDescription>Kamei 2013 数据集 · 每行对应一次历史改动</DialogDescription>
      </DialogHeader>
      <section aria-label="缺陷标签" className="rounded-lg border border-border-soft bg-sunken px-3 py-2.5 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <code className="font-mono font-semibold">bug</code><span>发布者标注的缺陷引入结果</span>
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          <div className="flex items-baseline gap-1.5"><dt className="font-mono text-rose-deep">1</dt><dd>引入缺陷</dd></div>
          <div className="flex items-baseline gap-1.5"><dt className="font-mono text-foreground-3">0</dt><dd>未被标记为引入缺陷</dd></div>
        </dl>
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        {FEATURE_GROUPS.map(([group, fields]) => <section key={group}>
          <h3 className="mb-1.5 text-sm font-semibold">{group}</h3>
          <dl className="space-y-1.5 text-xs leading-relaxed">
            {fields.map(([field, meaning]) => <div key={field} className="grid grid-cols-[4.75rem_1fr] gap-1.5">
              <dt><code className="font-mono text-accent">{field}</code></dt>
              <dd className="text-foreground-2">{meaning}</dd>
            </div>)}
          </dl>
        </section>)}
      </div>
      <dl className="space-y-1.5 border-t border-border-soft pt-3 text-xs leading-relaxed">
        <div className="grid grid-cols-[6rem_1fr] gap-2"><dt><code className="font-mono">transactionid</code></dt><dd className="text-foreground-2">项目内的原始改动编号</dd></div>
        <div className="grid grid-cols-[6rem_1fr] gap-2"><dt><code className="font-mono">commitdate</code></dt><dd className="text-foreground-2">原始改动时间。来源未注明时区，系统按 UTC 切分。</dd></div>
      </dl>
    </DialogContent>
  </Dialog>
}
