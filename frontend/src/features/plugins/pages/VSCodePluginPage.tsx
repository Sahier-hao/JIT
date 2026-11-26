import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CheckCircle2, Clipboard, CodeXml, FileCheck2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

const REPORT_COMMAND = `cd backend
./.venv/Scripts/python.exe -m jit_baseline.cli pr-check-analyze \\
  --repo ../ --base <base-sha> --head <head-sha> --model-id <真实模型 ID> \\
  --database <目录库> --artifact-root <模型产物根目录> \\
  --output ../report.json --markdown ../report.md`

const INSTALL_COMMAND = `cd vscode-extension
npm install
npm run package
code --install-extension jit-commit-analysis-0.2.0.vsix`

function CommandBlock({ title, value }: { title: string; value: string }) {
  const [status, setStatus] = useState('')
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setStatus('命令已复制')
    } catch {
      setStatus('自动复制不可用，请手动选择命令')
    }
  }
  return <section className="grid gap-2 rounded-lg border border-border-soft bg-card p-4" aria-label={title}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
        <Clipboard aria-hidden="true"/>复制命令
      </Button>
    </div>
    <pre className="overflow-x-auto rounded-md bg-sunken p-3 font-mono text-[11px] leading-5 text-foreground-2"><code>{value}</code></pre>
    {status ? <p role="status" className="text-xs text-foreground-3">{status}</p> : null}
  </section>
}

const STATES = [
  ['匹配', '仓库、HEAD 和工作树身份一致', '可打开提交或候选行'],
  ['工作树有改动', '报告与 HEAD 一致，但存在未提交内容', '按文件核对，改动文件不跳转'],
  ['提交过期', '报告目标 SHA 与当前 HEAD 不同', '切回原提交或重新生成报告'],
  ['Git 状态未知', '无法读取当前 HEAD 或工作树', '只读展示，拒绝定位'],
  ['文件或行无效', '路径不存在、行号越界或文件已删除', '在 GitHub 核对原快照'],
] as const

export function VSCodePluginPage() {
  return <section className="grid gap-5">
    <WorkspacePageHeader title="IDE 插件" meta={<span>VS Code · 报告版本 jit-commit-analysis-v1</span>}/>

    <section className="grid gap-4 rounded-xl border border-border-soft bg-card p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid content-start gap-3">
        <span className="w-fit rounded-full border border-border-strong px-2.5 py-1 text-xs font-medium text-foreground-2">只读交接</span>
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">把提交级风险带进 VS Code，再从证据回到代码行</h2>
          <p className="mt-2 max-w-[760px] text-sm leading-6 text-foreground-3">
            JIT Commit Analysis 只导入已经生成的报告。扩展核对仓库、提交和工作树身份后展示风险、候选与建议；不执行命令、不访问网络、不修改源码。
          </p>
        </div>
        <ul className="grid gap-2 text-sm text-foreground-2 sm:grid-cols-2">
          <li className="flex items-center gap-2"><CheckCircle2 aria-hidden="true" className="text-teal-deep"/><span>报告来自固定提交范围</span></li>
          <li className="flex items-center gap-2"><CheckCircle2 aria-hidden="true" className="text-teal-deep"/><span>显式导入与身份核对</span></li>
          <li className="flex items-center gap-2"><CheckCircle2 aria-hidden="true" className="text-teal-deep"/><span>候选可跳转到原文件行</span></li>
          <li className="flex items-center gap-2"><ShieldCheck aria-hidden="true" className="text-teal-deep"/><span>不自动修复、不评论 PR</span></li>
        </ul>
      </div>
      <div className="grid content-center gap-3 rounded-lg border border-border-soft bg-sunken p-4" aria-label="IDE 交接示意">
        <div className="flex items-center gap-2 text-sm font-medium"><CodeXml aria-hidden="true" className="text-accent"/>VS Code 工作区</div>
        <div className="grid gap-2">
          {[
            ['报告身份', 'match'],
            ['提交风险', '已读取'],
            ['候选与建议', '只读展示'],
          ].map(([label, value]) => <div key={label} className="flex items-center justify-between rounded-md border border-border-soft bg-card px-3 py-2 text-xs">
            <span className="text-foreground-3">{label}</span><strong className="font-mono text-foreground">{value}</strong>
          </div>)}
        </div>
        <p className="text-[11px] leading-4 text-foreground-4">这是交接流程示意，不声称已经替代真实 VS Code 扩展宿主验收。</p>
      </div>
    </section>

    <section className="grid gap-3" aria-labelledby="plugin-workflow">
      <h2 id="plugin-workflow" className="text-base font-semibold">从报告到代码行</h2>
      <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['1', '生成报告', '在 Web 或 CI 中为固定 base/head 运行 pr-check-analyze。'],
          ['2', '取得产物', '下载并解压 jit-commit-analysis-v1 JSON，不使用失败的替代报告。'],
          ['3', '显式导入', '在扩展视图选择报告；扩展只读取文件，不执行报告内容。'],
          ['4', '核对后定位', '身份一致才打开提交或候选；过期、改动或越界时拒绝定位。'],
        ].map(([step, title, body]) => <li key={step} className="grid content-start gap-1.5 rounded-lg border border-border-soft bg-card p-3">
          <span className="grid size-7 place-items-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent">{step}</span>
          <strong className="text-sm">{title}</strong><p className="text-xs leading-5 text-foreground-3">{body}</p>
        </li>)}
      </ol>
    </section>

    <div className="grid gap-3 lg:grid-cols-2">
      <CommandBlock title="生成提交分析报告" value={REPORT_COMMAND}/>
      <CommandBlock title="本地构建并安装扩展" value={INSTALL_COMMAND}/>
    </div>

    <figure className="overflow-hidden rounded-lg border border-border-soft bg-card">
      <img src="/evidence/vscode-extension-host.png" alt="VS Code Extension Development Host 冒烟运行截图"
        className="aspect-[16/9] w-full object-cover object-left-top" loading="lazy"/>
      <figcaption className="border-t border-border-soft px-4 py-2 text-xs leading-5 text-foreground-3">
        扩展宿主冒烟截图：证明隔离工作区和 Extension Development Host 能实际启动。该截图不替代完整报告导入、候选定位与文件变化的人工 GUI 巡览。
      </figcaption>
    </figure>

    <section className="flex items-start gap-2 rounded-lg border border-amber-deep/20 bg-amber-soft/50 p-3 text-xs leading-5 text-amber-deep" role="note">
      <TriangleAlert aria-hidden="true" className="mt-0.5 shrink-0"/><p>本页不提供稳定 VSIX 下载。请从本地构建产物或已核对的 CI artifact 安装，并确认包版本与当前交付一致。</p>
    </section>

    <section className="grid gap-3" aria-labelledby="plugin-states">
      <div>
        <h2 id="plugin-states" className="text-base font-semibold">身份与定位状态</h2>
        <p className="mt-1 text-xs leading-5 text-foreground-3">不能定位不是“没有问题”，而是当前报告不能安全对应到这份代码。</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-soft bg-card">
        <Table>
          <TableHeader><TableRow><TableHead scope="col">状态</TableHead><TableHead scope="col">含义</TableHead><TableHead scope="col">下一步</TableHead></TableRow></TableHeader>
          <TableBody>{STATES.map(([state, meaning, next]) => <TableRow key={state}>
            <TableHead scope="row">{state}</TableHead><TableCell>{meaning}</TableCell><TableCell>{next}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>
    </section>

    <section className="grid gap-3 rounded-lg border border-border-soft bg-sunken p-4 sm:grid-cols-2">
      <div><h2 className="flex items-center gap-2 text-sm font-medium"><FileCheck2 aria-hidden="true" className="text-accent"/>当前交付范围</h2>
        <p className="mt-2 text-xs leading-5 text-foreground-3">VS Code 扩展已交付：导入、身份核对、提交/候选展示、位置跳转和命令复制。Eclipse 与 Visual Studio 仍是可行性调研，不冒充可用插件。</p>
      </div>
      <div><h2 className="flex items-center gap-2 text-sm font-medium"><ShieldCheck aria-hidden="true" className="text-accent"/>信任边界</h2>
        <p className="mt-2 text-xs leading-5 text-foreground-3">报告中的路径、文本、链接和建议都按不可信数据展示。扩展不写入文件、不自动应用修复、不执行终端命令，也不上传仓库内容。</p>
      </div>
    </section>
  </section>
}
