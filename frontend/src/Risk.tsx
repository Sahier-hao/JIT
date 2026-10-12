import { riskLabel, validRisk } from './domain'
export function Risk({ risk, large = false }: { risk: unknown; large?: boolean }) {
  return <div className={large ? 'risk-display large' : 'risk-display'}><span className={validRisk(risk) ? 'risk-number' : 'risk-unavailable'}>{riskLabel(risk)}</span>{validRisk(risk) ? <span className="risk-track" aria-hidden="true"><span style={{ width: `${risk * 100}%` }} /></span> : null}</div>
}
