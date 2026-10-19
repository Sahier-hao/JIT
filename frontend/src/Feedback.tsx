/**
 * 新页面共用的状态与错误呈现（MPW-10、MPW-11）。
 *
 * 三类状态必须能被文字区分，而不是只靠颜色：加载中、需要凭据、失败。失败一律展示可公开的
 * 原因与服务端 requestId，字段级错误单独列出。
 */

import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { describeFailure, type FailureKind } from './requestState'

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
    <div className="notice notice-loading" role="status">
      <Icon name="info" size={16} />
      <div>
        {prefix ? <strong>正在读取</strong> : null}
        <span>{label}</span>
        {note === undefined ? null : <span className="notice-note">{note}</span>}
        <div className="skeleton-lines" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span key={index} className="skeleton-line" data-line={index} />
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
    <div className="state-block" data-state={tone} role={tone === 'alert' ? 'alert' : undefined}>
      <h2 className="state-block-title">{title}</h2>
      <p className="state-block-note">{description}</p>
      {children === undefined ? null : <div className="state-block-actions">{children}</div>}
    </div>
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
    <div className="notice notice-failure" role="alert">
      <Icon name="info" size={17} />
      <div>
        <strong>{KIND_TITLES[failure.kind]}</strong>
        <span>{failure.message}</span>
        {failure.details.length > 0 ? (
          <ul className="failure-details">
            {failure.details.map((detail) => (
              <li key={`${detail.field}:${detail.reason}`}>
                <code>{detail.field}</code>
                {detail.reason}
              </li>
            ))}
          </ul>
        ) : null}
        {failure.requestId === '' ? null : (
          <span className="failure-request">
            请求编号 <code>{failure.requestId}</code>
          </span>
        )}
        {children}
        {onRetry === undefined ? null : (
          <div className="notice-actions">
            <button type="button" onClick={onRetry}>
              {retryLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 成功或中性的操作反馈：写操作的结果必须能被文字读到。 */
export function StatusNote({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'warn'; children: ReactNode }) {
  return (
    <p className={`status-note status-${tone}`} role="status">
      {children}
    </p>
  )
}

/** 完整来源里的结构化字段：以等宽文本原样展示，长哈希在容器内换行，不产生页面级横向滚动。 */
export function MetaBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="meta-block">
      <h4>{title}</h4>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  )
}
