import { riskLabel, validRisk } from './domain'
import { cn } from './lib/utils'

/**
 * 风险编码（design D11）：等宽两位小数 + 4px 条 + 60% 刻度 + 分档色。
 *
 * 分档只表达"是否越过 60% 这条可核对的界"，低风险不使用绿色或其他
 * 暗示"已确认无缺陷"的颜色（IP-06 / CRR-03）。
 */
export function Risk({ risk, large = false }: { risk: unknown; large?: boolean }) {
  const valid = validRisk(risk)
  const high = valid && risk >= 0.6

  return (
    <div className={cn('risk-display flex items-center gap-2', large && 'gap-2.5')} data-tier={valid ? (high ? 'high' : 'low') : 'none'}>
      <span className={cn(valid ? 'risk-number' : 'risk-unavailable', 'font-mono tabular-nums', large ? 'text-base' : 'text-xs', valid ? 'text-foreground' : 'text-foreground-4')}>{riskLabel(risk)}</span>
      {valid ? (
        <span className="risk-track relative h-1 w-12 overflow-hidden rounded-full bg-strong" aria-hidden="true">
          <span className={cn('risk-fill block h-full rounded-full', high ? 'bg-rose' : 'bg-amber')} style={{ width: `${risk * 100}%` }} />
          <i className="risk-tick absolute left-[60%] top-0 h-full w-px bg-border-strong" />
        </span>
      ) : null}
    </div>
  )
}
