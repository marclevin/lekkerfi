import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  addSupporterNote,
  getSupporterChatMessages,
  getSupporterDashboardUsers,
  getSupporterUserDetails,
  getUserFinanceChat,
  injectSupporterMessage,
  resetSupporterChatMessages,
  sendSupporterChatMessage,
  setSupporterUserChatPause,
  upsertUserSpendingLimit,
} from '../api/client'
import {
  computeUserSignals,
  formatDateTime,
  formatMoney,
  LANGUAGES,
  riskLabel,
  SignalCard,
} from './supporterShared'

const SUPPORTER_CHAT_SUGGESTIONS = [
  'What spending trend should I discuss this week?',
  'Draft a gentle check-in message I can send them.',
  'Which transactions look unusual and why?',
  'How can I coach them without taking away independence?',
]

export default function SupporterUserPage() {
  const { userId: userIdParam } = useParams()
  const userId = Number(userIdParam)
  const navigate = useNavigate()

  const [user, setUser] = useState(null)
  const [details, setDetails] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [activeConcern, setActiveConcern] = useState('snapshot')

  const [noteText, setNoteText] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [limits, setLimits] = useState({
    daily_spend_limit: '',
    weekly_spend_limit: '',
    monthly_spend_limit: '',
    min_balance_threshold: '',
  })
  const [pauseReasonText, setPauseReasonText] = useState('')
  const [financeChat, setFinanceChat] = useState(null)
  const [injectText, setInjectText] = useState('')
  const [injecting, setInjecting] = useState(false)

  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLanguage, setChatLanguage] = useState('english')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatSending, setChatSending] = useState(false)
  const chatEndRef = useRef(null)


  const fetchDetails = useCallback(async () => {
    const data = await getSupporterUserDetails(userId)
    setDetails(data)
    const currentLimit = data.spending_limit || {}
    setLimits({
      daily_spend_limit: currentLimit.daily_spend_limit ?? '',
      weekly_spend_limit: currentLimit.weekly_spend_limit ?? '',
      monthly_spend_limit: currentLimit.monthly_spend_limit ?? '',
      min_balance_threshold: currentLimit.min_balance_threshold ?? '',
    })
    const latestNote = (data.notes || [])[0]
    setNoteText(latestNote?.note_text || '')
  }, [userId])

  const fetchChat = useCallback(async () => {
    setChatLoading(true)
    try {
      const data = await getSupporterChatMessages(userId)
      setChatMessages(data.messages || [])
    } finally {
      setChatLoading(false)
    }
  }, [userId])

  // Resolve user name from users list
  useEffect(() => {
    getSupporterDashboardUsers()
      .then((d) => {
        const found = (d.users || []).find((u) => u.id === userId)
        setUser(found || null)
        if (found) {
          const lang = LANGUAGES.find((l) => l.value === found.preferred_language)
          setChatLanguage(lang?.value || 'english')
        }
      })
      .catch(() => {})
  }, [userId])

  useEffect(() => {
    setError('')
    fetchDetails().catch((e) => setError(e.message))
    fetchChat().catch((e) => setError(e.message))
    getUserFinanceChat(userId).then(setFinanceChat).catch(() => {})
  }, [fetchDetails, fetchChat, userId])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatLoading])

  // Refresh every 10s
  useEffect(() => {
    const timer = setInterval(() => {
      fetchDetails().catch(() => {})
      fetchChat().catch(() => {})
    }, 10000)
    return () => clearInterval(timer)
  }, [fetchDetails, fetchChat])

  const signals = useMemo(() => {
    if (!details) return null
    return computeUserSignals(details)
  }, [details])

  const careSignals = useMemo(() => {
    if (!details?.management) return []
    const signals = []
    const management = details.management
    const pauseState = details.chat_pause
    if (pauseState?.is_paused) signals.push('Chat currently paused. Confirm supporter decision and safe restart plan before unpausing.')
    if ((management.unread_alert_count || 0) > 0) signals.push(`There are ${management.unread_alert_count} unread alerts needing triage.`)
    if ((management.spike_transaction_count_30d || 0) > 0) signals.push('Recent spend spikes detected. Use calm check-in script before discussing limits.')
    if ((management.spending_7d || 0) > (management.avg_daily_spend_30d || 0) * 10 && (management.avg_daily_spend_30d || 0) > 0) {
      signals.push('Seven-day spending is elevated versus normal baseline. Prioritize short, concrete budgeting steps.')
    }
    if (!management.last_login_at) signals.push('No recent login activity recorded. Consider direct outreach to confirm account access and wellbeing.')
    return signals.slice(0, 4)
  }, [details])

  async function handleInjectMessage() {
    if (!injectText.trim()) return
    setInjecting(true)
    try {
      await injectSupporterMessage(userId, injectText.trim())
      setInjectText('')
      getUserFinanceChat(userId).then(setFinanceChat).catch(() => {})
    } catch (e) { setError(e.message) }
    finally { setInjecting(false) }
  }

  async function handleToggleChatPause(action) {
    setSaving(true)
    try {
      await setSupporterUserChatPause(userId, action, pauseReasonText.trim())
      setPauseReasonText('')
      await fetchDetails()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleSaveLimits() {
    setSaving(true)
    try {
      await upsertUserSpendingLimit({
        user_id: userId,
        daily_spend_limit: limits.daily_spend_limit === '' ? null : Number(limits.daily_spend_limit),
        weekly_spend_limit: limits.weekly_spend_limit === '' ? null : Number(limits.weekly_spend_limit),
        monthly_spend_limit: limits.monthly_spend_limit === '' ? null : Number(limits.monthly_spend_limit),
        min_balance_threshold: limits.min_balance_threshold === '' ? null : Number(limits.min_balance_threshold),
      })
      await fetchDetails()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleSaveNote() {
    if (!noteText.trim()) return
    setNoteSaved(false)
    setSaving(true)
    try {
      await addSupporterNote({ user_id: userId, note_text: noteText.trim() })
      await fetchDetails()
      setNoteSaved(true)
      setTimeout(() => setNoteSaved(false), 2200)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleSendSupporterChat(prefill) {
    const text = (prefill ?? chatInput).trim()
    if (!text) return
    setChatSending(true)
    try {
      const data = await sendSupporterChatMessage(userId, text, chatLanguage)
      setChatMessages((prev) => ([...prev, data.supporter_message, data.assistant_message].filter(Boolean)))
      setChatInput('')
    } catch (e) { setError(e.message) }
    finally { setChatSending(false) }
  }

  async function handleResetSupporterChat() {
    if (chatSending) return
    setChatSending(true)
    try {
      await resetSupporterChatMessages(userId)
      setChatMessages([])
      setChatInput('')
    } catch (e) { setError(e.message) }
    finally { setChatSending(false) }
  }

  const displayName = user?.full_name || `User ${userId}`
  const firstName = displayName.split(' ')[0]

  const helpfulShieldItems = useMemo(() => ([
    {
      title: 'Unused subscriptions',
      value: '3 services',
      detail: `Streaming and utility services have not had recent activity. Confirm with ${firstName} before renewing.`,
    },
    {
      title: 'Expected grant date',
      value: '02 Apr',
      detail: 'Reminder scheduled for 24 hours before expected grant arrival to avoid high-stress spending.',
    },
    {
      title: 'Upcoming debit orders',
      value: '2 in 5 days',
      detail: 'Flag essentials first, then pause non-essential auto-payments where possible.',
    },
  ]), [firstName])

  const scamDetectionItems = useMemo(() => ([
    {
      level: 'warning',
      title: 'New payee + urgent transfer pattern',
      detail: 'First-time beneficiary followed by same-day transfer language patterns. Recommend one call verification.',
    },
    {
      level: 'info',
      title: 'Duplicate OTP-related wording',
      detail: 'Recent chat logs include "verify code now" style language. Reinforce no-OTP-sharing reminder.',
    },
  ]), [])

  return (
    <div className="page supporter-dashboard-page">
      <div className="page-header supporter-header">
        <div>
          <Link to="/supporter/users" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }}>
            ← Back to users
          </Link>
          <h1>{displayName}</h1>
          {user && (
            <span className={`status-badge status-${user.risk_status}`} style={{ marginTop: 4, display: 'inline-block' }}>
              {riskLabel(user.risk_status)}
            </span>
          )}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/supporter/alerts')}>
          Open alerts
        </button>
      </div>

      <nav className="supporter-page-nav" aria-label="Supporter sections">
        <Link className="supporter-page-link" to="/supporter">Overview</Link>
        <Link className="supporter-page-link" to="/supporter/users">Manage users</Link>
        <Link className="supporter-page-link" to="/supporter/alerts">Alerts</Link>
      </nav>

      {error && <div className="alert alert-error">{error}</div>}

      {!details && !error && (
        <div className="card page-center" style={{ minHeight: 140 }}>
          <span className="spinner" />
        </div>
      )}

      {details && (
        <div className="card supporter-care-panel">
          <div className="supporter-concern-nav" role="tablist" aria-label="User care concerns">
            {['snapshot', 'playbook', 'controls', 'history', 'ai'].map((tab) => (
              <button
                key={tab}
                className={`supporter-concern-tab${activeConcern === tab ? ' active' : ''}`}
                role="tab"
                aria-selected={activeConcern === tab}
                onClick={() => setActiveConcern(tab)}
              >
                {{ snapshot: 'Signals & profile', playbook: 'Care playbook', controls: 'Controls', history: 'History', ai: 'AI finance copilot' }[tab]}
              </button>
            ))}
          </div>

          {/* ── Signals & profile ── */}
          {activeConcern === 'snapshot' && (
            <section className="supporter-concern-panel" role="tabpanel">
              {signals && (
                <div className="signal-cards" style={{ marginBottom: 12 }}>
                  <SignalCard signal={signals.velocity} />
                  <SignalCard signal={signals.inactivity} />
                  <SignalCard signal={signals.duplicates} />
                </div>
              )}
              <div className="supporter-management-suite">
                <div className="supporter-management-item"><p className="supporter-management-label">Last login</p><p>{formatDateTime(details.management?.last_login_at)}</p></div>
                <div className="supporter-management-item"><p className="supporter-management-label">Unread alerts</p><p>{details.management?.unread_alert_count ?? 0}</p></div>
                <div className="supporter-management-item"><p className="supporter-management-label">7d spend</p><p>{formatMoney(details.management?.spending_7d)}</p></div>
                <div className="supporter-management-item"><p className="supporter-management-label">30d spend</p><p>{formatMoney(details.management?.spending_30d)}</p></div>
                <div className="supporter-management-item"><p className="supporter-management-label">30d income</p><p>{formatMoney(details.management?.income_30d)}</p></div>
                <div className="supporter-management-item"><p className="supporter-management-label">Spend spikes</p><p>{details.management?.spike_transaction_count_30d ?? 0}</p></div>
              </div>

              <section className="supporter-helpful-dashboard">
                <div className="supporter-dashboard-section-head">
                  <h3>Helpful Reminders</h3>
                  <span className="status-badge status-info">Prototype</span>
                </div>
                <div className="supporter-helpful-grid">
                  {helpfulShieldItems.map((item) => (
                    <article key={item.title} className="supporter-helpful-card">
                      <p className="supporter-helpful-label">{item.title}</p>
                      <p className="supporter-helpful-value">{item.value}</p>
                      <p className="supporter-helpful-detail">{item.detail}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="supporter-scam-detection">
                <div className="supporter-dashboard-section-head">
                  <h3>Scam detection watch</h3>
                  <span className="status-badge status-warning">Mocked</span>
                </div>
                <div className="supporter-scam-list">
                  {scamDetectionItems.map((item) => (
                    <article key={item.title} className="supporter-scam-row">
                      <span className={`status-badge status-${item.level}`}>{item.level}</span>
                      <div>
                        <p className="supporter-scam-title">{item.title}</p>
                        <p className="supporter-scam-detail">{item.detail}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="supporter-transactions">
                <h3>Recent Transactions</h3>
                {details.transactions?.length ? (
                  <div className="supporter-tx-list">
                    {details.transactions.slice(0, 10).map((tx, idx) => (
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

          {/* ── Care playbook ── */}
          {activeConcern === 'playbook' && (
            <section className="supporter-concern-panel" role="tabpanel">
              <div className="supporter-care-playbook">
                <h3>Calm care playbook</h3>
                {careSignals.length > 0 ? (
                  <ul className="supporter-care-list">
                    {careSignals.map((s, i) => <li key={i}>{s}</li>)}
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
                <button
                  className={`btn btn-secondary btn-sm supporter-note-save-btn${noteSaved ? ' saved' : ''}`}
                  onClick={handleSaveNote}
                  disabled={saving || !noteText.trim()}
                >
                  {saving ? 'Saving...' : noteSaved ? 'Saved' : 'Save note'}
                </button>
                <span className="supporter-save-feedback" role="status" aria-live="polite">
                  {noteSaved ? 'Note saved successfully.' : ''}
                </span>
              </section>
            </section>
          )}

          {/* ── Controls ── */}
          {activeConcern === 'controls' && (
            <section className="supporter-concern-panel" role="tabpanel">
              <div className="supporter-care-columns">
                <div className="supporter-care-col">
                  <section className="supporter-care-section">
                    <h3>Banking Controls</h3>
                    <p className="muted">Upload a statement on behalf of {displayName.split(' ')[0]}, or manage their ABSA connection.</p>
                    <Link to={`/supporter/users/${userId}/banking`} className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}>
                      Open banking controls →
                    </Link>
                  </section>

                  <section className="supporter-care-section">
                    <h3>Chat Control</h3>
                    <div className="supporter-chat-control">
                      <p>Current state: <strong>{details.chat_pause?.is_paused ? 'Paused' : 'Active'}</strong></p>
                      {details.chat_pause?.paused_reason && <p>Reason: {details.chat_pause.paused_reason}</p>}
                      {details.chat_pause?.paused_at && <p>Paused at: {formatDateTime(details.chat_pause.paused_at)}</p>}
                      <textarea
                        className="supporter-note-input"
                        value={pauseReasonText}
                        onChange={(e) => setPauseReasonText(e.target.value)}
                        placeholder="Optional reason shown to user"
                        rows={2}
                      />
                      <div className="supporter-alert-actions">
                        {!details.chat_pause?.is_paused ? (
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
                    <h3>User's Finance Chat</h3>
                    <p className="muted">Read-only view of {displayName.split(' ')[0]}'s chat with LekkerFi AI.</p>
                    {financeChat?.messages?.length > 0 ? (
                      <div className="supporter-finance-chat-log">
                        {financeChat.messages.slice(-12).map((m) => (
                          <div key={m.id} className={`sfc-msg sfc-msg-${m.role}`}>
                            <span className="sfc-role">{m.role === 'user' ? displayName.split(' ')[0] : m.role === 'supporter' ? 'You' : 'AI'}</span>
                            <div className="sfc-text chat-markdown">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text || ''}</ReactMarkdown>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted" style={{ marginTop: 8 }}>No chat messages yet.</p>
                    )}
                    <div className="sfc-inject-row">
                      <textarea
                        className="supporter-note-input"
                        value={injectText}
                        onChange={(e) => setInjectText(e.target.value)}
                        placeholder="Send a message into their chat…"
                        rows={2}
                      />
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleInjectMessage}
                        disabled={injecting || !injectText.trim()}
                      >
                        {injecting ? 'Sending…' : 'Send to chat'}
                      </button>
                    </div>
                  </section>

                  <section className="supporter-care-section">
                    <h3>Spending Limits</h3>
                    <div className="supporter-limit-grid">
                      <label>Daily limit<input type="number" value={limits.daily_spend_limit} onChange={(e) => setLimits((p) => ({ ...p, daily_spend_limit: e.target.value }))} /></label>
                      <label>Weekly limit<input type="number" value={limits.weekly_spend_limit} onChange={(e) => setLimits((p) => ({ ...p, weekly_spend_limit: e.target.value }))} /></label>
                      <label>Monthly limit<input type="number" value={limits.monthly_spend_limit} onChange={(e) => setLimits((p) => ({ ...p, monthly_spend_limit: e.target.value }))} /></label>
                      <label>Min balance alert<input type="number" value={limits.min_balance_threshold} onChange={(e) => setLimits((p) => ({ ...p, min_balance_threshold: e.target.value }))} /></label>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={handleSaveLimits} disabled={saving}>Save limits</button>
                  </section>
                </div>
              </div>
            </section>
          )}

          {/* ── History ── */}
          {activeConcern === 'history' && (
            <section className="supporter-concern-panel" role="tabpanel">
              <section className="supporter-care-section">
                <h3>Uploaded document history</h3>
                <p className="muted" style={{ marginBottom: 10 }}>Recent uploads from this managed user.</p>
                {details.statement_history?.length ? (
                  <div className="supporter-history-list" role="list">
                    {details.statement_history.map((doc) => (
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

          {/* ── AI finance copilot ── */}
          {activeConcern === 'ai' && (
            <section className="supporter-concern-panel" role="tabpanel">
              <section className="supporter-care-section supp-chat-section">
                <div className="supp-chat-head">
                  <div>
                    <h3>Talk to AI about this user's finances</h3>
                    <p className="supp-chat-desc">Ask for trends, risk explanations, and supportive scripts.</p>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={handleResetSupporterChat} disabled={chatSending}>New chat (clear)</button>
                </div>

                <div className="supp-chat-messages" aria-live="polite">
                  {!chatLoading && chatMessages.length === 0 && (
                    <div className="supp-chat-empty">
                      <p className="muted">Start a new conversation to get user-specific financial coaching.</p>
                      <div className="supp-chat-suggestions supp-chat-suggestions-inline">
                        {SUPPORTER_CHAT_SUGGESTIONS.map((prompt) => (
                          <button key={prompt} type="button" className="supp-chat-suggestion" onClick={() => handleSendSupporterChat(prompt)} disabled={chatSending}>
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {chatMessages.map((msg) => (
                    <div key={msg.id || `${msg.role}-${msg.created_at}`} className={`supp-chat-msg supp-chat-msg-${msg.role === 'supporter' ? 'supporter' : 'assistant'}`}>
                      <span className="supp-chat-msg-label">{msg.role === 'supporter' ? 'You' : 'AI Copilot'}</span>
                      <div className="supp-chat-msg-text chat-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text || ''}</ReactMarkdown>
                      </div>
                    </div>
                  ))}
                  {(chatLoading || chatSending) && (
                    <div className="supp-chat-msg supp-chat-msg-assistant">
                      <span className="supp-chat-msg-label">AI Copilot</span>
                      <div className="supp-chat-thinking">
                        <span className="supp-chat-thinking-dot" /><span className="supp-chat-thinking-dot" /><span className="supp-chat-thinking-dot" />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <form className="supp-chat-input-row" onSubmit={(e) => { e.preventDefault(); handleSendSupporterChat() }}>
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

                <div className="supp-chat-bottom-controls">
                  <label className="supporter-upload-lang-label">
                    Reply language
                    <select value={chatLanguage} onChange={(e) => setChatLanguage(e.target.value)}>
                      {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </label>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChatInput('')} disabled={chatSending || !chatInput}>Clear input</button>
                </div>
              </section>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
