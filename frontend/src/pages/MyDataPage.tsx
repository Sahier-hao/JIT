import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../apiContract'
import { trainingMethods, type MethodChoice } from '../modelClient'
import { SPLIT_PRESETS } from '../splitClient'
import {
  createUserExperiment, deriveCuration, exportDataset, previewCuration, splitPreview,
  userDatasets, useUserRevision, type UserDataset,
} from '../userClient'
import { Button, Checkbox, NumberInput, Select, TextArea } from '../ui/controls'
import { formatDate, valueLabel } from '../adminContracts'
import { EmptyState, LoadingNotice } from '../Feedback'
import type { Route } from '../navigation'
import '../styles/user-workspace.css'

const RECIPE = '{\n  "version": 1,\n  "rules": [\n    { "id": "max-value", "field": "la", "value": 10000 }\n  ]\n}'

export function MyDataPage({ navigate, onLoginRequired }: {
  navigate: (route: Route) => void
  onLoginRequired: () => void
}) {
  const [datasets, setDatasets] = useState<UserDataset[] | null>(null)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [methods, setMethods] = useState<MethodChoice[]>([])
  const [chosen, setChosen] = useState<string[]>([])
  const [params, setParams] = useState<Record<string, Record<string, string>>>({})
  const [preset, setPreset] = useState('temporal-70-15-15')
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const userRevision = useUserRevision()
  const [recipe, setRecipe] = useState(RECIPE)
  const [curation, setCuration] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    userDatasets('usable', controller.signal).then(value => {
      if (!controller.signal.aborted) { setDatasets(value); setSelected(value[0]?.version ?? '') }
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '数据读取失败')
    })
    return () => controller.abort()
  }, [onLoginRequired, userRevision])

  const current = useMemo(() => datasets?.find(item => item.version === selected) ?? null, [datasets, selected])
  useEffect(() => {
    if (!current) return
    const controller = new AbortController()
    setMethods([]); setChosen([]); setParams({})
    trainingMethods(current.schema, controller.signal).then(value => {
      if (!controller.signal.aborted) setMethods(value.methods.filter(item => item.supportedSchema))
    }).catch(() => { /* 训练方法读取失败在表单提交时提示 */ })
    return () => controller.abort()
  }, [current?.schema, current?.version])
  useEffect(() => {
    if (!current) return
    const controller = new AbortController()
    setPreview(null)
    splitPreview(current.version, preset, controller.signal).then(value => { if (!controller.signal.aborted) setPreview(value) })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '切分预览失败') })
    return () => controller.abort()
  }, [current?.version, preset])

  function toggle(method: string) {
    setChosen(values => values.includes(method) ? values.filter(item => item !== method) : [...values, method])
    const choice = methods.find(item => item.method === method)
    setParams(values => values[method] ? values : { ...values, [method]: Object.fromEntries((choice?.params ?? []).map(param => [param.name, param.default == null ? '' : String(param.default)])) })
  }
  async function train() {
    if (!current) return
    setBusy(true); setError('')
    try {
      const methodsPayload = chosen.map(method => {
        const values: Record<string, number> = {}
        for (const spec of methods.find(item => item.method === method)?.params ?? []) {
          const raw = params[method]?.[spec.name]
          if (raw == null || raw.trim() === '') continue
          const numeric = Number(raw)
          if (!Number.isFinite(numeric)) throw new Error(`${method} 的参数 ${spec.name} 不是数值`)
          values[spec.name] = numeric
        }
        return { method, params: values }
      })
      if (!methodsPayload.length) throw new Error('至少选择一个训练方法')
      const experiment = await createUserExperiment({ datasetVersion: current.version, methods: methodsPayload, splitPreset: preset })
      navigate({ name: 'my-training', experimentId: experiment.experimentId })
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '实验创建失败')
    } finally { setBusy(false) }
  }
  async function runCuration(derive: boolean) {
    if (!current) return
    setBusy(true); setError('')
    try {
      const payload = JSON.parse(recipe)
      const result = derive ? await deriveCuration(current.version, payload) : await previewCuration(current.version, payload)
      setCuration(result)
      if (derive) {
        const version = ((result.dataset as Record<string, unknown> | undefined)?.version) as string | undefined
        if (version) setSelected(version)
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '清洗失败')
    } finally { setBusy(false) }
  }

  if (datasets === null) return <section className="user-workspace">
    {error ? <div className="user-empty"><p className="field-error" role="alert">{error}</p><Button onClick={onLoginRequired}>登录后重试</Button></div>
      : <LoadingNotice label="正在读取我的数据"/>}
  </section>
  if (!datasets.length) return <section className="user-workspace">
    <EmptyState title="还没有可用数据" description="在项目页点击「构建数据集」从真实提交采集，或使用管理员登记的共享数据集。">
      <Button variant="primary" onClick={() => navigate({ name: 'repositories' })}>去项目</Button>
    </EmptyState>
  </section>
  return <section className="user-workspace">
    <header className="user-page-head"><h1>我的数据</h1><span>{datasets.length} 个可用版本 · 每人最多保留 5 个自有版本</span></header>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    <div className="user-data-layout">
      <div className="user-data-list" role="listbox" aria-label="我的数据版本">
        {datasets.map(item => <button key={item.version} role="option" aria-selected={item.version === selected}
          className={`user-data-card${item.version === selected ? ' is-active' : ''}`} onClick={() => setSelected(item.version)}>
          <strong>{item.dataset}</strong>
          <span>{item.shared ? '共享数据' : '我的数据'} · {item.schema}</span>
          <span>{valueLabel(item.quality.includedRows)} 行 · {valueLabel(item.quality.positiveLabels)} 正例</span>
          <code>{item.version}</code>
        </button>)}
      </div>
      <div className="user-data-detail">
        {current ? <>
          <dl className="admin-facts">
            <div><dt>版本</dt><dd><code>{current.version}</code></dd></div>
            <div><dt>时间范围</dt><dd>{formatDate(current.timeRange.start)} — {formatDate(current.timeRange.end)}</dd></div>
            <div><dt>原始 / 纳入</dt><dd>{valueLabel(current.quality.rawRows)} / {valueLabel(current.quality.includedRows)}</dd></div>
            <div><dt>正例</dt><dd>{valueLabel(current.quality.positiveLabels)}</dd></div>
            <div><dt>CSV SHA-256</dt><dd><code>{valueLabel(current.file.sha256)}</code></dd></div>
            <div><dt>来源</dt><dd>{valueLabel(current.source.url)}</dd></div>
          </dl>
          <div className="user-data-actions">
            <Button onClick={() => exportDataset(current.version)}>导出 CSV 包</Button>
            <Button onClick={() => setSelected(current.version)}>刷新版本</Button>
          </div>
          <section className="user-panel"><h2>时间切分</h2>
            <div className="user-inline"><Select ariaLabel="时间切分预设" value={preset} onChange={setPreset} options={[...SPLIT_PRESETS]}/></div>
            {preview ? preview.available === false
              ? <p className="field-error">{valueLabel((preview.reason as Record<string, unknown> | undefined)?.message ?? '该预设不可用')}</p>
              : <div className="user-split-grid">{(['train', 'validation', 'test'] as const).map(name => {
                const part = (preview.partitions as Record<string, Record<string, unknown>> | undefined)?.[name]
                return <div key={name}><strong>{{ train: '训练', validation: '验证', test: '测试' }[name]}</strong><span>{valueLabel(part?.records)} 行 · {valueLabel(part?.positives)} 正例</span><span>{part?.start ? `${formatDate(part.start)} — ${formatDate(part.end)}` : '—'}</span></div>
              })}</div> : <p className="quiet-empty">正在计算切分…</p>}
          </section>
          <section className="user-panel"><h2>训练模型</h2>
            <div className="user-methods">
              {methods.map(choice => <div key={choice.method} className="user-method">
                <Checkbox checked={chosen.includes(choice.method)} disabled={!choice.available} onCheckedChange={() => toggle(choice.method)}>
                  {choice.name}{choice.available ? '' : `（${choice.reason ?? '不可用'}）`}
                </Checkbox>
                {chosen.includes(choice.method) && choice.params.length ? <div className="admin-method-params">
                  {choice.params.map(spec => <label key={spec.name}>{spec.name}（{spec.min}–{spec.max}）
                    <NumberInput aria-label={`${choice.name} ${spec.name}`} min={spec.min} max={spec.max} step="any"
                      value={params[choice.method]?.[spec.name] ?? ''}
                      onChange={event => setParams(values => ({ ...values, [choice.method]: { ...(values[choice.method] ?? {}), [spec.name]: event.target.value } }))}/>
                  </label>)}
                </div> : null}
              </div>)}
            </div>
            <Button variant="primary" loading={busy} disabled={!chosen.length || !preview || preview.available !== true} onClick={() => void train()}>
              开始训练（{chosen.length} 个方法）
            </Button>
          </section>
          {current.mine ? <section className="user-panel"><h2>清洗与派生</h2>
            <TextArea aria-label="清洗配方" value={recipe} onChange={event => setRecipe(event.target.value)}/>
            <div className="user-inline">
              <Button loading={busy} onClick={() => void runCuration(false)}>预览清洗</Button>
              <Button loading={busy} onClick={() => void runCuration(true)}>生成派生版本</Button>
            </div>
            {curation ? <pre className="user-json">{JSON.stringify(curation, null, 2)}</pre> : null}
          </section> : null}
        </> : null}
      </div>
    </div>
  </section>
}
