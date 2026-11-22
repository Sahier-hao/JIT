import { ArrowDown, ArrowRight, GitBranch, Network, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { MethodChoice } from '@/features/models/modelClient'

type Visual = NonNullable<MethodChoice['guide']['visual']>

const BOX = 'rounded-md border border-border-soft bg-card px-3 py-2 text-center text-xs text-foreground-2'
const STRONG = 'rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-center text-xs font-medium text-accent'

function Node({ children, strong = false, className }: { children: ReactNode; strong?: boolean; className?: string }) {
  return <div className={cn(strong ? STRONG : BOX, 'min-w-0 break-words', className)}>{children}</div>
}

function RightArrow() {
  return <ArrowRight aria-hidden="true" className="shrink-0 text-foreground-4" size={16}/>
}

function DownArrow() {
  return <ArrowDown aria-hidden="true" className="justify-self-center text-foreground-4" size={16}/>
}

function Pipeline({ visual, treeStages = false }: { visual: Visual; treeStages?: boolean }) {
  return <div className="flex flex-wrap items-center justify-center gap-2">
    <Node>{visual.input}</Node>
    {visual.stages.map(stage => <div key={stage} className="contents">
      <RightArrow/>
      <Node strong={treeStages && stage.includes('树')}>{stage}</Node>
    </div>)}
    <RightArrow/>
    <Node strong>{visual.output}</Node>
  </div>
}

function TreeDiagram({ visual }: { visual: Visual }) {
  return <div className="grid justify-items-center gap-2">
    <Node>{visual.input}</Node>
    <DownArrow/>
    <Node strong><span className="inline-flex items-center gap-1"><GitBranch aria-hidden="true" size={13}/>根节点：选择特征阈值</span></Node>
    <div className="grid w-full max-w-[620px] gap-2 sm:grid-cols-3">
      {['子节点 A', '子节点 B', '子节点 C'].map((branch, index) => <div key={branch} className="grid gap-2">
        <Node>{`${branch} · ${visual.stages[0]}`}</Node>
        <DownArrow/>
        <Node strong>{visual.output} {index + 1}</Node>
      </div>)}
    </div>
  </div>
}

function ForestDiagram({ visual }: { visual: Visual }) {
  return <div className="grid justify-items-center gap-2">
    <Node>{visual.input}</Node>
    <DownArrow/>
    <div className="grid w-full max-w-[620px] gap-2 sm:grid-cols-3">
      {['样本子集 1', '样本子集 2', '样本子集 3'].map((sample, index) => <div key={sample} className="rounded-md border border-border-soft bg-sunken p-2 text-center">
        <span className="block text-[10px] text-foreground-4">{sample}</span>
        <span className="mt-1 inline-flex items-center gap-1 text-xs text-foreground-2"><GitBranch aria-hidden="true" size={13}/>树 {index + 1}</span>
      </div>)}
    </div>
    <DownArrow/>
    <Node strong>{visual.stages.at(-1) ?? visual.output}</Node>
    <DownArrow/>
    <Node>{visual.output}</Node>
  </div>
}

function ProbabilisticDiagram({ visual }: { visual: Visual }) {
  return <div className="grid justify-items-center gap-2">
    <Node>{visual.input}</Node>
    <div className="grid w-full max-w-[620px] gap-2 sm:grid-cols-3">
      {['特征 1', '特征 2', '特征 N'].map(feature => <div key={feature} className="rounded-md border border-border-soft bg-sunken px-3 py-2 text-center">
        <span className="block text-[10px] text-foreground-4">{feature}</span>
        <span className="mt-1 block font-mono text-[11px] text-foreground-2">μ ± σ</span>
      </div>)}
    </div>
    <DownArrow/>
    <Node><span className="inline-flex items-center gap-1"><Network aria-hidden="true" size={13}/>类别先验 × 逐特征似然</span></Node>
    <DownArrow/>
    <Node strong>{visual.output}</Node>
  </div>
}

function NeuralLayer({ label, count }: { label: string; count: number }) {
  return <div className="grid min-w-20 justify-items-center gap-1">
    <div className="flex min-h-20 flex-wrap items-center justify-center gap-1 rounded-md border border-border-soft bg-sunken p-2">
      {Array.from({ length: count }, (_, index) => <span key={index} className="size-2 rounded-full bg-accent"/>)}
    </div>
    <span className="text-[10px] text-foreground-4">{label}</span>
  </div>
}

function MlpDiagram({ visual }: { visual: Visual }) {
  return <div className="grid justify-items-center gap-3">
    <Node>{visual.input}</Node>
    <DownArrow/>
    <div className="flex flex-wrap items-center justify-center gap-2">
      <NeuralLayer label={visual.stages[0] ?? '输入'} count={6}/>
      <RightArrow/>
      <NeuralLayer label={visual.stages[1] ?? '隐层'} count={8}/>
      <RightArrow/>
      <NeuralLayer label={visual.stages[2] ?? '隐层'} count={5}/>
      <RightArrow/>
      <NeuralLayer label={visual.stages[3] ?? '输出'} count={1}/>
    </div>
    <DownArrow/>
    <Node strong>{visual.output}</Node>
  </div>
}

function ResidualBlock({ label }: { label: string }) {
  return <div className="relative rounded-md border border-accent/30 bg-accent-soft px-4 py-3 text-center text-xs font-medium text-accent">
    {label}
    <span aria-hidden="true" className="absolute -bottom-2 left-3 right-3 border-b border-dashed border-accent/40"/>
  </div>
}

function ResNetDiagram({ visual }: { visual: Visual }) {
  return <div className="grid justify-items-center gap-3 pb-3">
    <Node>{visual.input}</Node>
    <DownArrow/>
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Node>{visual.stages[0] ?? '线性投影'}</Node>
      <RightArrow/>
      <ResidualBlock label={visual.stages[1] ?? '残差块'}/>
      <RightArrow/>
      <ResidualBlock label={visual.stages[2] ?? '残差块'}/>
      <RightArrow/>
      <Node strong>{visual.output}</Node>
    </div>
    <span className="text-[10px] text-foreground-4">虚线表示恒等捷径与残差相加</span>
  </div>
}

function TransformerDiagram({ visual }: { visual: Visual }) {
  return <div className="grid justify-items-center gap-2">
    <div className="grid w-full max-w-[620px] gap-1.5 sm:grid-cols-5">
      {['ns', 'nd', 'nf', 'la', 'ld'].map(token => <div key={token} className="rounded-md border border-border-soft bg-card px-2 py-2 text-center font-mono text-[11px] text-foreground-2">{token}</div>)}
    </div>
    <span className="text-[10px] text-foreground-4">{visual.input}</span>
    <DownArrow/>
    <Node strong>{visual.stages[1] ?? '多头注意力'}</Node>
    <DownArrow/>
    <Node>{visual.stages[2] ?? '前馈层'}</Node>
    <DownArrow/>
    <Node strong>{visual.output}</Node>
  </div>
}

function WideDeepDiagram({ visual }: { visual: Visual }) {
  return <div className="grid justify-items-center gap-3">
    <Node>{visual.input}</Node>
    <DownArrow/>
    <div className="grid w-full max-w-[560px] gap-2 sm:grid-cols-2">
      <div className="grid gap-2"><Node>{visual.stages[0] ?? '线性宽塔'}</Node><DownArrow/><span className="text-center text-[10px] text-foreground-4">直接加权</span></div>
      <div className="grid gap-2"><Node>{visual.stages[1] ?? 'MLP 深塔'}</Node><DownArrow/><span className="text-center text-[10px] text-foreground-4">多层非线性</span></div>
    </div>
    <DownArrow/>
    <Node strong>{visual.stages[2] ?? '并联相加'}</Node>
    <DownArrow/>
    <Node>{visual.output}</Node>
  </div>
}

export function AlgorithmDiagram({ methodName, visual }: { methodName: string; visual: Visual | null }) {
  if (!visual) {
    return <div className="grid min-h-44 place-items-center rounded-lg border border-dashed border-border-soft bg-sunken px-4 text-center text-xs text-foreground-3" role="img" aria-label={`${methodName} 暂无结构图`}>
      方法目录未提供结构信息
    </div>
  }
  const label = `${methodName} 算法结构图：${visual.input}，${visual.stages.join('、')}，输出${visual.output}`
  let diagram: ReactNode
  if (visual.kind === 'tree') diagram = <TreeDiagram visual={visual}/>
  else if (visual.kind === 'forest') diagram = <ForestDiagram visual={visual}/>
  else if (visual.kind === 'probabilistic') diagram = <ProbabilisticDiagram visual={visual}/>
  else if (visual.kind === 'boosting') diagram = <Pipeline visual={visual} treeStages/>
  else if (visual.kind === 'mlp') diagram = <MlpDiagram visual={visual}/>
  else if (visual.kind === 'resnet') diagram = <ResNetDiagram visual={visual}/>
  else if (visual.kind === 'transformer') diagram = <TransformerDiagram visual={visual}/>
  else if (visual.kind === 'wide-deep') diagram = <WideDeepDiagram visual={visual}/>
  else diagram = <Pipeline visual={visual}/>
  return <div className="grid min-w-0 gap-3 rounded-lg border border-border-soft bg-sunken/60 p-4" role="img" aria-label={label}>
    {diagram}
    <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-border-soft pt-3">
      {visual.stages.map(stage => <span key={stage} className="inline-flex items-center gap-1 rounded-md bg-card px-2 py-1 text-[10px] text-foreground-3">
        <Plus aria-hidden="true" size={10}/>{stage}
      </span>)}
    </div>
  </div>
}
