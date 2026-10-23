import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { apiRequest } from '../apiClient'
import { ApiError, record, recordList } from '../apiContract'
import { EmptyState, LoadingNotice } from '../Feedback'
import type { Route } from '../navigation'
import { VerificationReport } from '../VerificationReport'
import { ModelPolicyCards } from './ModelPolicyCards'

interface Session { authenticated: boolean; setupRequired: boolean; username: string | null }
type Row = Record<string, unknown>
function label(value: unknown, fallback = '未提供') { return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback }

export function AdminWorkspace({ route, navigate }: { route: Extract<Route, { name: 'admin' | 'report' }>; navigate: (route: Route) => void }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [revision, setRevision] = useState(0)
  const expired = useCallback(() => setSession({ authenticated: false, username: null, setupRequired: false }), [])
  useEffect(() => {
    const controller = new AbortController()
    const read = () => apiRequest({ path: '/api/admin/session', method: 'GET', signal: controller.signal }).then(body => {
      const value = record(body)
      if (!controller.signal.aborted) { setSession({ authenticated: value.authenticated === true, setupRequired: value.setupRequired === true, username: typeof value.username === 'string' ? value.username : null }); setSessionError('') }
    }).catch(error => { if (!controller.signal.aborted) setSessionError(error instanceof Error ? error.message : '登录状态读取失败') })
    void read()
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void read() }, 60000)
    window.addEventListener('focus', read)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', read) }
  }, [revision])
  if (!session) return sessionError ? <EmptyState title="管理服务暂时不可用" description={sessionError}><button onClick={() => setRevision(value => value + 1)}>重新连接</button></EmptyState> : <LoadingNotice label="正在检查管理会话"/>
  if (!session.authenticated) return <AdminSignIn setup={session.setupRequired} onSignedIn={setSession}/>
  async function logout() { try { await apiRequest({ path: '/api/admin/logout', method: 'POST' }); expired() } catch (error) { setSessionError(error instanceof Error ? error.message : '退出失败') } }
  return <div className="admin-workspace">
    <div className="admin-toolbar"><span className="admin-badge">管理员 · {session.username}</span><button className="text-button" onClick={() => void logout()}>退出管理</button><button className="text-button" onClick={() => navigate({ name: 'repositories' })}>返回用户工作区</button></div>
    <nav className="view-tabs" aria-label="管理导航"><button aria-current={route.name === 'admin' && route.view === 'models' ? 'page' : undefined} onClick={() => navigate({ name: 'admin', view: 'models' })}>模型管理</button><button aria-current={route.name === 'admin' && route.view === 'datasets' ? 'page' : undefined} onClick={() => navigate({ name: 'admin', view: 'datasets' })}>数据记录</button><button aria-current={route.name === 'report' ? 'page' : undefined} onClick={() => navigate({ name: 'report', view: 'overview' })}>验证报告</button></nav>
    {sessionError ? <p role="alert" className="field-error">{sessionError}</p> : null}
    {route.name === 'report' ? <VerificationReport route={route} navigate={navigate}/> : <AdminResources key={route.view} view={route.view} expired={expired}/>}
  </div>
}

function AdminSignIn({ setup, onSignedIn }: { setup: boolean; onSignedIn: (session: Session) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (locked.current) return
    if (setup && password !== confirmation) { setError('两次密码输入不一致'); return }
    locked.current = true; setBusy(true); setError('')
    try {
      const value = record(await apiRequest({ path: `/api/admin/${setup ? 'setup' : 'login'}`, method: 'POST', body: { username, password } }))
      if (value.authenticated !== true) throw new Error('未能确认登录，请重试')
      onSignedIn({ authenticated: true, username: label(value.username), setupRequired: false })
    } catch (failure) { setError(failure instanceof Error ? failure.message : '登录失败') }
    finally { locked.current = false; setBusy(false); setPassword(''); setConfirmation('') }
  }
  return <section className="admin-signin"><p className="eyebrow">MAINTENANCE WORKSPACE</p><h1>{setup ? '建立管理员账户' : '管理员登录'}</h1><p className="page-intro">在独立工作区维护模型、数据和验证记录。项目审查无需管理员登录。</p>
    <form className="repository-form" onSubmit={submit}><label>账户名<input aria-label="管理员账户名" autoComplete="username" required maxLength={80} value={username} onChange={event => setUsername(event.target.value)}/></label><label>密码<input aria-label="管理员密码" type="password" autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 12 : undefined} maxLength={256} value={password} onChange={event => setPassword(event.target.value)}/></label>{setup ? <><label>确认密码<input aria-label="确认管理员密码" type="password" autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label><p className="form-hint">首次使用请建立本机管理员，密码至少 12 位。已有账户后将关闭初始化入口。</p></> : null}{error ? <p className="field-error" role="alert">{error}</p> : null}<button className="primary-button" disabled={busy}>{busy ? '正在验证…' : setup ? '建立账户并进入' : '登录管理工作区'}</button></form>
  </section>
}

function AdminResources({ view, expired }: { view: 'models' | 'datasets'; expired: () => void }) {
  const [models, setModels] = useState<Row[]>([])
  const [candidates, setCandidates] = useState<Row[]>([])
  const [methods, setMethods] = useState<Row[]>([])
  const [datasets, setDatasets] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const lock = useRef(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      if (view === 'models') {
        const [catalog, shelf] = await Promise.all([apiRequest({ path: '/api/v1/models', method: 'GET', signal: controller.signal }), apiRequest({ path: '/api/v1/model-candidates', method: 'GET', signal: controller.signal })])
        if (!controller.signal.aborted) { setModels(recordList(record(catalog).models)); setMethods(recordList(record(catalog).methods)); setCandidates(recordList(record(shelf).candidates)) }
      } else {
        const body = await apiRequest({ path: '/api/v1/datasets', method: 'GET', signal: controller.signal })
        if (!controller.signal.aborted) setDatasets(recordList(record(body).datasets))
      }
      if (!controller.signal.aborted) setError('')
    }
    void load().catch(failure => { if (!controller.signal.aborted) { if (failure instanceof ApiError && failure.status === 401) expired(); else setError(failure instanceof Error ? failure.message : '读取失败') } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [view, revision, expired])
  async function register(candidate: Row) {
    if (lock.current) return
    lock.current = true; setBusy(label(candidate.candidateId)); setError(''); setNotice('')
    try {
      await apiRequest({ path: '/api/v1/models/register', method: 'POST', body: { candidateId: candidate.candidateId, expectedManifestSha256: candidate.manifestSha256 } })
      setNotice('产物校验通过，已登记。用户可在项目的分析选项中选择兼容模型。'); setRevision(value => value + 1)
    } catch (failure) { if (failure instanceof ApiError && failure.status === 401) expired(); else setError(failure instanceof Error ? failure.message : '登记失败') }
    finally { lock.current = false; setBusy('') }
  }
  async function updatePolicy(modelId: string, changes: { enabled?: boolean; isDefault?: boolean }) {
    if (lock.current) return
    lock.current = true; setBusy(modelId); setError(''); setNotice('')
    try {
      const saved = record(await apiRequest({ path: `/api/v1/models/${encodeURIComponent(modelId)}/policy`, method: 'PATCH', body: changes }))
      setModels(previous => previous.map(model => ({ ...model,
        ...(saved.isDefault === true ? { isDefault: model.modelId === modelId } : {}),
        ...(model.modelId === modelId ? saved : {}),
      })))
      setNotice(changes.isDefault ? '默认模型已更新。新任务使用新设置；已排队任务保持原模型。' : changes.enabled ? '模型已启用，可在分析选项中选择。' : '模型已停用，已完成结果保留。')
      setRevision(value => value + 1)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '模型设置保存失败')
    } finally { lock.current = false; setBusy('') }
  }
  return <section><header className="page-heading"><div><h1>{view === 'models' ? '模型管理' : '数据记录'}</h1><p className="page-intro">{view === 'models' ? '登记实际交付的模型，并核对它们是否适用于仓库分析。' : '集中核对已登记的数据来源与版本。'}</p></div><button className="clear-button" onClick={() => setRevision(value => value + 1)}>刷新</button></header>{error ? <p className="field-error" role="alert">{error}</p> : null}{notice ? <p role="status" className="admin-notice">{notice}</p> : null}
    {loading ? <LoadingNotice label="正在读取管理记录"/> : view === 'models' ? <><h2>已登记模型 <small>{models.length}</small></h2><ModelPolicyCards models={models} busy={!!busy} update={updatePolicy}/>{!models.length ? <p className="quiet-empty">尚无已登记模型，请从下方实际产物校验登记。</p> : null}<MethodAvailability methods={methods}/><h2>本机模型产物</h2><p className="form-hint">产物存在不代表已通过准入。登记会检查文件完整性、输入契约和运行环境，不会重训。</p><div className="admin-candidates">{candidates.map(candidate => <article className="admin-candidate" key={label(candidate.candidateId)}><div><strong>{label(candidate.displayName)}</strong><p>{label(candidate.method)} · {label(candidate.featureSchemaVersion)}</p></div><button className="clear-button" disabled={!!busy || candidate.state === 'invalid'} onClick={() => void register(candidate)}>{busy === candidate.candidateId ? '正在校验…' : '校验并登记'}</button></article>)}</div>{!candidates.length ? <p className="quiet-empty">当前产物目录没有可发现的模型。请先由维护者交付完整产物。</p> : null}</> : <DatasetRecords datasets={datasets}/>}
  </section>
}

function DatasetRecords({ datasets }: { datasets: Row[] }) {
  if (!datasets.length) return <p className="quiet-empty">没有已登记的数据记录。</p>
  return <div className="admin-candidates">{datasets.map(dataset => {
    const versions = Array.isArray(dataset.versions) ? recordList(dataset.versions) : []
    return <article className="admin-candidate" key={label(dataset.dataset)}>
      <div><h2>{label(dataset.dataset)}</h2><p>{versions.length} 个登记版本</p>
        {versions.map(version => <details key={label(version.version)}>
          <summary>{label(version.version)}</summary>
          <p>输入方案：{label(version.schema)}</p>
          {version.quality && typeof version.quality === 'object' ? <p>纳入 {label(record(version.quality).includedRows)} 条记录</p> : null}
        </details>)}
      </div>
    </article>
  })}</div>
}

function MethodAvailability({ methods }: { methods: Row[] }) {
  if (!methods.length) return null
  return <section className="method-availability" aria-label="方法支持情况"><h2>方法支持情况 <small>{methods.length}</small></h2><p className="form-hint">支持方法与已校验模型分别统计；项目能否选择模型还取决于上方卡片的启停与兼容状态。</p><ul>{methods.map(method => <li key={label(method.method)}><div><strong>{label(method.name)}</strong><span className="form-hint">{method.category === 'deep' ? '深度学习' : '经典机器学习'}</span></div><span>{Number(method.registeredModels) > 0 ? `已校验模型 ${method.registeredModels}` : Number(method.deliveredArtifacts) > 0 ? '待校验登记' : '无已交付产物'}</span></li>)}</ul></section>
}
