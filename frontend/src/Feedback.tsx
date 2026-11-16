import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { ReactNode } from 'react'


import { describeFailure, type FailureKind } from './requestState'
import { cn } from './lib/utils'

const KIND_TITLES: Record<FailureKind, string> = {
  network: '无法连接服务',
  contract: '返回内容不符合约定',
  missing: '没有找到该资源',
  field: '需要修正输入或重新选择',
  model: '模型当前不可用',
  storage: '目录存储不可用',
  unknown: '请求失败',
}

/**
 * 加载态：骨架 + 一句可读说明（任务 5.5）。
 *
 * `prefix` 为真时补一枚"正在读取"的标签；页面级的提示自己就写全了整句时
 * （例如「正在读取真实历史提交」）关掉它，避免同一句话读两遍。
 */
export function LoadingNotice({
  label,
  note,
  prefix = true,
}: {
  label: string
  note?: string
  prefix?: boolean
}) {
  return (
    <div className="flex gap-2 rounded-sm border border-border-soft bg-sunken p-3 text-sm text-foreground-2" role="status" aria-busy="true" aria-live="polite">
      <Info aria-hidden="true" focusable="false" strokeWidth={1.5} size={16} className="mt-0.5 shrink-0 text-foreground-3"/>
      <div className="grid min-w-0 gap-0.5">
        {prefix ? <strong className="text-foreground">正在读取</strong> : null}
        <span>{label}</span>
        {note === undefined ? null : <span className="text-xs text-foreground-3">{note}</span>}
        <div className="mt-2 grid gap-1" aria-hidden="true">
          {['100%', '92%', '64%'].map((width, index) => (
            <Skeleton key={index} className="h-2 rounded-full" style={{ width }} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 空态与"不可用"态的唯一实现（任务 5.5）：左对齐的说明块，取代旧的居中图标空状态。
 *
 * 两种语气：`empty` 表示"这里确实没有内容"，`alert` 表示"内容读不到/不可用"并进入可读的
 * alert 区域。标题始终是真实文字，状态不只靠颜色区分。
 */
export function EmptyState({
  title,
  description,
  tone = 'empty',
  children,
}: {
  title: string
  description: ReactNode
  tone?: 'empty' | 'alert'
  children?: ReactNode
}) {
  return (
    <Card className={cn('grid justify-items-start gap-1.5', tone === 'alert' && 'border-rose/30 bg-rose-soft')} data-state={tone} role={tone === 'alert' ? 'alert' : undefined}>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-xs leading-body text-foreground-3">{description}</p>
      {children === undefined ? null : <div className="mt-1 flex flex-wrap gap-2">{children}</div>}
    </Card>
  )
}

export function FailureNotice({
  error,
  onRetry,
  retryLabel = '重新加载',
  children,
}: {
  error: unknown
  onRetry?: () => void
  retryLabel?: string
  children?: ReactNode
}) {
  const failure = describeFailure(error)
  return (
    <Alert variant="destructive" className="border-rose/30 bg-rose-soft text-rose-deep">
      <Info aria-hidden="true" focusable="false" strokeWidth={1.5} size={17} className="mt-0.5 shrink-0"/>
      <AlertTitle>{KIND_TITLES[failure.kind]}</AlertTitle>
      <AlertDescription className="min-w-0">
        <span>{failure.message}</span>
        {failure.details.length > 0 ? (
          <ul className="mt-1 grid gap-0.5 pl-4 list-disc">
            {failure.details.map((detail) => (
              <li key={`${detail.field}:${detail.reason}`}>
                <code className="font-mono">{detail.field}</code>
                {detail.reason}
              </li>
            ))}
          </ul>
        ) : null}
        {failure.requestId === '' ? null : (
          <span className="text-foreground-3">
            请求编号 <code className="font-mono text-foreground-2">{failure.requestId}</code>
          </span>
        )}
        {children}
        {onRetry === undefined ? null : (
          <div className="mt-1">
            <Button type="button" size="sm" onClick={onRetry} variant="outline">{retryLabel}</Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}

/** 成功或中性的操作反馈：写操作的结果必须能被文字读到。 */
export function StatusNote({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'warn'; children: ReactNode }) {
  return (
    <p className={cn('text-xs', tone === 'ok' ? 'text-teal-deep' : tone === 'warn' ? 'text-amber-deep' : 'text-foreground-3')} role="status">
      {children}
    </p>
  )
}

/** 完整来源里的结构化字段：以等宽文本原样展示，长哈希在容器内换行，不产生页面级横向滚动。 */
export function MetaBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="grid gap-1 rounded-sm border border-border-soft p-3">
      <h4 className="text-xs font-medium text-foreground-2">{title}</h4>
      <pre className="overflow-auto whitespace-pre-wrap break-all rounded-sm bg-dark p-2 font-mono text-[11px] text-on-dark">{JSON.stringify(value, null, 2)}</pre>
    </div>
  )
}
