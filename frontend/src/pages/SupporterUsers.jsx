import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  addSupporterNote,
  getSupporterUserDetails,
  getSupporterDashboardUsers,
  setSupporterUserChatPause,
  supporterUploadStatement,
  upsertUserSpendingLimit,
} from '../api/client'
import {
  computeUserSignals,
  formatDateTime,
  formatMoney,
  LANGUAGES,
  riskLabel,
  riskRank,
  SignalCard,
  timeMs,
} from './supporterShared'

export default function SupporterUsers() {
  const navigate = useNavigate()
  const location = useLocation()
  const userFromQuery = useMemo(() => {
    const value = new URLSearchParams(location.search).get('user')
    return value ? Number(value) : null
  }, [location.search])

  const [users, setUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [selectedDetails, setSelectedDetails] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [limits, setLimits] = useState({
    daily_spend_limit: '',
    weekly_spend_limit: '',
    monthly_spend_limit: '',
    min_balance_threshold: '',
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [pauseReasonText, setPauseReasonText] = useState('')

  const [uploadFile, setUploadFile] = useState(null)
  const [uploadLanguage, setUploadLanguage] = useState('english')
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const uploadInputRef = useRef(null)

  const fetchUsers = useCallback(async () => {
    const data = await getSupporterDashboardUsers()
    setUsers(data.users || [])
  }, [])

  const fetchUserDetails = useCallback(async (userId) => {
    const data = await getSupporterUserDetails(userId)
    setSelectedDetails(data)
    const currentLimit = data.spending_limit || {}
    setLimits({
      daily_spend_limit: currentLimit.daily_spend_limit ?? '',
      weekly_spend_limit: currentLimit.weekly_spend_limit ?? '',
      monthly_spend_limit: currentLimit.monthly_spend_limit ?? '',
      min_balance_threshold: currentLimit.min_balance_threshold ?? '',
    })
    const latestNote = (data.notes || [])[0]
    setNoteText(latestNote?.note_text || '')
  }, [])

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchUsers()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [fetchUsers])

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedDetails(null)
      setNoteText('')
      return
    }
    fetchUserDetails(selectedUserId).catch((err) => setError(err.message))
  }, [fetchUserDetails, selectedUserId])

  useEffect(() => {
    if (!userFromQuery) return
    setSelectedUserId(userFromQuery)
  }, [userFromQuery])

  useEffect(() => {
    const timer = setInterval(() => {
      fetchUsers().catch(() => {})
      if (selectedUserId) fetchUserDetails(selectedUserId).catch(() => {})
    }, 10000)
    return () => clearInterval(timer)
  }, [fetchUserDetails, fetchUsers, selectedUserId])

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId],
  )

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const pausedDiff = Number(Boolean(b.chat_pause?.is_paused)) - Number(Boolean(a.chat_pause?.is_paused))
      if (pausedDiff !== 0) return pausedDiff
      const riskDiff = riskRank(b.risk_status) - riskRank(a.risk_status)
      if (riskDiff !== 0) return riskDiff
      const alertDiff = Number(b.active_alert_count || 0) - Number(a.active_alert_count || 0)
      if (alertDiff !== 0) return alertDiff
      return timeMs(b.last_active) - timeMs(a.last_active)
    })
  }, [users])

  const behaviouralSignals = useMemo(() => {
    if (!selectedDetails) return null
    return computeUserSignals(selectedDetails)
  }, [selectedDetails])

  const selectedCareSignals = useMemo(() => {
    if (!selectedDetails?.management) return []
    const signals = []
    const management = selectedDetails.management
    const pauseState = selectedDetails.chat_pause
    if (pauseState?.is_paused) {
      signals.push('Chat currently paused. Confirm supporter decision and safe restart plan before unpausing.')
    }
    if ((management.unread_alert_count || 0) > 0) {
      signals.push(`There are ${management.unread_alert_count} unread alerts needing triage.`)
    }
    if ((management.spike_transaction_count_30d || 0) > 0) {
      signals.push('Recent spend spikes detected. Use calm check-in script before discussing limits.')
    }
    if ((management.spending_7d || 0) > (management.avg_daily_spend_30d || 0) * 10 && (management.avg_daily_spend_30d || 0) > 0) {
      signals.push('Seven-day spending is elevated versus normal baseline. Prioritize short, concrete budgeting steps.')
    }
    if (!management.last_login_at) {
      signals.push('No recent login activity recorded. Consider direct outreach to confirm account access and wellbeing.')
    }
    return signals.slice(0, 4)
  }, [selectedDetails])

  async function handleToggleChatPause(action) {
    if (!selectedUserId) return
    setSaving(true)
    setError('')
    try {
      await setSupporterUserChatPause(selectedUserId, action, pauseReasonText.trim())
      setPauseReasonText('')
      await fetchUsers()
      await fetchUserDetails(selectedUserId)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveLimits() {
    if (!selectedUserId) return
    setSaving(true)
    try {
      await upsertUserSpendingLimit({
        user_id: selectedUserId,
        daily_spend_limit: limits.daily_spend_limit === '' ? null : Number(limits.daily_spend_limit),
        weekly_spend_limit: limits.weekly_spend_limit === '' ? null : Number(limits.weekly_spend_limit),
        monthly_spend_limit: limits.monthly_spend_limit === '' ? null : Number(limits.monthly_spend_limit),
        min_balance_threshold: limits.min_balance_threshold === '' ? null : Number(limits.min_balance_threshold),
      })
      await fetchUserDetails(selectedUserId)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveNote() {
    if (!selectedUserId || !noteText.trim()) return
    setSaving(true)
    try {
      await addSupporterNote({ user_id: selectedUserId, note_text: noteText.trim() })
      await fetchUserDetails(selectedUserId)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSupporterUpload() {
    if (!uploadFile || !selectedUserId) return
    setUploading(true)
    setError('')
    try {
      await supporterUploadStatement(selectedUserId, uploadFile, uploadLanguage)
      setUploadResult('done')
      setUploadFile(null)
      await fetchUserDetails(selectedUserId)
      await fetchUsers()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function handleSelectUser(userId) {
    setSelectedUserId(userId)
    navigate(`/supporter/users?user=${userId}`, { replace: true })
  }

  return (
    <div className="page supporter-dashboard-page">
      <div className="page-header supporter-header">
        <h1>Manage Users</h1>
        <p>Focused user care tools with clear actions per person.</p>
      </div>

      <nav className="supporter-page-nav" aria-label="Supporter sections">
        <Link className="supporter-page-link" to="/supporter">Overview</Link>
        <Link className="supporter-page-link active" to="/supporter/users" aria-current="page">Manage users</Link>
        <Link className="supporter-page-link" to="/supporter/alerts">Alerts</Link>
      </nav>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="page-center"><span className="spinner" /></div>
      ) : (
        <div className="supporter-layout">
          <aside className="supporter-sidebar card" aria-label="Managed users list">
            <div className="supporter-side-top">
              <h2>My Users</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/profile')}>Add</button>
            </div>

            <div className="supporter-user-list">
              {sortedUsers.length === 0 && <p className="muted">No linked users yet.</p>}
              {sortedUsers.map((user) => (
                <button
                  key={user.id}
                  className={`supporter-user-card${selectedUserId === user.id ? ' active' : ''}`}
                  onClick={() => handleSelectUser(user.id)}
                  aria-current={selectedUserId === user.id ? 'true' : undefined}
                >
                  <div className="supporter-user-row">
                    <strong>{user.full_name}</strong>
                    <span className={`status-badge status-${user.risk_status}`}>{riskLabel(user.risk_status)}</span>
                  </div>
                  <div className="supporter-user-meta">
                    <span>Chat: {user.chat_pause?.is_paused ? 'Paused' : 'Active'}</span>
                    <span>Balance: {formatMoney(user.current_balance)}</span>
                    <span>30d spend: {formatMoney(user.avg_30d_spend)}</span>
                    <span>Last login: {formatDateTime(user.last_login_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <section className="supporter-main">
            {!selectedUser && (
              <div className="card empty-state">
                <p>Select a user to open their care console.</p>
              </div>
            )}

            {selectedUser && !selectedDetails && (
              <div className="card page-center" style={{ minHeight: 140 }}>
                <span className="spinner" />
              </div>
            )}

            {selectedUser && selectedDetails && (
              <div className="card supporter-care-panel">
                <div className="supporter-care-header">
                  <div>
                    <h2>{selectedUser.full_name}</h2>
                    <span className={`status-badge status-${selectedUser.risk_status}`} style={{ marginTop: 4, display: 'inline-block' }}>
                      {riskLabel(selectedUser.risk_status)}
                    </span>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => navigate('/supporter/alerts')}>Open alerts</button>
                </div>

                {behaviouralSignals && (
                  <div className="signal-cards" style={{ marginBottom: 12 }}>
                    <SignalCard signal={behaviouralSignals.velocity} />
                    <SignalCard signal={behaviouralSignals.inactivity} />
                    <SignalCard signal={behaviouralSignals.duplicates} />
                  </div>
                )}

                <div className="supporter-management-suite">
                  <div className="supporter-management-item">
                    <p className="supporter-management-label">Last login</p>
                    <p>{formatDateTime(selectedDetails.management?.last_login_at)}</p>
                  </div>
                  <div className="supporter-management-item">
                    <p className="supporter-management-label">Unread alerts</p>
                    <p>{selectedDetails.management?.unread_alert_count ?? 0}</p>
                  </div>
                  <div className="supporter-management-item">
                    <p className="supporter-management-label">7d spend</p>
                    <p>{formatMoney(selectedDetails.management?.spending_7d)}</p>
                  </div>
                  <div className="supporter-management-item">
                    <p className="supporter-management-label">30d spend</p>
                    <p>{formatMoney(selectedDetails.management?.spending_30d)}</p>
                  </div>
                  <div className="supporter-management-item">
                    <p className="supporter-management-label">30d income</p>
                    <p>{formatMoney(selectedDetails.management?.income_30d)}</p>
                  </div>
                  <div className="supporter-management-item">
                    <p className="supporter-management-label">Spend spikes</p>
                    <p>{selectedDetails.management?.spike_transaction_count_30d ?? 0}</p>
                  </div>
                </div>

                <div className="supporter-care-playbook">
                  <h3>Calm care playbook</h3>
                  {selectedCareSignals.length > 0 ? (
                    <ul className="supporter-care-list">
                      {selectedCareSignals.map((signal, idx) => (
                        <li key={`${signal}-${idx}`}>{signal}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No immediate care flags. Continue routine check-ins and positive reinforcement.</p>
                  )}
                </div>

                <div className="supporter-care-columns">
                  <div className="supporter-care-col">
                    <section className="supporter-care-section">
                      <h3>Upload Statement</h3>
                      <p className="muted">Upload a bank statement on behalf of {selectedUser.full_name.split(' ')[0]}.</p>
                      {uploadResult === 'done' ? (
                        <div className="callout callout-success" style={{ marginTop: 10 }}>
                          <span className="callout-icon">✅</span>
                          <div className="callout-body">
                            Statement uploaded and analysed.
                            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => setUploadResult(null)}>Upload another</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`supporter-upload-zone${uploadFile ? ' has-file' : ''}`}
                            onClick={() => uploadInputRef.current?.click()}
                            aria-label="Click to select a statement file"
                          >
                            <input
                              ref={uploadInputRef}
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png,.webp"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                setUploadFile(e.target.files?.[0] || null)
                                setUploadResult(null)
                              }}
                            />
                            {uploadFile ? (
                              <>
                                <span className="supporter-upload-icon">📄</span>
                                <span className="supporter-upload-filename">{uploadFile.name}</span>
                                <span className="supporter-upload-hint">Click to change</span>
                              </>
                            ) : (
                              <>
                                <span className="supporter-upload-icon">⬆</span>
                                <span className="supporter-upload-hint">PDF, JPG, PNG, or WebP</span>
                              </>
                            )}
                          </button>
                          <div className="supporter-upload-controls">
                            <label className="supporter-upload-lang-label">
                              Language
                              <select value={uploadLanguage} onChange={(e) => setUploadLanguage(e.target.value)}>
                                {LANGUAGES.map((l) => (
                                  <option key={l.value} value={l.value}>{l.label}</option>
                                ))}
                              </select>
                            </label>
                            <button className="btn btn-primary btn-sm" onClick={handleSupporterUpload} disabled={!uploadFile || uploading}>
                              {uploading ? 'Uploading…' : 'Upload & Analyse'}
                            </button>
                          </div>
                        </>
                      )}
                    </section>

                    <section className="supporter-care-section">
                      <h3>Chat Control</h3>
                      <div className="supporter-chat-control">
                        <p>Current state: <strong>{selectedDetails.chat_pause?.is_paused ? 'Paused' : 'Active'}</strong></p>
                        {selectedDetails.chat_pause?.paused_reason && <p>Reason: {selectedDetails.chat_pause.paused_reason}</p>}
                        {selectedDetails.chat_pause?.paused_at && <p>Paused at: {formatDateTime(selectedDetails.chat_pause.paused_at)}</p>}
                        <textarea
                          className="supporter-note-input"
                          value={pauseReasonText}
                          onChange={(e) => setPauseReasonText(e.target.value)}
                          placeholder="Optional reason shown to user"
                          rows={2}
                        />
                        <div className="supporter-alert-actions">
                          {!selectedDetails.chat_pause?.is_paused ? (
                            <button className="btn btn-secondary btn-sm" onClick={() => handleToggleChatPause('pause')} disabled={saving}>Pause chat</button>
                          ) : (
                            <button className="btn btn-primary btn-sm" onClick={() => handleToggleChatPause('unpause')} disabled={saving}>Unpause chat</button>
                          )}
                        </div>
                      </div>
                    </section>
                  </div>

                  <div className="supporter-care-col">
                    <section className="supporter-care-section">
                      <h3>Spending Limits</h3>
                      <div className="supporter-limit-grid">
                        <label>Daily limit<input type="number" value={limits.daily_spend_limit} onChange={(e) => setLimits((prev) => ({ ...prev, daily_spend_limit: e.target.value }))} /></label>
                        <label>Weekly limit<input type="number" value={limits.weekly_spend_limit} onChange={(e) => setLimits((prev) => ({ ...prev, weekly_spend_limit: e.target.value }))} /></label>
                        <label>Monthly limit<input type="number" value={limits.monthly_spend_limit} onChange={(e) => setLimits((prev) => ({ ...prev, monthly_spend_limit: e.target.value }))} /></label>
                        <label>Min balance alert<input type="number" value={limits.min_balance_threshold} onChange={(e) => setLimits((prev) => ({ ...prev, min_balance_threshold: e.target.value }))} /></label>
                      </div>
                      <button className="btn btn-primary btn-sm" onClick={handleSaveLimits} disabled={saving}>Save limits</button>
                    </section>

                    <section className="supporter-care-section">
                      <h3>Supporter Notes</h3>
                      <textarea
                        className="supporter-note-input"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Add guidance notes for this user..."
                        rows={4}
                      />
                      <button className="btn btn-secondary btn-sm" onClick={handleSaveNote} disabled={saving || !noteText.trim()}>Save note</button>
                    </section>
                  </div>
                </div>

                <section className="supporter-transactions">
                  <h3>Recent Transactions</h3>
                  {selectedDetails.transactions?.length ? (
                    <div className="supporter-tx-list">
                      {selectedDetails.transactions.slice(0, 10).map((tx, idx) => (
                        <div key={`${tx.date}-${idx}`} className="supporter-tx-row">
                          <span>{tx.date || 'N/A'}</span>
                          <span>{tx.description || 'Unknown transaction'}</span>
                          <strong>{formatMoney(tx.amount)}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No transactions available yet.</p>
                  )}
                </section>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
