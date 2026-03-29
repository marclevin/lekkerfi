import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  addSupporter, deleteAbsaSession, deleteStatement, getIncomingLinkRequests, listAbsaSessions, listMySuporters, listMyUsers, listStatements, registerUser,
  removeSupporter, respondLinkRequest, searchSupporters, uploadProfilePicture,
} from '../api/client'
import { useAuth } from '../context/AuthContext'
import { readStoredBoolean, subscribeCalmModeChanges, CALM_MODE_KEY } from '../utils/calmMode'

const LANGUAGES = [
  { value: 'english',   label: 'English' },
  { value: 'xhosa',     label: 'isiXhosa' },
  { value: 'zulu',      label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho',     label: 'Sesotho' },
]

function Section({ title, children }) {
  return (
    <div className="profile-section card">
      <p className="section-label">{title}</p>
      {children}
    </div>
  )
}

function Field({ label, value, hint }) {
  return (
    <div className="profile-field">
      <span className="profile-field-label">{label}</span>
      <span className="profile-field-value">{value || '—'}</span>
      {hint && <span className="profile-field-hint">{hint}</span>}
    </div>
  )
}

// ── Formatting helpers (from History & SpendingLimits) ────────────────────────

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status}</span>
}

function fmt(value) {
  if (value == null) return 'Not set'
  return `R ${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function LimitRow({ label, value }) {
  const isSet = value != null
  return (
    <div className="spending-limit-row">
      <span className="spending-limit-label">{label}</span>
      <span className={`spending-limit-value${isSet ? ' spending-limit-set' : ' spending-limit-unset'}`}>
        {fmt(value)}
      </span>
    </div>
  )
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

  if (!statements) {
    return (
      <div className="page-center" style={{ minHeight: 60 }}>
        <div className="spinner" />
      </div>
    )
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

  if (!sessions) {
    return (
      <div className="page-center" style={{ minHeight: 60 }}>
        <div className="spinner" />
      </div>
    )
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
          {sessions.map((s) => {
            let selectedAccountsList = []
            try {
              const parsed = JSON.parse(s.selected_accounts || '[]')
              selectedAccountsList = Array.isArray(parsed) ? parsed : []
            } catch {
              // Silent fail if selected_accounts is not valid JSON
            }

            return (
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
                  {selectedAccountsList.length > 0 && (
                    <span className="history-item-sub">
                      Accounts: {selectedAccountsList.join(', ')}
                    </span>
                  )}
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
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── Spending limits section (from SpendingLimits page) ────────────────────────

function SpendingLimitsSection() {
  const [supporters, setSupporters] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listMySuporters()
      .then((d) => setSupporters(d.supporters || []))
      .catch((e) => setError(e.message))
  }, [])

  if (!supporters) {
    return (
      <div className="page-center" style={{ minHeight: 60 }}>
        <span className="spinner" />
      </div>
    )
  }

  const supportersWithLimits = supporters.filter(
    (s) => s.spending_limit != null && s.is_registered,
  )

  return (
    <>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {supportersWithLimits.length === 0 && (
        <div className="card empty-state">
          <p style={{ fontSize: '2rem', marginBottom: 8 }}>🛡️</p>
          <p>No spending limits have been set for you yet.</p>
          <p className="muted" style={{ marginTop: 4 }}>
            Your trusted supporter can set daily, weekly, and monthly limits to help you manage your money.
          </p>
        </div>
      )}

      {supportersWithLimits.map((s) => {
        const lim = s.spending_limit
        return (
          <div key={s.id} className="card spending-limit-card">
            <div className="spending-limit-header">
              <span className="spending-limit-supporter-icon" aria-hidden="true">🤝</span>
              <div>
                <p className="spending-limit-supporter-name">{s.display_name}</p>
                <p className="spending-limit-supporter-label">Set by your supporter</p>
              </div>
            </div>
            <div className="spending-limit-rows">
              <LimitRow label="Daily limit" value={lim.daily_spend_limit} />
              <LimitRow label="Weekly limit" value={lim.weekly_spend_limit} />
              <LimitRow label="Monthly limit" value={lim.monthly_spend_limit} />
              <LimitRow label="Low balance alert" value={lim.min_balance_threshold} />
            </div>
            <p className="spending-limit-footer">
              Last updated {new Date(lim.updated_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        )
      })}
    </>
  )
}

// ── Supporter manager (for regular users) ─────────────────────────────────────

function SupporterManager() {
  const [supporters, setSupporters] = useState(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const [showManual, setShowManual] = useState(false)
  const [manual, setManual] = useState({ display_name: '', contact: '' })
  const [addingManual, setAddingManual] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const debounceRef = useRef(null)

  useEffect(() => {
    listMySuporters()
      .then((d) => setSupporters(d.supporters || []))
      .catch(() => setSupporters([]))
  }, [])

  function handleQueryChange(e) {
    const val = e.target.value
    setQuery(val)
    setSearchResults([])
    clearTimeout(debounceRef.current)
    if (val.trim().length < 2) return
    debounceRef.current = setTimeout(() => {
      setSearching(true)
      searchSupporters(val.trim())
        .then((d) => setSearchResults(d.supporters || []))
        .catch(() => {})
        .finally(() => setSearching(false))
    }, 300)
  }

  async function handleAddRegistered(sup) {
    setError('')
    setAddingId(sup.id)
    try {
      const data = await addSupporter({ linked_supporter_id: sup.id })
      setSupporters((prev) => [...(prev || []), data.supporter])
      setQuery('')
      setSearchResults([])
      flash('Added to your Support Circle')
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingId(null)
    }
  }

  async function handleAddManual(e) {
    e.preventDefault()
    if (!manual.display_name.trim()) return
    setError('')
    setAddingManual(true)
    try {
      const data = await addSupporter({
        display_name: manual.display_name.trim(),
        contact: manual.contact.trim(),
      })
      setSupporters((prev) => [...(prev || []), data.supporter])
      setManual({ display_name: '', contact: '' })
      setShowManual(false)
      flash('Added to your Support Circle')
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingManual(false)
    }
  }

  async function handleRemove(id) {
    setError('')
    setRemovingId(id)
    try {
      await removeSupporter(id)
      setSupporters((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      setError(err.message)
    } finally {
      setRemovingId(null)
    }
  }

  function flash(msg) {
    setSuccess(msg)
    setTimeout(() => setSuccess(''), 2500)
  }

  const linkedIds = new Set((supporters || []).map((s) => s.linked_supporter_id).filter(Boolean))

  return (
    <div className="supporter-manager">
      <p className="profile-section-desc">
        Supporters are trusted people — like a family member or friend — who help you make good decisions with your money.
        They don't see your account; they're just there for you.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Search registered supporters */}
      <div className="sm-search-wrap">
        <label className="sm-search-label">Find a registered supporter</label>
        <div className="sm-search-box">
          <svg className="sm-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="sm-search-input"
            type="text"
            placeholder="Search by name or email…"
            value={query}
            onChange={handleQueryChange}
          />
          {searching && <div className="spinner sm-spinner" />}
        </div>

        {searchResults.length > 0 && (
          <div className="sm-search-results">
            {searchResults.map((r) => {
              const alreadyAdded = linkedIds.has(r.id)
              return (
                <div key={r.id} className="sm-result-item">
                  <div className="sm-result-avatar">{(r.display_name || '?')[0].toUpperCase()}</div>
                  <div className="sm-result-info">
                    <span className="sm-result-name">{r.display_name}</span>
                    <span className="sm-result-email">{r.email}</span>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={alreadyAdded || addingId === r.id}
                    onClick={() => handleAddRegistered(r)}
                  >
                    {alreadyAdded ? 'Added' : addingId === r.id ? '…' : '+ Add'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {query.length >= 2 && !searching && searchResults.length === 0 && (
          <p className="sm-no-results">No registered supporters found. Try adding someone manually below.</p>
        )}
      </div>

      {/* Current supporters */}
      {supporters === null ? (
        <div className="spinner" style={{ margin: '10px auto' }} />
      ) : supporters.length > 0 ? (
        <div className="sm-current">
          <p className="sm-current-label">Your Support Circle</p>
          {supporters.map((s) => (
            <div key={s.id} className="sm-current-item">
              <div className="managed-user-avatar" style={{ background: s.is_registered ? 'var(--blue-light)' : 'var(--gray-100)', color: s.is_registered ? 'var(--blue)' : 'var(--gray-600)' }}>
                {(s.display_name || '?')[0].toUpperCase()}
              </div>
              <div className="managed-user-info">
                <span className="managed-user-name">
                  {s.display_name}
                  {s.is_registered && <span className="sc-reg-badge" style={{ marginLeft: 6 }}>Registered</span>}
                </span>
                {s.contact && <span className="managed-user-email">{s.contact}</span>}
              </div>
              <button
                className="sm-remove-btn"
                onClick={() => handleRemove(s.id)}
                disabled={removingId === s.id}
                title="Remove supporter"
              >
                {removingId === s.id ? '…' : '✕'}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Manual add */}
      {!showManual ? (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setShowManual(true)}>
          + Add someone manually (name + contact)
        </button>
      ) : (
        <form className="supporter-add-form" onSubmit={handleAddManual}>
          <p className="supporter-add-title">Add someone manually</p>
          <p style={{ fontSize: '0.82rem', color: 'var(--gray-600)', marginBottom: 8 }}>
            They don't need a LekkerFi account. You can reach them via phone or email instead.
          </p>
          <div className="form-group">
            <label htmlFor="man-name">Their name</label>
            <input
              id="man-name"
              className="input"
              type="text"
              placeholder="e.g. Mom, Thabo, Pastor Dube"
              value={manual.display_name}
              onChange={(e) => setManual((m) => ({ ...m, display_name: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="man-contact">Phone or email (optional)</label>
            <input
              id="man-contact"
              className="input"
              type="text"
              placeholder="+27 82 123 4567 or name@email.com"
              value={manual.contact}
              onChange={(e) => setManual((m) => ({ ...m, contact: e.target.value }))}
            />
          </div>
          <div className="profile-form-actions">
            <button className="btn btn-primary" type="submit" disabled={addingManual}>
              {addingManual ? 'Adding…' : 'Add supporter'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => { setShowManual(false); setError('') }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Pending link requests (for regular users) ─────────────────────────────────

function LinkRequestsSection() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [responding, setResponding] = useState(null)
  const [error, setError] = useState('')

  function reload() {
    setLoading(true)
    getIncomingLinkRequests()
      .then((d) => setRequests(d.requests || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  async function handleRespond(id, action) {
    setResponding(id)
    try {
      await respondLinkRequest(id, action)
      reload()
    } catch (e) {
      setError(e.message)
    } finally {
      setResponding(null)
    }
  }

  if (loading) return <div className="page-center" style={{ minHeight: 60 }}><span className="spinner" /></div>
  if (requests.length === 0) return null

  return (
    <div className="profile-section card link-requests-section">
      <p className="section-label">Supporter Requests</p>
      {error && <div className="alert alert-error">{error}</div>}
      {requests.map((r) => (
        <div key={r.id} className="link-request-row">
          <div>
            <strong>{r.supporter_name}</strong>
            <span className="muted" style={{ marginLeft: 6, fontSize: '0.82rem' }}>{r.supporter_email}</span>
            <p className="link-request-desc">wants to be your trusted supporter</p>
          </div>
          <div className="link-request-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleRespond(r.id, 'approve')}
              disabled={responding === r.id}
            >
              {responding === r.id ? '…' : 'Approve'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => handleRespond(r.id, 'decline')}
              disabled={responding === r.id}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Supporter: managed users list + add form ───────────────────────────────────

function SupporterSection() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    access_account: '',
    preferred_language: user?.preferred_language || 'english',
  })
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState('')

  useEffect(() => {
    listMyUsers()
      .then((d) => setUsers(d.users || []))
      .catch(() => {})
      .finally(() => setLoadingUsers(false))
  }, [])

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleAdd(e) {
    e.preventDefault()
    setAddError('')
    setAddSuccess('')
    setAdding(true)
    try {
      const data = await registerUser(form)
      setUsers((prev) => [data.user, ...prev])
      setAddSuccess(`Account created for ${data.user.full_name || data.user.email}`)
      setForm({ full_name: '', email: '', password: '', access_account: '', preferred_language: user?.preferred_language || 'english' })
      setShowForm(false)
      setTimeout(() => setAddSuccess(''), 3000)
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <Section title="Managed users">
      <p className="profile-section-desc">
        These are the people whose accounts you manage. You can create a new account on their behalf below.
      </p>

      {addSuccess && <div className="alert alert-success">{addSuccess}</div>}

      {loadingUsers ? (
        <div className="spinner" style={{ margin: '12px auto' }} />
      ) : users.length === 0 ? (
        <p className="profile-empty-msg">No managed users yet.</p>
      ) : (
        <div className="managed-users-list">
          {users.map((u) => (
            <div key={u.id} className="managed-user-item">
              <div className="managed-user-avatar">
                {(u.full_name || u.email)[0].toUpperCase()}
              </div>
              <div className="managed-user-info">
                <span className="managed-user-name">{u.full_name || u.email.split('@')[0]}</span>
                <span className="managed-user-email">{u.email}</span>
              </div>
              <span className="managed-user-lang">{u.preferred_language}</span>
            </div>
          ))}
        </div>
      )}

      {!showForm ? (
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => setShowForm(true)}>
          + Add user
        </button>
      ) : (
        <form className="supporter-add-form" onSubmit={handleAdd}>
          <p className="supporter-add-title">Create account for someone</p>
          {addError && <div className="alert alert-error">{addError}</div>}
          <div className="form-group">
            <label htmlFor="su-name">Their name</label>
            <input id="su-name" name="full_name" className="input" type="text" placeholder="e.g. Thabo Nkosi" value={form.full_name} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label htmlFor="su-email">Their email</label>
            <input id="su-email" name="email" className="input" type="email" value={form.email} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="su-password">Set a password for them</label>
            <input id="su-password" name="password" className="input" type="password" value={form.password} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="su-account">Their ABSA account number</label>
            <input id="su-account" name="access_account" className="input" type="text" placeholder="e.g. 4048195297" value={form.access_account} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label htmlFor="su-lang">Preferred language</label>
            <select id="su-lang" name="preferred_language" value={form.preferred_language} onChange={handleChange}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          <div className="profile-form-actions">
            <button className="btn btn-primary" type="submit" disabled={adding}>{adding ? 'Creating…' : 'Create account'}</button>
            <button className="btn btn-ghost" type="button" onClick={() => { setShowForm(false); setAddError('') }}>Cancel</button>
          </div>
        </form>
      )}
    </Section>
  )
}

// ── Main profile page ──────────────────────────────────────────────────────────

export default function Profile() {
  const { user, saveProfile, logout } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [preferredLanguage, setPreferredLanguage] = useState('english')
  const [accessAccount, setAccessAccount] = useState('')
  const [userNumber, setUserNumber] = useState('1')
  const [userEmail, setUserEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [calmMode, setCalmMode] = useState(() => readStoredBoolean(CALM_MODE_KEY, false))
  const [uploadingPicture, setUploadingPicture] = useState(false)
  const [pictureError, setPictureError] = useState('')
  const [picturePreview, setPicturePreview] = useState(null)
  const [profilePictureUrl, setProfilePictureUrl] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    setFullName(user?.full_name || '')
    setPreferredLanguage(user?.preferred_language || 'english')
    setAccessAccount(user?.access_account || '')
    setUserNumber(user?.user_number || '1')
    setUserEmail(user?.user_email || '')
  }, [user?.full_name, user?.preferred_language, user?.access_account, user?.user_number, user?.user_email])

  useEffect(() => {
    return subscribeCalmModeChanges((snapshot) => {
      const active = snapshot.override ? snapshot.manual : (snapshot.manual || snapshot.auto)
      setCalmMode(Boolean(active))
    })
  }, [])

  // Load profile picture with proper auth header
  useEffect(() => {
    if (!user?.id) return

    const loadProfilePicture = async () => {
      try {
        const token = localStorage.getItem('token')
        const response = await fetch('/api/auth/profile-picture', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (response.ok) {
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          setProfilePictureUrl(url)
        } else {
          setProfilePictureUrl(null)
        }
      } catch (err) {
        setProfilePictureUrl(null)
      }
    }

    loadProfilePicture()

    // Cleanup blob URL on unmount
    return () => {
      if (profilePictureUrl) {
        URL.revokeObjectURL(profilePictureUrl)
      }
    }
  }, [user?.id])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      await saveProfile({
        full_name: fullName,
        preferred_language: preferredLanguage,
        access_account: accessAccount,
        user_number: userNumber || '1',
        user_email: userEmail,
      })
      try { localStorage.setItem('lekkerfi_chat_lang', preferredLanguage) } catch {}
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message || 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function handleLogout() {
    logout()
    navigate('/login')
  }

  async function handlePictureUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/jpeg') && !file.type.startsWith('image/png')) {
      setPictureError('Only JPG and PNG images are allowed')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setPictureError('File size must be under 5MB')
      return
    }

    // Show preview
    const reader = new FileReader()
    reader.onload = (evt) => {
      setPicturePreview(evt.target.result)
    }
    reader.readAsDataURL(file)

    // Upload
    setPictureError('')
    setUploadingPicture(true)
    try {
      await uploadProfilePicture(file)
      // Clear the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      // Reload the profile picture from server
      const token = localStorage.getItem('token')
      const response = await fetch('/api/auth/profile-picture', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      if (response.ok) {
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        if (profilePictureUrl) {
          URL.revokeObjectURL(profilePictureUrl)
        }
        setProfilePictureUrl(url)
      }
      setPicturePreview(null)
    } catch (err) {
      setPictureError(err.message || 'Failed to upload picture. Please try again.')
      setPicturePreview(null)
    } finally {
      setUploadingPicture(false)
    }
  }

  const displayName = user?.full_name || user?.email?.split('@')[0] || 'Profile'
  const initials = displayName[0]?.toUpperCase() ?? '?'
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
    : null
  const isSupporter = user?.role === 'supporter'

  // Calm mode alternative for users
  if (!isSupporter && calmMode) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Profile</h1>
          <p>Calm mode keeps one simple next step.</p>
        </div>
        <section className="card calm-essentials-panel" aria-label="Calm mode profile action">
          <p className="calm-essentials-copy">Skip detailed profile for now and focus on essentials support.</p>
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
    <div className="page profile-page">
      <div className="profile-hero">
        <div style={{ position: 'relative' }}>
          {picturePreview || profilePictureUrl ? (
            <img
              src={picturePreview || profilePictureUrl}
              alt="Profile"
              className="profile-avatar-lg"
              style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', background: 'var(--gray-100)' }}
              onError={() => {
                // If image fails to load, show initials
                if (!picturePreview) {
                  setProfilePictureUrl(null)
                }
              }}
            />
          ) : (
            <div className="profile-avatar-lg">{initials}</div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handlePictureUpload}
            style={{ display: 'none' }}
            disabled={uploadingPicture}
          />
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingPicture}
            style={{ position: 'absolute', bottom: -4, right: -4, padding: 6, fontSize: '0.8rem' }}
            title="Change profile picture"
          >
            {uploadingPicture ? '⟳' : '✎'}
          </button>
        </div>
        <div className="profile-hero-text">
          <h1 className="profile-name">{displayName}</h1>
          <div className="profile-hero-meta">
            {isSupporter && <span className="role-badge role-badge-supporter">Trusted Supporter</span>}
            {memberSince && <p className="profile-since">Member since {memberSince}</p>}
          </div>
        </div>
      </div>

      {pictureError && <div className="alert alert-error" style={{ margin: '12px 0' }}>{pictureError}</div>}

      {/* ── Account info ── */}
      <Section title="Account">
        <Field label="Email" value={user?.email} hint="Cannot be changed" />
      </Section>

      {/* ── Personal info + ABSA details ── */}
      <Section title="Personal info">
        <form className="profile-form" onSubmit={handleSave}>
          <div className="form-group">
            <label htmlFor="full-name">Full name</label>
            <input
              id="full-name"
              className="input"
              type="text"
              placeholder="Your name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          {!isSupporter && (
            <>
              <p className="profile-section-subhead">ABSA account details</p>
              <div className="form-group">
                <label htmlFor="access-account">
                  Access account number
                  <span className="label-hint"> — your primary ABSA account</span>
                </label>
                <input
                  id="access-account"
                  className="input"
                  type="text"
                  placeholder="e.g. 4048195297"
                  value={accessAccount}
                  onChange={(e) => setAccessAccount(e.target.value)}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="user-number">
                    User number
                    <span className="label-hint"> — usually 1</span>
                  </label>
                  <input
                    id="user-number"
                    className="input"
                    type="text"
                    placeholder="1"
                    value={userNumber}
                    onChange={(e) => setUserNumber(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="user-email">
                    SureCheck email
                    <span className="label-hint"> — leave blank to use login email</span>
                  </label>
                  <input
                    id="user-email"
                    className="input"
                    type="email"
                    placeholder="Optional"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div className="form-group">
            <label htmlFor="preferred-language">Preferred language</label>
            <select
              id="preferred-language"
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="profile-form-actions">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {saved && <span className="profile-saved-msg">Saved</span>}
          </div>
        </form>
      </Section>

      {/* ── Pending link requests (regular users only) ── */}
      {!isSupporter && <LinkRequestsSection />}

      {/* ── Support Circle (regular users only) ── */}
      {!isSupporter && (
        <Section title="Support Circle">
          <SupporterManager />
        </Section>
      )}

      {/* ── Spending limits (regular users only) ── */}
      {!isSupporter && (
        <Section title="Spending Limits">
          <p className="profile-section-desc">Your trusted supporter may have set daily, weekly, or monthly spending limits to help you stay on track.</p>
          <SpendingLimitsSection />
        </Section>
      )}

      {/* ── History sections (regular users only) ── */}
      {!isSupporter && (
        <Section title="History">
          <div className="history-sections">
            <StatementHistory />
            <AbsaHistory />
          </div>
        </Section>
      )}

      {/* ── Supporter: managed users ── */}
      {isSupporter && <SupporterSection />}

      {/* ── Session ── */}
      <Section title="Session">
        <p className="profile-section-desc">Signing out will clear your session on this device.</p>
        <button className="btn btn-danger" onClick={handleLogout}>
          Sign out
        </button>
      </Section>
    </div>
  )
}
