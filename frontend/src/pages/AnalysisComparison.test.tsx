import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AnalysisComparison } from './AnalysisComparison'
import { parseHash, hashFor } from '../navigation'

const REPO='11111111-1111-4111-8111-111111111111', BASE='22222222-2222-4222-8222-222222222222', TARGET='33333333-3333-4333-8333-333333333333'
const source={syncId:BASE,branch:'main',since:null,until:null,commitLimit:500,completedAt:null,headCommit:null,datasetVersion:'base-data',modelId:null,runId:null}
const changed={commitId:'a'.repeat(40),status:'changed',subject:'共同提交',authorName:'作者',epoch:1700000000,baseRisk:.2,targetRisk:.5,riskDelta:.3,featuresChanged:false}
const body={repositoryId:REPO,base:source,target:{...source,syncId:TARGET,branch:'release',datasetVersion:'target-data'},sameModel:false,counts:{added:1,removed:0,changed:21,unchanged:0},total:22,limit:20,offset:0,change:'all',commits:Array.from({length:20},(_,i)=>i?{...changed,commitId:i.toString(16).padStart(40,'0'),subject:`共同提交 ${i}`}:changed),limitations:['分数变化不表示模型效果改善']}
function response(value:unknown) {return new Response(JSON.stringify(value))}
afterEach(()=>vi.restoreAllMocks())

it('opens both exact source analyses and never claims that different-model score changes are improvements', async()=>{
  vi.spyOn(globalThis,'fetch').mockImplementation(async()=>response(body))
  const navigate=vi.fn()
  render(<AnalysisComparison repositoryId={REPO} baseSyncId={BASE} targetSyncId={TARGET} navigate={navigate}/> )
  expect(await screen.findByText('共同提交')).toBeVisible()
  expect(screen.getAllByText('+0.300000')[0]).toBeVisible()
  expect(screen.getByText(/模型身份不同或未记录/)).toBeVisible()
  await userEvent.click(screen.getByRole('button',{name:`查看基准 ${changed.commitId}`}))
  expect(navigate).toHaveBeenCalledWith({name:'analysis',repositoryId:REPO,viewSyncId:BASE,view:'commits',commitId:changed.commitId})
  await userEvent.click(screen.getByRole('button',{name:`查看目标 ${changed.commitId}`}))
  expect(navigate).toHaveBeenLastCalledWith({name:'analysis',repositoryId:REPO,viewSyncId:TARGET,view:'commits',commitId:changed.commitId})
})

it('keeps both pins while changing filters and pages',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{
    const url=new URL(String(input),'http://localhost')
    const offset=Number(url.searchParams.get('offset'))
    const change=url.searchParams.get('change')??'all'
    return response({...body,offset,change,total:change==='changed'?21:22,commits:offset?[{...changed,commitId:'b'.repeat(40),subject:'后页提交'},{...changed,commitId:'c'.repeat(40),subject:'仅目标提交',status:'added',baseRisk:null,targetRisk:.2,riskDelta:null}]:body.commits})
  })
  render(<AnalysisComparison repositoryId={REPO} baseSyncId={BASE} targetSyncId={TARGET} navigate={vi.fn()}/> )
  await screen.findByText('共同提交')
  await userEvent.click(screen.getByRole('button',{name:'下一页'}))
  expect(await screen.findByText('后页提交')).toBeVisible()
  await userEvent.click(screen.getByRole('combobox',{name:'对比筛选'}))
  await userEvent.click(await screen.findByRole('option',{name:'分数或度量变化'}))
  await screen.findByText('共同提交')
  expect(fetch.mock.calls.every(([url])=>String(url).includes(`baseSyncId=${BASE}`)&&String(url).includes(`targetSyncId=${TARGET}`))).toBe(true)
})

it('rejects another analysis response and retries a failed read without changing current results',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>response({...body,target:{...body.target,syncId:BASE}}))
  render(<AnalysisComparison repositoryId={REPO} baseSyncId={BASE} targetSyncId={TARGET} navigate={vi.fn()}/> )
  const button=await screen.findByRole('button',{name:'重新读取对比'})
  expect(screen.queryByText('共同提交')).not.toBeInTheDocument()
  fetch.mockImplementation(async()=>response(body))
  await userEvent.click(button)
  expect(await screen.findByText('共同提交')).toBeVisible()
})

it('round trips the two fixed analysis identities in comparison bookmarks',()=>{
  const hash=`#/projects/${REPO}/compare/${BASE}/${TARGET}`
  expect(parseHash(hash)).toEqual({name:'comparison',repositoryId:REPO,baseSyncId:BASE,targetSyncId:TARGET})
  expect(hashFor(parseHash(hash))).toBe(hash)
})

it('ignores a late result after switching either pinned analysis',async()=>{
  let finish!:(response:Response)=>void
  vi.spyOn(globalThis,'fetch').mockImplementation(async input=>String(input).includes(`targetSyncId=${TARGET}`)
    ?new Promise<Response>(resolve=>{finish=resolve})
    :response({...body,target:{...body.target,syncId:REPO},commits:body.commits.map((row,i)=>i?row:{...row,subject:'新目标提交'})}))
  const view=render(<AnalysisComparison repositoryId={REPO} baseSyncId={BASE} targetSyncId={TARGET} navigate={vi.fn()}/> )
  await waitFor(()=>expect(globalThis.fetch).toHaveBeenCalled())
  view.rerender(<AnalysisComparison repositoryId={REPO} baseSyncId={BASE} targetSyncId={REPO} navigate={vi.fn()}/> )
  expect(await screen.findByText('新目标提交')).toBeVisible()
  finish(response(body))
  await waitFor(()=>expect(screen.queryByText('共同提交')).not.toBeInTheDocument())
})

it('shows registered names from comparison metadata without loading the model catalog',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>response({...body,
    base:{...body.base,modelId:REPO,runId:BASE,modelName:'原逻辑回归'},
    target:{...body.target,modelId:TARGET,runId:TARGET,modelName:'原决策树'}}))
  render(<AnalysisComparison repositoryId={REPO} baseSyncId={BASE} targetSyncId={TARGET} navigate={vi.fn()}/> )
  expect(await screen.findByText('模型：原逻辑回归')).toBeVisible()
  expect(screen.getByText('模型：原决策树')).toBeVisible()
  expect(fetch.mock.calls.every(([url])=>String(url).includes('/comparison?'))).toBe(true)
})
