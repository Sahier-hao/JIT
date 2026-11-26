import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { analyzePRCandidates, getPRCandidates, type PRCandidates } from '@/features/reviews/prReviewClient'
import { useReviewAccount } from '@/features/reviews/reviewAccount'

const reasons: Record<string, string> = {
  'unsupported-language': '仅支持 Python 检查',
  'parse-failed': 'Python 源码解析失败',
  'incomplete-content': '源码超出检查范围',
  absent: '目标版本没有此文件',
  PR_CONTENT_UNAVAILABLE: '文件内容不可读取',
  PR_SOURCE_UNAVAILABLE: '源码暂时不可访问',
}

export function usePRCandidateChecks(snapshotId: string) {
  const account = useReviewAccount()
  const client = useQueryClient()
  const queryKey = ['pr-file-checks', account.account, account.generation, snapshotId] as const
  const saved = useQuery({
    queryKey,
    queryFn: ({ signal }) => getPRCandidates(snapshotId, signal),
    enabled: Boolean(snapshotId),
    retry: false,
  })
  const check = useMutation({
    mutationFn: ({ key, path }: { key: typeof queryKey; path: string }) => analyzePRCandidates(key[3], [path]),
    onSuccess: async (result, { key, path }) => {
      await client.cancelQueries({ queryKey: key, exact: true })
      client.setQueryData<PRCandidates>(key, previous => {
        if (!previous || !result.coverage) return result
        const keep = (item: { path: string; side: string }) => item.path !== path || item.side !== 'head'
        return {
          ...result,
          candidates: [...previous.candidates.filter(keep), ...result.candidates],
          coverage: {
            ...result.coverage,
            files: [...(previous.coverage?.files ?? []).filter(keep), ...result.coverage.files],
          },
        }
      })
      void client.invalidateQueries({ queryKey: key, exact: true })
    },
  })
  // The mutation observer can still report the previous file after a snapshot switch.
  const currentCheck = check.variables?.key[3] === snapshotId && check.variables.key[2] === account.generation
    ? check.variables.path : undefined

  function fileResult(path: string) {
    const coverage = saved.data?.coverage?.files.find(item => item.path === path && item.side === 'head')
    const candidates = saved.data?.candidates.filter(item => item.path === path && item.side === 'head') ?? []
    const lines = new Set(candidates.map(item => item.line)).size
    const reason = coverage?.reason
    const label = currentCheck === path && check.isPending ? '正在检查'
      : reason ? '未覆盖'
      : lines ? `${lines} 处可疑`
      : coverage ? '无规则命中' : ''
    return {
      candidates, label,
      reason: reason ? reasons[reason] ?? '源码暂时无法检查' : undefined,
      ruleSet: saved.data?.ruleSet ?? null,
    }
  }

  return {
    fileResult,
    canCheck: Boolean(snapshotId) && !(currentCheck && check.isPending),
    run: (path: string) => check.mutate({ key: queryKey, path }),
    error: (path: string) => currentCheck === path && check.error ? check.error : saved.error,
  }
}

export type PRCandidateChecks = ReturnType<typeof usePRCandidateChecks>
