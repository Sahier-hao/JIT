import firstPrReview from '../../../content/docs/articles/first-pr-review.md?raw'
import branchRiskTrends from '../../../content/docs/articles/branch-risk-trends.md?raw'
import prReviewUpdates from '../../../content/docs/articles/pr-review-updates.md?raw'
import dataTrainingEvaluation from '../../../content/docs/articles/data-training-evaluation.md?raw'
import vscodeCommitCheck from '../../../content/docs/articles/vscode-commit-check.md?raw'
import whatIsJit from '../../../content/docs/articles/what-is-jit.md?raw'
import readingResults from '../../../content/docs/articles/reading-results.md?raw'
import labelsAndMetrics from '../../../content/docs/articles/labels-and-metrics.md?raw'
import faq from '../../../content/docs/articles/faq.md?raw'

export type DocsGroupId = 'quick-start' | 'guides' | 'background' | 'faq'

export interface DocsGroup {
  id: DocsGroupId
  label: string
}

export interface DocArticle {
  slug: string
  title: string
  summary: string
  group: DocsGroupId
  order: number
  body: string
}

export const DOC_GROUPS: DocsGroup[] = [
  { id: 'quick-start', label: '快速开始' },
  { id: 'guides', label: '使用指南' },
  { id: 'background', label: '背景知识' },
  { id: 'faq', label: '常见问题' },
]

/** 唯一公开文章清单。导航、正文和搜索都从这里读取。 */
export const DOC_ARTICLES: DocArticle[] = [
  {
    slug: 'first-pr-review',
    title: '完成第一次 PR 审查',
    summary: '从登录、添加项目到记录代码证据并导出 Markdown 的完整路径。',
    group: 'quick-start',
    order: 1,
    body: firstPrReview,
  },
  {
    slug: 'branch-risk-trends',
    title: '分析分支与查看风险趋势',
    summary: '选择分支和兼容模型，打开固定结果，下钻提交并核对同口径趋势。',
    group: 'guides',
    order: 2,
    body: branchRiskTrends,
  },
  {
    slug: 'pr-review-updates',
    title: '处理 PR 与作者更新',
    summary: '使用只读预览、个人工作单、代码证据和复核轮次交付审查意见。',
    group: 'guides',
    order: 3,
    body: prReviewUpdates,
  },
  {
    slug: 'data-training-evaluation',
    title: '从数据到训练、预测与评估',
    summary: '分清我的数据、训练、模型、预测批次和模型评估的输入与输出。',
    group: 'guides',
    order: 4,
    body: dataTrainingEvaluation,
  },
  {
    slug: 'vscode-commit-check',
    title: '在 VS Code 中检查提交',
    summary: '安装扩展、选择真实兼容模型，读取提交分数和代码候选。',
    group: 'guides',
    order: 5,
    body: vscodeCommitCheck,
  },
  {
    slug: 'what-is-jit',
    title: '什么是 JIT 缺陷预测',
    summary: '用一次短提交说明模型输入、风险分和审查者的下一步。',
    group: 'background',
    order: 6,
    body: whatIsJit,
  },
  {
    slug: 'reading-results',
    title: '怎么看风险分和代码线索',
    summary: '区分提交级风险分、文件排序、静态规则命中和行级研究排序。',
    group: 'background',
    order: 7,
    body: readingResults,
  },
  {
    slug: 'labels-and-metrics',
    title: '缺陷标签与评估指标',
    summary: '理解观察期、标签成熟度、阈值、分类指标和未覆盖状态。',
    group: 'background',
    order: 8,
    body: labelsAndMetrics,
  },
  {
    slug: 'faq',
    title: '常见问题',
    summary: '排查仓库访问、GitHub 授权、模型为空、限流和评估入口问题。',
    group: 'faq',
    order: 9,
    body: faq,
  },
]

export function articleBySlug(slug: string | undefined): DocArticle | undefined {
  return DOC_ARTICLES.find(article => article.slug === slug)
}

export function articlesInGroup(group: DocsGroupId): DocArticle[] {
  return DOC_ARTICLES.filter(article => article.group === group).sort((left, right) => left.order - right.order)
}
