import { BookOpenText, User, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Route } from '@/app/navigation'
import type { UserSession } from '@/features/account/userClient'


import { EntryFooter, EntryHeader, EntryPage } from '@/components/layout/EntryChrome'

/** 产品介绍首页：通过两个角色入口进入各自工作区。 */
export function LandingPage({ navigate, session }: {
  navigate: (route: Route) => void
  session: UserSession | null
}) {
  const loggedIn = session?.authenticated === true
  return <EntryPage>
    <EntryHeader
      onHome={() => navigate({ name: 'landing' })}
      right={<>
        <Button variant="ghost" size="sm" asChild><a href="#/docs"><BookOpenText aria-hidden="true" size={15}/>文档</a></Button>
        <span className="hidden text-xs text-foreground-3 sm:inline">提交级风险 · 静态行级线索 · 可复核实验</span>
      </>}
    />
    <main className="mx-auto grid w-full max-w-[1160px] flex-1 gap-10 px-5 py-10 sm:gap-14 sm:px-8 sm:py-16">
      <section className="grid items-start gap-8 md:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)] md:gap-14">
        <div className="grid gap-4">
          <p className="text-xs uppercase tracking-[.14em] text-foreground-3">JIT 缺陷预测与审查工作台</p>
          <h1 className="max-w-[15em] font-display text-3xl leading-[1.12] tracking-tight text-foreground sm:text-5xl">把提交数据变成可训练、可复核、可定位的审查线索</h1>
          <p className="max-w-[640px] text-sm leading-[1.85] text-foreground-2 sm:text-base">从公开仓库采集提交与 SZZ 标签，按时间切分数据，一次训练多种方法，再把模型分数用在项目分析和 PR 审查中。分数是模型估计，不是缺陷结论。</p>
        </div>
        <div className="grid gap-3" aria-label="选择工作区">
          <article className="grid gap-3 rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-2"><User aria-hidden="true" focusable="false" strokeWidth={1.5} size={18} className="text-foreground-3"/><h2 className="text-base font-semibold text-foreground">用户工作区</h2></div>
            <p className="text-xs leading-[1.65] text-foreground-3">管理自己的数据集、训练实验与模型，进入项目和 PR 审查。</p>
            <Button variant='default' onClick={() => navigate(loggedIn ? { name: 'repositories' } : { name: 'login', role: 'user' })} className="w-full" type="button">{loggedIn ? `继续进入项目 · ${session?.username}` : '登录 / 注册'}</Button>
          </article>
          <article className="grid gap-3 rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-2"><SlidersHorizontal aria-hidden="true" focusable="false" strokeWidth={1.5} size={18} className="text-foreground-3"/><h2 className="text-base font-semibold text-foreground">管理工作区</h2></div>
            <p className="text-xs leading-[1.65] text-foreground-3">维护全局数据集、模型目录、默认模型和验证记录。</p>
            <Button onClick={() => navigate({ name: 'login', role: 'admin' })} variant="outline" className="w-full" type="button">管理员登录</Button>
          </article>
        </div>
      </section>

      <section className="grid gap-0 border-t border-border md:grid-cols-3 md:divide-x md:divide-border" aria-label="产品能力">
        <article className="grid gap-2 border-b border-border py-5 md:border-b-0 md:px-5 md:first:pl-0"><h2 className="text-base font-semibold text-foreground">数据与训练</h2><p className="text-xs leading-[1.7] text-foreground-3">从项目真实提交采集数据，查看质量与标签证据，选择时间切分，训练逻辑回归、树模型或深度方法；迭代方法保留真实训练曲线。</p></article>
        <article className="grid gap-2 border-b border-border py-5 md:border-b-0 md:px-5"><h2 className="text-base font-semibold text-foreground">PR 审查</h2><p className="text-xs leading-[1.7] text-foreground-3">固定 PR 快照后按提交查看风险，生成模型解释；静态候选绑定到具体行，并给出针对规则的修复建议。</p></article>
        <article className="grid gap-2 py-5 md:px-5 md:last:pr-0"><h2 className="text-base font-semibold text-foreground">提交与 IDE</h2><p className="text-xs leading-[1.7] text-foreground-3">从明确的 base/head 触发真实采集、推理和报告；在 VS Code 中只读导入报告，核对提交身份后跳转到代码行。</p></article>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4" aria-label="研究预览">
        <div className="grid gap-1">
          <span className="text-xs uppercase tracking-[.14em] text-foreground-3">研究预览</span>
          <h2 className="text-base font-semibold text-foreground">行级模型</h2>
          <p className="text-xs text-foreground-3">TypeScript / JavaScript · 按行排序分数</p>
        </div>
        <Button onClick={() => navigate({ name: 'research-line' })} variant="outline" type="button">进入研究预览</Button>
      </section>

      <section className="grid gap-6 md:grid-cols-3" aria-label="使用流程">
        <div className="grid gap-1.5"><b className="font-mono text-[11px] tracking-[.14em] text-foreground-3">01</b><span className="text-sm font-semibold text-foreground">登录账户</span><p className="text-xs leading-[1.65] text-foreground-3">用户账户管理自己的数据与模型；管理员维护全局目录和默认模型。</p></div>
        <div className="grid gap-1.5"><b className="font-mono text-[11px] tracking-[.14em] text-foreground-3">02</b><span className="text-sm font-semibold text-foreground">采集并训练</span><p className="text-xs leading-[1.65] text-foreground-3">在项目里构建数据集，预览切分，选择方法与参数发起训练。</p></div>
        <div className="grid gap-1.5"><b className="font-mono text-[11px] tracking-[.14em] text-foreground-3">03</b><span className="text-sm font-semibold text-foreground">登记并审查</span><p className="text-xs leading-[1.65] text-foreground-3">显式登记模型后在项目中选用，回到 PR 工作单记录判断和结论。</p></div>
      </section>
    </main>
    <EntryFooter><span>模型分数未经当前仓库概率校准，不是缺陷概率。</span><span>行级线索来自静态规则，不是逐行概率。</span></EntryFooter>
  </EntryPage>
}
