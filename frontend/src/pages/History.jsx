import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listInsights, listStatements } from '../api/client'

const LANGUAGES = [
  { value: 'xhosa', label: 'isiXhosa' },
  { value: 'zulu', label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho', label: 'Sesotho' },
  { value: 'english', label: 'English' },
]

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
  const [error, setError] = useState('')

  useEffect(() => {
    listStatements()
      .then((d) => setStatements(d.statements || []))
      .catch((e) => setError(e.message))
  }, [])

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
                {stmt.insight?.accounts?.length > 0 && (
                  <span className="history-item-sub">{stmt.insight.accounts.join(', ')}</span>
                )}
              </div>
              <div className="history-item-right">
                <StatusBadge status={stmt.status} />
                {stmt.status === 'done' && stmt.insight?.id && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => navigate('/insights')}
                  >
                    View →
                  </button>
                )}
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
  const [insights, setInsights] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listInsights()
      .then((d) => setInsights(d.insights || []))
      .catch((e) => setError(e.message))
  }, [])

  // ABSA-generated insights are those that have accounts (they come from live bank data)
  const absaInsights = insights?.filter((ins) => ins.accounts?.length > 0) ?? []

  return (
    <section>
      <div className="history-section-header">
        <p className="section-label">ABSA Connections</p>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/flow')}>
          + Connect again
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {insights === null && (
        <div className="page-center" style={{ minHeight: 60 }}>
          <div className="spinner" />
        </div>
      )}

      {insights !== null && absaInsights.length === 0 && (
        <div className="empty-state">
          <p>No ABSA connections yet.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/flow')}>
            Link your ABSA account
          </button>
        </div>
      )}

      {absaInsights.length > 0 && (
        <div className="statement-list">
          {absaInsights.map((ins) => (
            <div key={ins.id} className="history-item card">
              <div className="history-item-icon absa">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
              </div>
              <div className="history-item-body">
                <span className="history-item-title">{ins.accounts?.join(', ')}</span>
                <span className="history-item-sub">{formatDate(ins.created_at)}</span>
                {ins.translations?.length > 0 && (
                  <span className="history-item-sub">
                    {ins.translations.length} translation{ins.translations.length !== 1 ? 's' : ''}
                    {' · '}
                    {ins.translations.map((t) =>
                      LANGUAGES.find((l) => l.value === t.language)?.label || t.language
                    ).join(', ')}
                  </span>
                )}
              </div>
              <div className="history-item-right">
                <span className="badge badge-done">done</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigate('/insights')}
                >
                  View →
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
