import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  addSupporterNote,
  getSupporterChatMessages,
  getSupporterUserDetails,
  getSupporterDashboardUsers,
  resetSupporterChatMessages,
  sendSupporterChatMessage,
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

const SUPPORTER_CHAT_SUGGESTIONS = [
  'What spending trend should I discuss this week?',
  'Draft a gentle check-in message I can send them.',
  'Which transactions look unusual and why?',
  'How can I coach them without taking away independence?',
]

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
  const [activeConcern, setActiveConcern] = useState('snapshot')

  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLanguage, setChatLanguage] = useState('english')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatSending, setChatSending] = useState(false)
  const chatEndRef = useRef(null)

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

  const fetchSupporterChat = useCallback(async (userId) => {
    setChatLoading(true)
    try {
      const data = await getSupporterChatMessages(userId)
      setChatMessages(data.messages || [])
    } finally {
      setChatLoading(false)
    }
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
      setChatMessages([])
      setChatInput('')
      return
    }
    fetchUserDetails(selectedUserId).catch((err) => setError(err.message))
    fetchSupporterChat(selectedUserId).catch((err) => setError(err.message))
  }, [fetchSupporterChat, fetchUserDetails, selectedUserId])

  useEffect(() => {
    if (!userFromQuery) return
    setSelectedUserId(userFromQuery)
  }, [userFromQuery])

  useEffect(() => {
    const chosenUser = users.find((u) => u.id === selectedUserId)
    if (!chosenUser) return
    const supported = LANGUAGES.find((lang) => lang.value === chosenUser.preferred_language)
    setChatLanguage(supported?.value || 'english')
  }, [selectedUserId, users])

  useEffect(() => {
    setActiveConcern('snapshot')
  }, [selectedUserId])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatLoading, chatMessages])

  useEffect(() => {
    const timer = setInterval(() => {
      fetchUsers().catch(() => {})
      if (selectedUserId) fetchUserDetails(selectedUserId).catch(() => {})
      if (selectedUserId) fetchSupporterChat(selectedUserId).catch(() => {})
    }, 10000)
    return () => clearInterval(timer)
  }, [fetchSupporterChat, fetchUserDetails, fetchUsers, selectedUserId])

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

  async function handleSendSupporterChat(prefillMessage) {
    const text = (prefillMessage ?? chatInput).trim()
    if (!selectedUserId || !text) return

    setChatSending(true)
    setError('')
    try {
      const data = await sendSupporterChatMessage(selectedUserId, text, chatLanguage)
      setChatMessages((prev) => ([
        ...prev,
        data.supporter_message,
        data.assistant_message,
      ].filter(Boolean)))
      setChatInput('')
    } catch (err) {
      setError(err.message)
    } finally {
      setChatSending(false)
    }
  }

  async function handleResetSupporterChat() {
    if (!selectedUserId || chatSending) return
    setChatSending(true)
    setError('')
    try {
      await resetSupporterChatMessages(selectedUserId)
      setChatMessages([])
      setChatInput('')
    } catch (err) {
      setError(err.message)
    } finally {
      setChatSending(false)
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
                    <p className="muted" style={{ marginTop: 8 }}>
                      Full care console separated by concern so you can focus on one action at a time.
                    </p>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => navigate('/supporter/alerts')}>Open alerts</button>
                </div>

                <div className="supporter-concern-nav" role="tablist" aria-label="User care concerns">
                  <button className={`supporter-concern-tab${activeConcern === 'snapshot' ? ' active' : ''}`} role="tab" aria-selected={activeConcern === 'snapshot'} onClick={() => setActiveConcern('snapshot')}>Signals & profile</button>
                  <button className={`supporter-concern-tab${activeConcern === 'playbook' ? ' active' : ''}`} role="tab" aria-selected={activeConcern === 'playbook'} onClick={() => setActiveConcern('playbook')}>Care playbook</button>
                  <button className={`supporter-concern-tab${activeConcern === 'controls' ? ' active' : ''}`} role="tab" aria-selected={activeConcern === 'controls'} onClick={() => setActiveConcern('controls')}>Controls</button>
                  <button className={`supporter-concern-tab${activeConcern === 'history' ? ' active' : ''}`} role="tab" aria-selected={activeConcern === 'history'} onClick={() => setActiveConcern('history')}>History</button>
                  <button className={`supporter-concern-tab${activeConcern === 'ai' ? ' active' : ''}`} role="tab" aria-selected={activeConcern === 'ai'} onClick={() => setActiveConcern('ai')}>AI finance copilot</button>
                </div>

                {activeConcern === 'snapshot' && (
                  <section className="supporter-concern-panel" role="tabpanel">
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
                  </section>
                )}

                {activeConcern === 'playbook' && (
                  <section className="supporter-concern-panel" role="tabpanel">
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

                    <section className="supporter-care-section">
                      <h3>Supporter Notes</h3>
                      <textarea
                        className="supporter-note-input"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Add guidance notes for this user..."
                        rows={5}
                      />
                      <button className="btn btn-secondary btn-sm" onClick={handleSaveNote} disabled={saving || !noteText.trim()}>Save note</button>
                    </section>
                  </section>
                )}

                {activeConcern === 'controls' && (
                  <section className="supporter-concern-panel" role="tabpanel">
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
                      </div>
                    </div>
                  </section>
                )}

                {activeConcern === 'ai' && (
                  <section className="supporter-concern-panel" role="tabpanel">
                    <section className="supporter-care-section supp-chat-section">
                      <div className="supp-chat-head">
                        <div>
                          <h3>Talk to AI about this user's finances</h3>
                          <p className="supp-chat-desc">
                            Ask for trends, risk explanations, and supportive scripts. Replies follow your selected language.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={handleResetSupporterChat}
                          disabled={chatSending}
                        >
                          New chat (clear)
                        </button>
                      </div>

                      <div className="supp-chat-messages" aria-live="polite">
                        {!chatLoading && chatMessages.length === 0 && (
                          <div className="supp-chat-empty">
                            <p className="muted">Start a new conversation to get user-specific financial coaching.</p>
                            <div className="supp-chat-suggestions supp-chat-suggestions-inline">
                              {SUPPORTER_CHAT_SUGGESTIONS.map((prompt) => (
                                <button
                                  key={prompt}
                                  type="button"
                                  className="supp-chat-suggestion"
                                  onClick={() => handleSendSupporterChat(prompt)}
                                  disabled={chatSending}
                                >
                                  {prompt}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {chatMessages.map((msg) => (
                          <div key={msg.id || `${msg.role}-${msg.created_at}`} className={`supp-chat-msg supp-chat-msg-${msg.role === 'supporter' ? 'supporter' : 'assistant'}`}>
                            <span className="supp-chat-msg-label">{msg.role === 'supporter' ? 'You' : 'AI Copilot'}</span>
                            <p className="supp-chat-msg-text">{msg.text}</p>
                          </div>
                        ))}

                        {(chatLoading || chatSending) && (
                          <div className="supp-chat-msg supp-chat-msg-assistant">
                            <span className="supp-chat-msg-label">AI Copilot</span>
                            <div className="supp-chat-thinking">
                              <span className="supp-chat-thinking-dot" />
                              <span className="supp-chat-thinking-dot" />
                              <span className="supp-chat-thinking-dot" />
                            </div>
                          </div>
                        )}

                        <div ref={chatEndRef} />
                      </div>

                      <form
                        className="supp-chat-input-row"
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSendSupporterChat()
                        }}
                      >
                        <textarea
                          className="supp-chat-input"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          rows={2}
                          placeholder="Ask about spending patterns, risk, or a supportive message to send"
                          disabled={chatSending}
                        />
                        <button className="supp-chat-send" type="submit" disabled={chatSending || !chatInput.trim()} aria-label="Send message">
                          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M3 11.5L21 3L12.5 21L10.2 13.8L3 11.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </form>

                      <div className="supp-chat-bottom-controls" aria-label="Chat controls">
                        <label className="supporter-upload-lang-label">
                          Reply language
                          <select value={chatLanguage} onChange={(e) => setChatLanguage(e.target.value)}>
                            {LANGUAGES.map((lang) => (
                              <option key={lang.value} value={lang.value}>{lang.label}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setChatInput('')}
                          disabled={chatSending || !chatInput}
                        >
                          Clear input
                        </button>
                      </div>
                    </section>
                  </section>
                )}

                {activeConcern === 'history' && (
                  <section className="supporter-concern-panel" role="tabpanel">
                    <section className="supporter-care-section">
                      <h3>Uploaded document history</h3>
                      <p className="muted" style={{ marginBottom: 10 }}>
                        Recent uploads from this managed user. This list is for quick tracking only.
                      </p>

                      {selectedDetails.statement_history?.length ? (
                        <div className="supporter-history-list" role="list" aria-label="Uploaded statements">
                          {selectedDetails.statement_history.map((doc) => (
                            <div className="supporter-history-row" role="listitem" key={doc.id}>
                              <div className="supporter-history-main">
                                <strong>{doc.original_filename}</strong>
                                <span>Uploaded {formatDateTime(doc.created_at)}</span>
                              </div>
                              <span className={`status-badge status-${doc.status === 'error' ? 'critical' : doc.status === 'processing' ? 'warning' : 'stable'}`}>
                                {doc.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">No uploads yet for this managed user.</p>
                      )}
                    </section>
                  </section>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
