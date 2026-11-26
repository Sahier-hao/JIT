import { render, screen } from '@/lib/test-utils'
import { expect, it, vi } from 'vitest'
import { ReviewCandidates } from '@/features/reviews/components/ReviewCandidates'
import type { PRCandidate } from '@/features/reviews/prReviewClient'

function candidate(ruleId: string, title: string, example: string, check: string): PRCandidate {
  return {
    side: 'head', path: 'pkg/a.py', line: 1, ruleId, ruleVersion: '2',
    message: `${title}命中`, evidence: 'rule evidence',
    suggestion: {
      ruleId, ruleVersion: '2', title, rationale: `${title}的理由`,
      location: { path: 'pkg/a.py', line: 1, side: 'head' },
      manualChecks: [check], example: { before: 'before', after: example },
    },
  }
}

it('renders new rule examples, manual checks, and the legacy rule-set marker', () => {
  const candidates = [
    candidate('py-subprocess-shell-true', '避免 shell=True，改用参数列表', 'subprocess.run(["git", "status"])', '确认命令是否包含外部输入'),
    candidate('py-yaml-unsafe-load', '为 yaml.load 指定安全的 Loader', 'yaml.load(text, Loader=yaml.SafeLoader)', '确认 YAML 只包含数据'),
    candidate('py-requests-verify-false', '确认是否需要关闭 TLS 校验', 'requests.get(url, timeout=10)', '确认目标服务是否使用受信任证书'),
    candidate('py-tempfile-mktemp', '改用不会产生竞态条件的临时文件接口', 'with tempfile.NamedTemporaryFile() as handle:', '确认临时文件的生命周期'),
  ]
  render(<ReviewCandidates candidates={candidates} target={{ side: 'head', line: 1 }}
    ruleSet={{ analyzerVersion: 'python-ast-v1', ruleVersion: '1', status: 'legacy' }}
    onLocate={vi.fn()} onAdd={vi.fn()}/>)
  expect(screen.getByText('旧规则结果，未重算')).toBeVisible()
  expect(screen.getByText('避免 shell=True，改用参数列表')).toBeVisible()
  expect(screen.getByText('subprocess.run(["git", "status"])')).toBeVisible()
  expect(screen.getByText('确认命令是否包含外部输入')).toBeVisible()
  expect(screen.getByText('为 yaml.load 指定安全的 Loader')).toBeVisible()
  expect(screen.getByText('yaml.load(text, Loader=yaml.SafeLoader)')).toBeVisible()
  expect(screen.getByText('确认 YAML 只包含数据')).toBeVisible()
  expect(screen.getByText('确认是否需要关闭 TLS 校验')).toBeVisible()
  expect(screen.getByText('requests.get(url, timeout=10)')).toBeVisible()
  expect(screen.getByText('确认目标服务是否使用受信任证书')).toBeVisible()
  expect(screen.getByText('改用不会产生竞态条件的临时文件接口')).toBeVisible()
  expect(screen.getByText('with tempfile.NamedTemporaryFile() as handle:')).toBeVisible()
  expect(screen.getByText('确认临时文件的生命周期')).toBeVisible()
})
