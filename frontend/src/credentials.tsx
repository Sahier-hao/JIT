/**
 * 团队凭据的输入、确认与清除（MPW-02、design D2）。
 *
 * 掩码输入、显式确认、随时清除；凭据本身只落在 CredentialContext 的内存状态里。
 */

import { useCallback, useMemo, useState } from 'react'
import {
  CredentialContext,
  CredentialDraftContext,
  type CredentialDraftState,
  type CredentialSnapshot,
  type CredentialState,
  useCredential,
  useCredentialDraft,
} from './credentialContext'

export function CredentialProvider({ children, initialToken = '' }: { children: React.ReactNode; initialToken?: string }) {
  const [snapshot, setSnapshot] = useState<CredentialSnapshot>({ token: initialToken, generation: 0 })
  const [draft, setDraft] = useState('')
  const setToken = useCallback((value: string) => {
    setSnapshot((previous) => ({ token: value, generation: previous.generation + 1 }))
    setDraft('')
  }, [])
  const clear = useCallback(() => {
    setSnapshot((previous) => (previous.token === '' ? previous : { token: '', generation: previous.generation + 1 }))
    setDraft('')
  }, [])
  // 两个 value 各自缓存：敲草稿只改变草稿上下文的引用，不会连带刷新整个应用的已确认凭据视图。
  const value = useMemo<CredentialState>(
    () => ({ token: snapshot.token, generation: snapshot.generation, setToken, clear }),
    [snapshot.token, snapshot.generation, setToken, clear],
  )
  const draftValue = useMemo<CredentialDraftState>(() => ({ draft, setDraft }), [draft])
  return (
    <CredentialContext.Provider value={value}>
      <CredentialDraftContext.Provider value={draftValue}>{children}</CredentialDraftContext.Provider>
    </CredentialContext.Provider>
  )
}

/** 侧栏里的凭据输入与清除：掩码输入、显式确认、随时清除。 */
export function CredentialPanel() {
  const { token, setToken, clear } = useCredential()
  const { draft, setDraft } = useCredentialDraft()
  const [editing, setEditing] = useState(false)
  const open = token === '' || editing

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = draft.trim()
    if (value === '') return
    setToken(value)
    setEditing(false)
  }

  return (
    <section className="credential-panel" aria-labelledby="credential-heading">
      <h2 className="nav-label" id="credential-heading">
        团队凭据
      </h2>
      {token !== '' && !open ? (
        <div className="credential-used">
          <p className="credential-state" role="status">
            已输入凭据（仅本页内存）
          </p>
          <div className="credential-actions">
            <button type="button" onClick={() => setEditing(true)}>
              更换凭据
            </button>
            <button type="button" onClick={clear}>
              清除凭据
            </button>
          </div>
        </div>
      ) : (
        <form className="credential-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="credential-input">
            团队访问凭据
          </label>
          <input
            id="credential-input"
            type="password"
            name="team-credential"
            autoComplete="off"
            spellCheck={false}
            placeholder="团队访问凭据"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="credential-actions">
            <button type="submit" disabled={draft.trim() === ''}>
              使用凭据
            </button>
            {token !== '' ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  clear()
                }}
              >
                清除凭据
              </button>
            ) : null}
          </div>
          <p className="credential-hint">凭据只保存在本页内存，刷新后需要重新输入。</p>
        </form>
      )}
    </section>
  )
}
