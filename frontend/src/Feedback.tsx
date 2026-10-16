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
  auth: '需要有效的团队凭据',
  permission: '权限不足',
  config: '访问凭据配置无效',
  missing: '没有找到该资源',
  field: '需要修正输入或重新选择',
  model: '模型当前不可用',
  storage: '目录存储不可用',
  unknown: '请求失败',
}

export function LoadingNotice({ label }: { label: string }) {
  return (
    <div className="notice notice-loading" role="status">
      <Icon name="info" size={17} />
      <div>
        <strong>正在读取</strong>
        <span>{label}</span>
      </div>
    </div>
  )
}

export function CredentialNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="notice notice-credential" role="status">
      <Icon name="info" size={17} />
      <div>
        <strong>需要团队凭据</strong>
        <span>
          {children ?? '请在左侧输入团队访问凭据。凭据只保存在本页内存中，刷新后需要重新输入。'}
        </span>
      </div>
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
