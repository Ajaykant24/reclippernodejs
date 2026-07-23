// ── ADMIN PANEL: Admin.jsx ──
// Lets the admin approve or reject people who signed up. Only reachable by admin
// accounts (guarded in App.jsx). Pending users can't sign in until approved here.

import { useCallback, useEffect, useState } from 'react'
import { api } from './api/client'

// Status badges map onto the shared .chip variants (index.css) — one palette app-wide.
const STATUS_CHIP = {
  pending: { label: 'Pending', cls: 'chip chip-warn' },
  approved: { label: 'Approved', cls: 'chip chip-ok' },
  rejected: { label: 'Rejected', cls: 'chip chip-danger' },
}

function formatDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return '' }
}

export default function AdminPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  // Server self-update state (deploy without SSH)
  const [serverVersion, setServerVersion] = useState('')
  const [deployState, setDeployState] = useState('idle') // idle | confirm | deploying | waiting | done | failed
  const [deployMsg, setDeployMsg] = useState('')

  const fetchVersion = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/version')
      setServerVersion(data?.version || 'unknown')
    } catch { setServerVersion('') /* old backend without the endpoint */ }
  }, [])

  useEffect(() => { fetchVersion() }, [fetchVersion])

  const updateServer = async () => {
    setDeployState('deploying')
    setDeployMsg('Pulling the latest code on the server…')
    try {
      await api.post('/admin/deploy', {}, { timeout: 300000 })
      // The server intentionally restarts right after answering — wait for it to come back.
      setDeployState('waiting')
      setDeployMsg('Server restarting with the new code…')
      const deadline = Date.now() + 90000
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 3000))
        try {
          await api.get('/health', { timeout: 4000 })
          setDeployState('done')
          setDeployMsg('Server updated and back online.')
          fetchVersion()
          return
        } catch { /* still restarting */ }
      }
      setDeployState('failed')
      setDeployMsg('Server did not come back within 90s — check it when you can.')
    } catch (err) {
      if (err?.response?.status === 404) {
        setDeployState('failed')
        setDeployMsg('This server does not have self-update yet — one manual deploy is needed first.')
      } else {
        setDeployState('failed')
        setDeployMsg(err?.response?.data?.detail || err?.response?.data?.step || err.message || 'Update failed.')
      }
    }
  }

  const load = useCallback(async () => {
    setError('')
    try {
      const { data } = await api.get('/admin/users')
      setUsers(data?.users || [])
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Could not load users.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (id, action) => {
    setBusyId(id)
    setError('')
    try {
      await api.post(`/admin/users/${id}/${action}`)
      await load()
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Action failed.')
    } finally {
      setBusyId('')
    }
  }

  const pendingCount = users.filter(u => u.status === 'pending').length

  return (
    <div className="workspace-page proj-page mobile-page">
      <div className="workspace-hero">
        <div>
          <span className="eyebrow">Admin</span>
          <h1>Manage access</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            Approve or reject who can use the tool.{pendingCount ? ` ${pendingCount} waiting.` : ''}
          </p>
        </div>
        <button className="btn btn-glass" onClick={load} disabled={loading}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
          Refresh
        </button>
      </div>

      {error ? <div className="error-box" style={{ marginBottom: 16 }}>{error}</div> : null}

      {/* ── SERVER PANEL: version + one-tap self-update (no SSH needed) ── */}
      <div className="surface" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 16px', marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--teal)' }}>cloud_done</span>
            <strong style={{ fontSize: 14 }}>Backend server</strong>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
            {serverVersion
              ? <>Running: <code style={{ fontSize: 11 }}>{serverVersion}</code></>
              : 'Self-update not installed yet — one manual deploy activates it.'}
          </div>
          {deployMsg ? (
            <div style={{
              fontSize: 12, marginTop: 6, fontWeight: 600,
              color: deployState === 'failed' ? 'var(--danger)' : deployState === 'done' ? 'var(--ok)' : 'var(--accent)',
            }}>{deployMsg}</div>
          ) : null}
        </div>
        {deployState === 'confirm' ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-glass btn-sm" onClick={() => setDeployState('idle')}>Cancel</button>
            <button className="btn btn-accent btn-sm" onClick={updateServer}>Yes, update now</button>
          </div>
        ) : (
          <button
            className="btn btn-accent btn-sm"
            disabled={!serverVersion || deployState === 'deploying' || deployState === 'waiting'}
            onClick={() => setDeployState('confirm')}
          >
            {(deployState === 'deploying' || deployState === 'waiting')
              ? <><span className="material-symbols-outlined anim-spin" style={{ fontSize: 16 }}>progress_activity</span> Updating…</>
              : <><span className="material-symbols-outlined" style={{ fontSize: 16 }}>cloud_upload</span> Update Server</>}
          </button>
        )}
      </div>

      {loading ? (
        /* SKELETON ROWS: hold the list layout while users load — no bare "Loading…" text. */
        <div className="stack" style={{ gap: 10 }}>
          {[0, 1, 2].map(i => (
            <div key={i} className="surface" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: 140, height: 15, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: 200, height: 12 }} />
              </div>
              <div className="skeleton" style={{ width: 84, height: 32, borderRadius: 10 }} />
            </div>
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="empty-state surface">
          <div className="empty-icon"><span className="material-symbols-outlined">group</span></div>
          <h3>No users yet</h3>
          <p>New signups will appear here waiting for your approval.</p>
        </div>
      ) : (
        <div className="stack stagger" style={{ gap: 10 }}>
          {users.map(user => {
            const chip = STATUS_CHIP[user.status] || STATUS_CHIP.pending
            const isAdmin = user.role === 'admin'
            return (
              <div key={user.id} className="surface" style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '14px 16px',
              }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15 }}>{user.name}</strong>
                    <span className={chip.cls}>{chip.label}</span>
                    {isAdmin ? <span className="chip chip-accent">Admin</span> : null}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{user.email}</div>
                  {user.created_at ? (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Joined {formatDate(user.created_at)}</div>
                  ) : null}
                </div>

                {!isAdmin ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {user.status !== 'approved' ? (
                      <button className="btn btn-solid-white btn-sm" disabled={busyId === user.id} onClick={() => act(user.id, 'approve')}>
                        Approve
                      </button>
                    ) : null}
                    {user.status !== 'rejected' ? (
                      <button className="btn btn-danger btn-sm" disabled={busyId === user.id} onClick={() => act(user.id, 'reject')}>
                        {user.status === 'approved' ? 'Revoke' : 'Reject'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
