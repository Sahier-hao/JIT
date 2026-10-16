/**
 * 团队凭据的应用内存上下文（MPW-02、design D2）。
 *
 * 只有 React 状态：不写 localStorage／sessionStorage、不写进 URL、不进入日志或任何导出。
 * 每次设置或清除都会递增 `generation`，页面据此丢弃在途响应、清空受保护缓存与未提交表单。
 *
 * 草稿与已确认凭据刻意分成两个上下文：草稿每敲一个字符都会变，如果和 `generation` 放在同一个
 * 上下文里，整个应用（包含历史回放的长列表）都会随每次按键重新渲染。分开之后，只有凭据面板
 * 会随草稿重渲染，而依赖凭据的页面只在凭据真正更换时更新。
 */

import { createContext, useContext } from 'react'

export interface CredentialSnapshot {
  token: string
  generation: number
}

export interface CredentialState extends CredentialSnapshot {
  setToken: (value: string) => void
  clear: () => void
}

export interface CredentialDraftState {
  /**
   * 尚未确认的输入草稿。它与凭据本身一样只存在于内存，但必须由应用级提供者持有：
   * 侧栏可能随数据模式切换被重新挂载，草稿若放在面板局部状态里，用户刚键入的内容会被静默丢弃。
   */
  draft: string
  setDraft: (value: string) => void
}

export const CredentialContext = createContext<CredentialState | null>(null)
export const CredentialDraftContext = createContext<CredentialDraftState | null>(null)

export function useCredential(): CredentialState {
  const value = useContext(CredentialContext)
  if (value === null) throw new Error('useCredential 必须在 CredentialProvider 内使用')
  return value
}

export function useCredentialDraft(): CredentialDraftState {
  const value = useContext(CredentialDraftContext)
  if (value === null) throw new Error('useCredentialDraft 必须在 CredentialProvider 内使用')
  return value
}
