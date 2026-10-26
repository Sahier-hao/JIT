import { apiRequest } from './apiClient'
import { contractFailed, finiteNumber, flag, record, recordList, riskNumber, text, textList, textOrNull, uuidText } from './apiContract'

export type ChangeKind='added'|'removed'|'changed'|'unchanged'
export type ComparisonFilter='all'|ChangeKind
export interface ComparisonIdentity {repositoryId:string;baseSyncId:string;targetSyncId:string}
export interface ComparedSource {syncId:string;branch:string;since:string|null;until:string|null;commitLimit:number|null;completedAt:string|null;headCommit:string|null;datasetVersion:string|null;modelId:string|null;runId:string|null;modelName:string|null}
export interface ComparedCommit {commitId:string;status:ChangeKind;subject:string|null;authorName:string|null;epoch:number;baseRisk:number|null;targetRisk:number|null;riskDelta:number|null;featuresChanged:boolean}
export interface Comparison {repositoryId:string;base:ComparedSource;target:ComparedSource;sameModel:boolean;counts:Record<ChangeKind,number>;total:number;limit:number;offset:number;change:ComparisonFilter;commits:ComparedCommit[];limitations:string[]}
const KINDS:ChangeKind[]=['added','removed','changed','unchanged']
function count(value:unknown):number {const number=finiteNumber(value);if(!Number.isSafeInteger(number)||number<0)contractFailed();return number}
function parseSource(value:unknown):ComparedSource {
  const row=record(value)
  return {syncId:uuidText(row.syncId),branch:text(row.branch),since:textOrNull(row.since),until:textOrNull(row.until),commitLimit:row.commitLimit==null?null:count(row.commitLimit),completedAt:textOrNull(row.completedAt),headCommit:textOrNull(row.headCommit),datasetVersion:textOrNull(row.datasetVersion),modelId:textOrNull(row.modelId),runId:textOrNull(row.runId),modelName:textOrNull(row.modelName)}
}
export function parseComparison(value:unknown,identity:ComparisonIdentity,change:ComparisonFilter,offset:number):Comparison {
  const raw=record(value),base=parseSource(raw.base),target=parseSource(raw.target)
  if(uuidText(raw.repositoryId)!==identity.repositoryId||base.syncId!==identity.baseSyncId||target.syncId!==identity.targetSyncId||raw.change!==change||raw.offset!==offset||raw.limit!==20)contractFailed('对比来源或查询上下文不一致')
  const sourceCounts=record(raw.counts),counts=Object.fromEntries(KINDS.map(kind=>[kind,count(sourceCounts[kind])])) as Record<ChangeKind,number>
  const total=count(raw.total),limit=count(raw.limit)
  if(total!==(change==='all'?Object.values(counts).reduce((a,b)=>a+b,0):counts[change]))contractFailed('对比计数不一致')
  const commits=recordList(raw.commits).map(row=>{
    const status=text(row.status) as ChangeKind
    if(!KINDS.includes(status)||(change!=='all'&&status!==change))contractFailed()
    const baseRisk=row.baseRisk===null?null:riskNumber(row.baseRisk),targetRisk=row.targetRisk===null?null:riskNumber(row.targetRisk)
    const riskDelta=row.riskDelta===null?null:finiteNumber(row.riskDelta)
    if(status==='added'?(baseRisk!==null||targetRisk===null||riskDelta!==null):status==='removed'?(baseRisk===null||targetRisk!==null||riskDelta!==null):(baseRisk===null||targetRisk===null||riskDelta===null||Math.abs(targetRisk-baseRisk-riskDelta)>1e-8))contractFailed('对比分数不一致')
    return {commitId:text(row.commitId),status,subject:textOrNull(row.subject),authorName:textOrNull(row.authorName),epoch:finiteNumber(row.epoch),baseRisk,targetRisk,riskDelta,featuresChanged:flag(row.featuresChanged)}
  })
  if(commits.length!==Math.min(limit,Math.max(0,total-offset))||new Set(commits.map(row=>row.commitId)).size!==commits.length)contractFailed('对比条目数量或身份不一致')
  const sameModel=flag(raw.sameModel)
  if(sameModel&&(!base.modelId||!base.runId||base.modelId!==target.modelId||base.runId!==target.runId))contractFailed('对比模型身份不一致')
  return {repositoryId:identity.repositoryId,base,target,sameModel,counts,total,limit,offset,change,commits,limitations:textList(raw.limitations)}
}
export async function fetchComparison(identity:ComparisonIdentity,change:ComparisonFilter,offset:number,signal:AbortSignal):Promise<Comparison> {
  const params=new URLSearchParams({baseSyncId:identity.baseSyncId,targetSyncId:identity.targetSyncId,change,offset:String(offset),limit:'20'})
  const value=await apiRequest({path:`/api/v1/repositories/${encodeURIComponent(identity.repositoryId)}/comparison?${params}`,method:'GET',signal})
  return parseComparison(value,identity,change,offset)
}
