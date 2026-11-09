import type { Route } from '../navigation'
import type { UserSession } from '../userClient'
import { Icon } from '../Icon'
import { Button } from '../ui/controls'
import '../styles/entry.css'

/** 产品介绍首页：通过两个角色入口进入各自工作区。 */
export function LandingPage({ navigate, session }: {
  navigate: (route: Route) => void
  session: UserSession | null
}) {
  const loggedIn = session?.authenticated === true
  return <div className="entry-page">
    <header className="entry-header">
      <button className="entry-brand" onClick={() => navigate({ name: 'landing' })}>
        <span className="brand-glyph"><Icon name="logo" size={22}/></span>
        <span>JIT<span className="brand-caption">REVIEW</span></span>
      </button>
      <span className="entry-header-note">提交级风险 · 静态行级线索 · 可复核实验</span>
    </header>
    <main className="entry-main">
      <section className="entry-hero">
        <div className="entry-hero-copy">
          <p className="entry-eyebrow">JIT 缺陷预测与审查工作台</p>
          <h1>把提交数据变成可训练、可复核、可定位的审查线索</h1>
          <p className="entry-lede">从公开仓库采集提交与 SZZ 标签，按时间切分数据，一次训练多种方法，再把模型分数用在项目分析和 PR 审查中。分数是模型估计，不是缺陷结论。</p>
        </div>
        <div className="entry-portals" aria-label="选择工作区">
          <article className="entry-portal">
            <div className="entry-portal-head"><Icon name="user" size={18}/><h2>用户工作区</h2></div>
            <p>管理自己的数据集、训练实验与模型，进入项目和 PR 审查。</p>
            <Button variant="primary" block onClick={() => navigate(loggedIn ? { name: 'repositories' } : { name: 'login', role: 'user' })}>
              {loggedIn ? `继续进入项目 · ${session?.username}` : '登录 / 注册'}
            </Button>
          </article>
          <article className="entry-portal">
            <div className="entry-portal-head"><Icon name="sliders" size={18}/><h2>管理工作区</h2></div>
            <p>维护全局数据集、模型目录、默认模型和验证记录。</p>
            <Button block onClick={() => navigate({ name: 'login', role: 'admin' })}>管理员登录</Button>
          </article>
        </div>
      </section>
      <section className="entry-grid" aria-label="产品能力">
        <article><h2>数据与训练</h2><p>从项目真实提交采集数据，查看质量与标签证据，选择时间切分，训练逻辑回归、树模型或深度方法；迭代方法保留真实训练曲线。</p></article>
        <article><h2>PR 审查</h2><p>固定 PR 快照后按提交查看风险，生成模型解释；静态候选绑定到具体行，并给出针对规则的修复建议。</p></article>
        <article><h2>提交与 IDE</h2><p>从明确的 base/head 触发真实采集、推理和报告；在 VS Code 中只读导入报告，核对提交身份后跳转到代码行。</p></article>
      </section>
      <section className="entry-steps" aria-label="使用流程">
        <div><b>01</b><span>登录账户</span><p>用户账户管理自己的数据与模型；管理员维护全局目录和默认模型。</p></div>
        <div><b>02</b><span>采集并训练</span><p>在项目里构建数据集，预览切分，选择方法与参数发起训练。</p></div>
        <div><b>03</b><span>登记并审查</span><p>显式登记模型后在项目中选用，回到 PR 工作单记录判断和结论。</p></div>
      </section>
    </main>
    <footer className="entry-footer"><span>模型分数未经当前仓库概率校准，不是缺陷概率。</span><span>行级线索来自静态规则，不是逐行概率。</span></footer>
  </div>
}
