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
