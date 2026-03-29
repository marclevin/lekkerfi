import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteAbsaSession, deleteStatement, listAbsaSessions, listStatements } from '../api/client'
import { readStoredBoolean, subscribeCalmModeChanges, CALM_MODE_KEY } from '../utils/calmMode'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status}</span>
}

// ── Statement history ──────────────────────────────────────────────────────────

function StatementHistory() {
  const navigate = useNavigate()
  const [statements, setStatements] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listStatements()
      .then((d) => setStatements(d.statements || []))
      .catch((e) => setError(e.message))
  }, [])

  async function handleDelete(id, filename) {
    if (!window.confirm(`Remove "${filename}"? This will also delete its insight. Your supporter will be notified.`)) return
    setDeletingId(id)
    try {
      await deleteStatement(id)
      setStatements((prev) => prev.filter((s) => s.id !== id))
    } catch (e) {
      setError(e.message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section>
      <div className="history-section-header">
        <p className="section-label">Statement Uploads</p>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/upload')}>
          + Upload new
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {statements === null && (
        <div className="page-center" style={{ minHeight: 60 }}>
          <div className="spinner" />
        </div>
      )}

      {statements?.length === 0 && (
        <div className="empty-state">
          <p>No statements uploaded yet.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/upload')}>
            Upload your first statement
          </button>
        </div>
      )}

      {statements?.length > 0 && (
        <div className="statement-list">
          {statements.map((stmt) => (
            <div key={stmt.id} className="history-item card">
              <div className="history-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div className="history-item-body">
                <span className="history-item-title">{stmt.original_filename}</span>
                <span className="history-item-sub">{formatDate(stmt.created_at)}</span>
              </div>
              <div className="history-item-right">
                <StatusBadge status={stmt.status} />
                {stmt.status === 'done' && stmt.insight?.id && (
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate('/insights')}>
                    View →
                  </button>
                )}
                <button
                  className="btn btn-danger btn-sm"
                  disabled={deletingId === stmt.id}
                  onClick={() => handleDelete(stmt.id, stmt.original_filename)}
                  aria-label={`Delete ${stmt.original_filename}`}
                >
                  {deletingId === stmt.id ? '…' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── ABSA connection history ────────────────────────────────────────────────────

function AbsaHistory() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listAbsaSessions()
      .then((d) => setSessions(d.sessions || []))
      .catch((e) => setError(e.message))
  }, [])

  async function handleDelete(id) {
    if (!window.confirm('Remove this ABSA connection? Your supporter will be notified.')) return
    setDeletingId(id)
    try {
      await deleteAbsaSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (e) {
      setError(e.message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section>
      <div className="history-section-header">
        <p className="section-label">ABSA Connections</p>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/flow')}>
          + Connect again
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {sessions === null && (
        <div className="page-center" style={{ minHeight: 60 }}>
          <div className="spinner" />
        </div>
      )}

      {sessions !== null && sessions.length === 0 && (
        <div className="empty-state">
          <p>No ABSA connections yet.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/flow')}>
            Link your ABSA account
          </button>
        </div>
      )}

      {sessions?.length > 0 && (
        <div className="statement-list">
          {sessions.map((s) => (
            <div key={s.id} className="history-item card">
              <div className="history-item-icon absa">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
              </div>
              <div className="history-item-body">
                <span className="history-item-title">ABSA Connection</span>
                <span className="history-item-sub">{formatDate(s.created_at)}</span>
                {s.reference_number && (
                  <span className="history-item-sub">Ref: {s.reference_number}</span>
                )}
              </div>
              <div className="history-item-right">
                <StatusBadge status={s.status} />
                <button
                  className="btn btn-danger btn-sm"
                  disabled={deletingId === s.id}
                  onClick={() => handleDelete(s.id)}
                  aria-label="Remove ABSA connection"
                >
                  {deletingId === s.id ? '…' : 'Remove'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Main History page ──────────────────────────────────────────────────────────

export default function History() {
  const navigate = useNavigate()
  const [calmMode, setCalmMode] = useState(() => readStoredBoolean(CALM_MODE_KEY, false))

  useEffect(() => {
    return subscribeCalmModeChanges((snapshot) => {
      const active = snapshot.override ? snapshot.manual : (snapshot.manual || snapshot.auto)
      setCalmMode(Boolean(active))
    })
  }, [])

  if (calmMode) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>History</h1>
          <p>Calm mode keeps one simple next step.</p>
        </div>
        <section className="card calm-essentials-panel" aria-label="Calm mode history action">
          <p className="calm-essentials-copy">Skip detailed history for now and focus on essentials support.</p>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/chat?prefill=Please help me with essentials only and one safe next step.&autosend=1')}
          >
            💬 Ask about essentials
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>History</h1>
        <p>Your past uploads and ABSA connections.</p>
      </div>

      <div className="history-sections">
        <StatementHistory />
        <AbsaHistory />
      </div>
    </div>
  )
}
