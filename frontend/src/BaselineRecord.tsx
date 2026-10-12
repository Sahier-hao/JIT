import { displayTime, type Dataset, type Score } from './domain'

function Metric({ name, score }: { name: string; score: Score }) {
  return <div className="baseline-metric"><dt>{name}</dt><dd>{score.value === null ? `无法计算：${score.reason}` : score.value.toFixed(4)}</dd></div>
}
export function BaselineRecord({ data }: { data: Dataset }) {
  const s = data.summary
  if (data.mode !== 'historical' || !s) return null
  const m = s.metrics
  return <details className="baseline-record"><summary aria-label="基线记录">基线记录<span>固定测试批次 · 六字段 · 回顾性评价</span></summary>
    <section role="region" aria-label="基线记录" className="baseline-content">
      <div className="baseline-columns">
        <div><h2>数据与运行</h2><p><a href={s.source.url} target="_blank" rel="noreferrer">{s.source.publisher}</a></p><p>{s.source.citation}</p>
          <dl className="baseline-identities"><dt>数据版本</dt><dd><code>{s.datasetVersion}</code></dd><dt>运行标识</dt><dd><code>{s.runId}</code></dd><dt>模型</dt><dd>{data.model?.name} / {data.model?.id}</dd><dt>模型 SHA-256</dt><dd><code>{s.modelSha256}</code></dd><dt>发布版本</dt><dd><code>{s.source.revision}</code></dd></dl>
          {Object.entries(s.source.files).map(([name, file]) => <p className="source-file" key={name}><a href={file.url} target="_blank" rel="noreferrer">{name}</a><code>{file.sha256}</code></p>)}
          <p>字段：<code>{s.features.join(', ')}</code>，发布者原生度量，尚非完整 Kamei14。</p><p>{s.source.labelRule}</p>
          <p>原始 {s.source.quality.rawRows.toLocaleString()} 条 → 纳入 {s.source.quality.includedRows.toLocaleString()} 条；空标签计数 {s.source.quality.blankLabels.toLocaleString()} 条。</p>
          <p>纳入：{s.cohort.startEpochInclusive} ≤ UTC秒 &lt; {s.cohort.endEpochExclusive}；la &gt; {s.cohort.addedLinesGreaterThan}；la+ld ≤ {s.cohort.maxChurnInclusive}；nf ≤ {s.cohort.maxFilesInclusive}。</p>
          <p>排除：{Object.entries(s.source.quality.excluded).map(([name, n]) => `${name}=${n}`).join('；')}。</p>
        </div>
        <div><h2>完整冻结测试批次 · {s.split.test.count.toLocaleString()} 条测试提交</h2><p>指标不随搜索、筛选或个人清单重算。固定 p ≥ {s.threshold}；风险是模型估计，未经概率校准。</p>
          <dl className="baseline-scores"><Metric name="ROC-AUC" score={m.rocAuc} /><Metric name="Average Precision (AP)" score={m.averagePrecision} /><Metric name="Precision" score={m.precision} /><Metric name="Recall" score={m.recall} /><Metric name="F1" score={m.f1} /><Metric name="Recall@20%LOC (risk-ranked)" score={m.recall20Loc} /></dl>
          <p>TP {m.confusion.tp} / FP {m.confusion.fp} / TN {m.confusion.tn} / FN {m.confusion.fn}；正标签 {m.counts.positive}、负标签 {m.counts.negative}。</p>
          <p>LOC=la+ld；风险降序→时间降序→ID升序，整条提交纳入、下一条超预算即停止。总 LOC {m.effort.totalLoc.toLocaleString()}，20%预算 {m.effort.budgetLoc.toLocaleString()}，实际 {m.effort.usedLoc.toLocaleString()}，入选 {m.effort.selectedCount} 条。</p>
          <p>AP 无信息参考 {m.reference.apNoInformation.toFixed(4)}；全负预测参考（不属于第二个训练模型）：</p>
          <dl className="baseline-scores reference-scores"><Metric name="全负 Precision" score={m.reference.allNegative.precision} /><Metric name="全负 Recall" score={m.reference.allNegative.recall} /><Metric name="全负 F1" score={m.reference.allNegative.f1} /></dl>
          <p>全负参考 TP {m.reference.allNegative.confusion.tp} / FP {m.reference.allNegative.confusion.fp} / TN {m.reference.allNegative.confusion.tn} / FN {m.reference.allNegative.confusion.fn}。</p>
          <dl className="baseline-partitions">{Object.entries(s.split).map(([name, part]) => <div key={name}><dt>{name} · {part.count.toLocaleString()} 条 / 正 {part.positiveCount}</dt><dd>{displayTime(part.start)} — {displayTime(part.end)} (UTC+08:00)</dd></div>)}</dl>
        </div>
      </div>
      <div className="baseline-limits"><h2>证据与适用范围</h2><ul>{s.limitations.map(line => <li key={line}>{line}</li>)}</ul><p>预测解释未提供。当前为公开历史测试集回放，未验证历史当时标签可获得性，不代表在线仓库预测或完整课程验收。</p></div>
    </section>
  </details>
}
