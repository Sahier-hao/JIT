import { createContext, useContext, type ReactNode } from 'react'

export type ReviewAccountStatus = 'verifying' | 'authenticated' | 'anonymous' | 'failed'

export interface ReviewAccountValue {
  status: ReviewAccountStatus
  account: string | null
  generation: number
}

const DEFAULT: ReviewAccountValue = { status: 'verifying', account: null, generation: 0 }
const ReviewAccountContext = createContext<ReviewAccountValue>(DEFAULT)

export function ReviewAccountProvider({ value, children }: { value: ReviewAccountValue; children: ReactNode }) {
  return <ReviewAccountContext.Provider value={value}>{children}</ReviewAccountContext.Provider>
}

export function useReviewAccount(): ReviewAccountValue {
  return useContext(ReviewAccountContext)
}

export function requireAccount(value: ReviewAccountValue): string {
  if (value.status !== 'authenticated' || !value.account) throw new Error('登录身份尚未确认，不能读取或写入个人工作单')
  return value.account
}

export function canWriteReview(value: ReviewAccountValue): boolean {
  // 重新核验期间仍允许写入“上一次已确认的账户”命名空间；写目标由发起编辑时捕获的账户决定，
  // 若核验发现身份变化，组件按新账户重挂载，迟到写入不会落到新账户。
  return Boolean(value.account)
    && (value.status === 'authenticated' || value.status === 'verifying')
}
