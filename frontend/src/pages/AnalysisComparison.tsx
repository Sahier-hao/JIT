import { useEffect, useState } from 'react'
import { fetchComparison, type Comparison, type ComparisonFilter, type ComparedSource, type ComparisonIdentity } from '../analysisComparison'
import type { Route } from '../navigation'
import { displayTime } from '../domain'
import { EmptyState, LoadingNotice } from '../Feedback'
import './analysis-comparison.css'

const LABELS={added:'仅目标分析',removed:'仅基准分析',changed:'分数或度量变化',unchanged:'分数与度量一致'}
function Source({title,source}:{title:string;source:ComparedSource}) {
  const modelName=source.modelName
  return <section className="comparison-source"><h2>{title}</h2><p>{source.branch} 分支 · {source.completedAt?displayTime(source.completedAt):'完成时间未记录'}</p><p>模型：{modelName??(source.modelId?'已保存模型（名称暂不可用）':'未记录')}</p><p className="muted">{source.since?displayTime(source.since):'未记录起点'} 至 {source.until?displayTime(source.until):'未记录终点'}（不含结束时间） · 上限 {source.commitLimit??'未记录'}</p><details><summary>完整来源</summary><dl>{[['分析',source.syncId],['模型',source.modelId],['运行',source.runId],['数据',source.datasetVersion],['HEAD',source.headCommit]].map(([name,value])=><div key={name}><dt>{name}</dt><dd><code>{value??'未记录'}</code></dd></div>)}</dl></details></section>
}
function delta(value:number|null) {return value===null?'—':value!==0&&Math.abs(value)<.000001?'绝对变化 <0.000001':`${value>0?'+':''}${value.toFixed(6)}`}
export function AnalysisComparison({repositoryId,baseSyncId,targetSyncId,navigate}:ComparisonIdentity & {navigate:(route:Route)=>void}) {
  const [query,setQuery]=useState<{change:ComparisonFilter;offset:number}>({change:'all',offset:0})
  const [attempt,setAttempt]=useState(0)
  const [state,setState]=useState<{key:string;data?:Comparison;error?:string}>({key:''})
  const key=JSON.stringify([repositoryId,baseSyncId,targetSyncId,query.change,query.offset])
  useEffect(()=>{
    const controller=new AbortController()
    fetchComparison({repositoryId,baseSyncId,targetSyncId},query.change,query.offset,controller.signal)
      .then(data=>{if(!controller.signal.aborted)setState({key,data})})
      .catch((error:unknown)=>{if(!controller.signal.aborted)setState({key,error:error instanceof Error?error.message:'对比读取失败'})})
    return ()=>controller.abort()
  },[repositoryId,baseSyncId,targetSyncId,query.change,query.offset,key,attempt])
  const current=state.key===key?state:undefined, data=current?.data
  function open(syncId:string,commitId:string) {navigate({name:'analysis',repositoryId,viewSyncId:syncId,view:'commits',commitId})}
  return <section className="analysis-comparison">
    <button className="back-link" onClick={()=>navigate({name:'repository',repositoryId})}>返回项目</button>
    <header className="page-heading"><div><h1>分析对比</h1><p className="page-intro">对照两次已保存的分析，查看覆盖范围与提交分数。</p></div></header>
    {current?.error?<EmptyState title="对比读取失败" description={current.error} tone="alert"><button onClick={()=>{setState({key:''});setAttempt(value=>value+1)}}>重新读取对比</button></EmptyState>:!data?<LoadingNotice label="正在读取两次固定分析"/>:<>
      <div className="comparison-sources"><Source title="基准分析" source={data.base}/><Source title="目标分析" source={data.target}/></div>
      {!data.sameModel?<p className="warning" role="status">模型身份不同或未记录，分数只作来源对照，不能据此判断模型优劣或风险改善。</p>:<p className="muted">两侧使用同一已保存模型及运行；度量和覆盖变化仍需分别核对。</p>}
      {data.limitations.map(note=><p className="muted" key={note}>{note}</p>)}
      <div className="comparison-counts">{Object.entries(LABELS).map(([kind,label])=><span key={kind}>{label} <b>{data.counts[kind as keyof typeof LABELS]}</b></span>)}</div>
    </>}
    <label className="comparison-filter">对比筛选<select aria-label="对比筛选" value={query.change} onChange={event=>setQuery({change:event.target.value as ComparisonFilter,offset:0})}><option value="all">全部提交</option>{Object.entries(LABELS).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
    {data?data.commits.length?<><div className="comparison-scroll"><table><caption className="sr-only">固定分析的提交分数与覆盖对照</caption><thead><tr><th>提交 / 覆盖</th><th>基准分数</th><th>目标分数</th><th>分数变化</th><th>打开原结果</th></tr></thead><tbody>{data.commits.map(row=><tr key={row.commitId}><td><strong>{row.subject||row.commitId.slice(0,12)}</strong><p><code>{row.commitId.slice(0,12)}</code> · {LABELS[row.status]}{row.featuresChanged?' · 度量已变':''}</p></td><td>{row.baseRisk?.toFixed(6)??'—'}</td><td>{row.targetRisk?.toFixed(6)??'—'}</td><td>{delta(row.riskDelta)}</td><td>{row.baseRisk!==null?<button className="text-button" aria-label={`查看基准 ${row.commitId}`} onClick={()=>open(baseSyncId,row.commitId)}>基准</button>:null}{row.targetRisk!==null?<button className="text-button" aria-label={`查看目标 ${row.commitId}`} onClick={()=>open(targetSyncId,row.commitId)}>目标</button>:null}</td></tr>)}</tbody></table></div><nav className="pager" aria-label="对比分页"><span>第 {query.offset+1}–{Math.min(query.offset+20,data.total)} 条，共 {data.total} 条</span><button disabled={query.offset===0} onClick={()=>setQuery({...query,offset:Math.max(0,query.offset-20)})}>上一页</button><button disabled={query.offset+20>=data.total} onClick={()=>setQuery({...query,offset:query.offset+20})}>下一页</button></nav></>:<EmptyState title="该筛选下没有提交" description="选择其他覆盖类型查看这两次分析。"/>:null}
  </section>
}
