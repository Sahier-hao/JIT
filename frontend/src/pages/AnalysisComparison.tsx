import { Icon } from '../Icon'
import { Button, Select } from '../ui/controls'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/layout'
import { useEffect, useState } from 'react'
import { fetchComparison, type Comparison, type ComparisonFilter, type ComparedSource, type ComparisonIdentity } from '../analysisComparison'
import type { Route } from '../navigation'
import { displayTime } from '../domain'
import { EmptyState, LoadingNotice } from '../Feedback'

const LABELS={added:'仅目标分析',removed:'仅基准分析',changed:'分数或度量变化',unchanged:'分数与度量一致'}
function Source({title,source}:{title:string;source:ComparedSource}) {
  const modelName=source.modelName
  return <section className="grid gap-1.5 rounded-md border border-border-soft bg-card p-card"><h2 className="text-base font-semibold text-foreground">{title}</h2><p className="text-xs text-foreground-3">{source.branch} 分支 · {source.completedAt?displayTime(source.completedAt):'完成时间未记录'}</p><p className="text-xs text-foreground-3">模型：{modelName??(source.modelId?'已保存模型（名称暂不可用）':'未记录')}</p><p className="text-xs text-foreground-4">{source.since?displayTime(source.since):'未记录起点'} 至 {source.until?displayTime(source.until):'未记录终点'}（不含结束时间） · 上限 {source.commitLimit??'未记录'}</p><details className="rounded-sm border border-border-soft"><summary className="cursor-pointer px-2.5 py-1.5 text-xs text-foreground-2">完整来源</summary><dl className="grid gap-1 border-t border-border-soft p-2.5 text-xs [&>div]:grid [&>div]:grid-cols-[56px_minmax(0,1fr)] [&>div]:gap-2 [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">{([['分析',source.syncId],['模型',source.modelId],['运行',source.runId],['数据',source.datasetVersion],['HEAD',source.headCommit]] as const).map(([name,value])=><div key={name}><dt>{name}</dt><dd><code className="font-mono">{value??'未记录'}</code></dd></div>)}</dl></details></section>
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
  return <section className="grid gap-4">
    <Button aria-label="返回项目" variant="ghost" size="sm" className="justify-self-start" icon={<Icon name="arrowLeft" size={15}/>} onClick={()=>navigate({name:'repository',repositoryId})}>返回项目</Button>
    <header className="grid gap-1 border-b border-border-soft pb-3"><h1 className="font-sans text-xl font-semibold leading-title text-foreground">分析对比</h1><p className="text-sm leading-body text-foreground-3">对照两次已保存的分析，查看覆盖范围与提交分数。</p></header>
    {current?.error?<EmptyState title="对比读取失败" description={current.error} tone="alert"><Button onClick={()=>{setState({key:''});setAttempt(value=>value+1)}}>重新读取对比</Button></EmptyState>:!data?<LoadingNotice label="正在读取两次固定分析"/>:<>
      <div className="grid gap-3 sm:grid-cols-2"><Source title="基准分析" source={data.base}/><Source title="目标分析" source={data.target}/></div>
      {!data.sameModel?<p className="text-xs text-amber-deep" role="status">模型身份不同或未记录，分数只作来源对照，不能据此判断模型优劣或风险改善。</p>:<p className="text-xs text-foreground-3">两侧使用同一已保存模型及运行；度量和覆盖变化仍需分别核对。</p>}
      {data.limitations.map(note=><p className="text-xs text-foreground-3" key={note}>{note}</p>)}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-3">{Object.entries(LABELS).map(([kind,label])=><span key={kind}>{label} <b className="text-foreground">{data.counts[kind as keyof typeof LABELS]}</b></span>)}</div>
    </>}
    <label className="flex items-center gap-2 text-xs text-foreground-3">对比筛选<Select aria-label="对比筛选" size="sm" value={query.change} onChange={change=>setQuery({change:change as ComparisonFilter,offset:0})} options={[{value:'all',label:'全部提交'},...Object.entries(LABELS).map(([key,label])=>({value:key,label}))]} style={{width:140}} /></label>
    {data?data.commits.length?<>
      <Table>
        <caption className="sr-only">固定分析的提交分数与覆盖对照</caption>
        <TableHead><TableRow><TableHeaderCell>提交 / 覆盖</TableHeaderCell><TableHeaderCell>基准分数</TableHeaderCell><TableHeaderCell>目标分数</TableHeaderCell><TableHeaderCell>分数变化</TableHeaderCell><TableHeaderCell>打开原结果</TableHeaderCell></TableRow></TableHead>
        <TableBody>{data.commits.map(row=><TableRow key={row.commitId}>
          <TableCell><strong className="block truncate text-sm font-medium text-foreground">{row.subject||row.commitId.slice(0,12)}</strong><p className="mt-0.5 text-xs text-foreground-3"><code className="font-mono">{row.commitId.slice(0,12)}</code> · {LABELS[row.status]}{row.featuresChanged?' · 度量已变':''}</p></TableCell>
          <TableCell numeric>{row.baseRisk?.toFixed(6)??'—'}</TableCell>
          <TableCell numeric>{row.targetRisk?.toFixed(6)??'—'}</TableCell>
          <TableCell numeric>{delta(row.riskDelta)}</TableCell>
          <TableCell>{row.baseRisk!==null?<Button variant="link" size="sm" aria-label={`查看基准 ${row.commitId}`} onClick={()=>open(baseSyncId,row.commitId)}>基准</Button>:null}{row.targetRisk!==null?<Button variant="link" size="sm" aria-label={`查看目标 ${row.commitId}`} onClick={()=>open(targetSyncId,row.commitId)}>目标</Button>:null}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
      <nav className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-3" aria-label="对比分页"><span>第 {query.offset+1}–{Math.min(query.offset+20,data.total)} 条，共 {data.total} 条</span><span className="flex gap-2"><Button size="sm" disabled={query.offset===0} onClick={()=>setQuery({...query,offset:Math.max(0,query.offset-20)})}>上一页</Button><Button size="sm" disabled={query.offset+20>=data.total} onClick={()=>setQuery({...query,offset:query.offset+20})}>下一页</Button></span></nav>
    </>:<EmptyState title="该筛选下没有提交" description="选择其他覆盖类型查看这两次分析。"/>:null}
  </section>
}
