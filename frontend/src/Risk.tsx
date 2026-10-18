import { riskLabel, validRisk } from './domain'

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
    <div className={large ? 'risk-display large' : 'risk-display'} data-tier={valid ? (high ? 'high' : 'low') : 'none'}>
      <span className={valid ? 'risk-number' : 'risk-unavailable'}>{riskLabel(risk)}</span>
      {valid ? (
        <span className="risk-track" aria-hidden="true">
          <span className="risk-fill" style={{ width: `${risk * 100}%` }} />
          <i className="risk-tick" />
        </span>
      ) : null}
    </div>
  )
}
