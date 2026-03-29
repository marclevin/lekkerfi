import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  addSupporterNote,
  deleteSupporterUserAbsaSession,
  fetchProfilePictureUrl,
  getSupporterChatMessages,
  getSupporterDashboardUsers,
  getSupporterUserDetails,
  getUserFinanceChat,
  injectSupporterMessage,
  listSupporterUserAbsaSessions,
  resetSupporterChatMessages,
  sendSupporterChatMessage,
  setSupporterUserChatPause,
  startSupporterUserAbsaSession,
  supporterUploadStatement,
  translateMessage,
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

const MESSAGE_TEMPLATES = [
  { label: 'Check-in', text: 'Checking in on you — how are things going?' },
  { label: 'Pre-purchase', text: "Before that purchase, let's chat — I want to help you think it through." },
  { label: 'Payday prep', text: "Your payday is coming up — let's plan how to make it stretch." },
  { label: 'Encouragement', text: "I noticed you've been careful with spending this week — keep it up!" },
]

function resolveConcernFromSearch(search, fallback = 'snapshot') {
  const concern = new URLSearchParams(search).get('concern')
  if (concern === 'chat-controls') return 'chat_controls'
  if (concern === 'finance-controls') return 'finance_controls'
  return fallback
}

export default function SupporterUserPage() {
  const { userId: userIdParam } = useParams()
  const userId = Number(userIdParam)
  const navigate = useNavigate()
  const location = useLocation()

  const [user, setUser] = useState(null)
  const [details, setDetails] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [activeConcern, setActiveConcern] = useState(() => resolveConcernFromSearch(location.search))
  const [profilePictureUrl, setProfilePictureUrl] = useState(null)

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
  const [translatedInjectText, setTranslatedInjectText] = useState('')
  const [injectPreviewSource, setInjectPreviewSource] = useState('')
  const [injectPreviewLang, setInjectPreviewLang] = useState('english')
  const [previewingInject, setPreviewingInject] = useState(false)
  const [injecting, setInjecting] = useState(false)

  const [uploadFile, setUploadFile] = useState(null)
  const [uploadLanguage, setUploadLanguage] = useState('english')
  const [uploadingStatement, setUploadingStatement] = useState(false)

  const [absaSessions, setAbsaSessions] = useState([])
  const [absaBusy, setAbsaBusy] = useState(false)

  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLanguage, setChatLanguage] = useState('english')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatSending, setChatSending] = useState(false)
  const chatEndRef = useRef(null)
  const uploadInputRef = useRef(null)

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

  const fetchFinanceChat = useCallback(async () => {
    const data = await getUserFinanceChat(userId)
    setFinanceChat(data)
  }, [userId])

  const fetchAbsaSessions = useCallback(async () => {
    const data = await listSupporterUserAbsaSessions(userId)
    setAbsaSessions(data.sessions || [])
  }, [userId])

  useEffect(() => {
    setActiveConcern((current) => resolveConcernFromSearch(location.search, current))
  }, [location.search])

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

  // Load user's profile picture
  useEffect(() => {
    if (!userId) return

    const loadPicture = async () => {
      const url = await fetchProfilePictureUrl(userId)
      setProfilePictureUrl(url)
    }

    loadPicture()

    return () => {
      if (profilePictureUrl) {
        URL.revokeObjectURL(profilePictureUrl)
      }
    }
  }, [userId])

  useEffect(() => {
    setError('')
    fetchDetails().catch((e) => setError(e.message))
    fetchChat().catch((e) => setError(e.message))
    fetchFinanceChat().catch(() => {})
    fetchAbsaSessions().catch(() => {})
  }, [fetchAbsaSessions, fetchChat, fetchDetails, fetchFinanceChat, userId])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatLoading])

  // Refresh every 10s
  useEffect(() => {
    const timer = setInterval(() => {
      fetchDetails().catch(() => {})
      fetchChat().catch(() => {})
      fetchFinanceChat().catch(() => {})
    }, 10000)
    return () => clearInterval(timer)
  }, [fetchChat, fetchDetails, fetchFinanceChat])

  const signals = useMemo(() => {
    if (!details) return null
    return computeUserSignals(details)
  }, [details])

  const targetInjectLanguage = user?.preferred_language || details?.user?.preferred_language || 'english'
  const targetInjectLanguageLabel = LANGUAGES.find((l) => l.value === targetInjectLanguage)?.label || targetInjectLanguage

  const injectPreviewReady =
    injectText.trim().length > 0
    && injectPreviewSource === injectText.trim()
    && injectPreviewLang === targetInjectLanguage
    && translatedInjectText.trim().length > 0

  useEffect(() => {
    if (injectPreviewSource && injectText.trim() !== injectPreviewSource) {
      setTranslatedInjectText('')
      setInjectPreviewSource('')
    }
  }, [injectText, injectPreviewSource])

  const careSignals = useMemo(() => {
    if (!details?.management) return []
    const coachingSignals = []
    const management = details.management
    const pauseState = details.chat_pause
    if (pauseState?.is_paused) coachingSignals.push('Chat currently paused. Confirm supporter decision and safe restart plan before unpausing.')
    if ((management.unread_alert_count || 0) > 0) coachingSignals.push(`There are ${management.unread_alert_count} unread alerts needing triage.`)
    if ((management.spike_transaction_count_30d || 0) > 0) coachingSignals.push('Recent spend spikes detected. Use calm check-in script before discussing limits.')
    if ((management.spending_7d || 0) > (management.avg_daily_spend_30d || 0) * 10 && (management.avg_daily_spend_30d || 0) > 0) {
      coachingSignals.push('Seven-day spending is elevated versus normal baseline. Prioritize short, concrete budgeting steps.')
    }
    if (!management.last_login_at) coachingSignals.push('No recent login activity recorded. Consider direct outreach to confirm account access and wellbeing.')
    return coachingSignals.slice(0, 4)
  }, [details])

  async function handlePreviewInjectTranslation() {
    const text = injectText.trim()
    if (!text) return
    setPreviewingInject(true)
    try {
      if (targetInjectLanguage === 'english') {
        setTranslatedInjectText(text)
      } else {
        const data = await translateMessage(text, targetInjectLanguage)
        setTranslatedInjectText((data.translated || text).trim())
      }
      setInjectPreviewSource(text)
      setInjectPreviewLang(targetInjectLanguage)
    } catch (e) {
      setError(e.message)
    } finally {
      setPreviewingInject(false)
    }
  }

  // Send immediately in the supporter's language (no translation)
  async function handleSendDirect() {
    const text = injectText.trim()
    if (!text) return
    setInjecting(true)
    try {
      await injectSupporterMessage(userId, text, { targetLanguage: 'english' })
      setInjectText('')
      setTranslatedInjectText('')
      setInjectPreviewSource('')
      await fetchFinanceChat()
    } catch (e) {
      setError(e.message)
    } finally {
      setInjecting(false)
    }
  }

  // Confirm-send after translation preview
  async function handleInjectMessage() {
    if (!injectText.trim() || !injectPreviewReady) return
    setInjecting(true)
    try {
      await injectSupporterMessage(userId, injectText.trim(), {
        translatedMessage: translatedInjectText,
        targetLanguage: targetInjectLanguage,
      })
      setInjectText('')
      setTranslatedInjectText('')
      setInjectPreviewSource('')
      await fetchFinanceChat()
    } catch (e) {
      setError(e.message)
    } finally {
      setInjecting(false)
    }
  }

  function clearTranslationPreview() {
    setTranslatedInjectText('')
    setInjectPreviewSource('')
  }

  async function handleToggleChatPause(action) {
    setSaving(true)
    try {
      await setSupporterUserChatPause(userId, action, pauseReasonText.trim())
      setPauseReasonText('')
      await fetchDetails()
      await fetchFinanceChat()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
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
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
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
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleUploadStatement() {
    if (!uploadFile) return
    setUploadingStatement(true)
    try {
      await supporterUploadStatement(userId, uploadFile, uploadLanguage)
      setUploadFile(null)
      await fetchDetails()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploadingStatement(false)
    }
  }

  async function handleStartAbsaSession() {
    setAbsaBusy(true)
    try {
      await startSupporterUserAbsaSession(userId)
      await fetchAbsaSessions()
    } catch (e) {
      setError(e.message)
    } finally {
      setAbsaBusy(false)
    }
  }

  async function handleDeleteAbsaSession(sessionId) {
    setAbsaBusy(true)
    try {
      await deleteSupporterUserAbsaSession(userId, sessionId)
      await fetchAbsaSessions()
    } catch (e) {
      setError(e.message)
    } finally {
      setAbsaBusy(false)
    }
  }

  async function handleSendSupporterChat(prefill) {
    const text = (prefill ?? chatInput).trim()
    if (!text) return
    setChatSending(true)
    try {
      const data = await sendSupporterChatMessage(userId, text, chatLanguage)
      setChatMessages((prev) => ([...prev, data.supporter_message, data.assistant_message].filter(Boolean)))
      setChatInput('')
    } catch (e) {
      setError(e.message)
    } finally {
      setChatSending(false)
    }
  }

  async function handleResetSupporterChat() {
    if (chatSending) return
    setChatSending(true)
    try {
      await resetSupporterChatMessages(userId)
      setChatMessages([])
      setChatInput('')
    } catch (e) {
      setError(e.message)
    } finally {
      setChatSending(false)
    }
  }

  const displayName = user?.full_name || details?.user?.full_name || `User ${userId}`
  const firstName = displayName.split(' ')[0]
  const uploadFileSummary = uploadFile ? `${uploadFile.name} (${Math.max(1, Math.round(uploadFile.size / 1024))} KB)` : ''

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
          {new URLSearchParams(location.search).get('focus') ? (
            <Link to="/supporter/alerts" className="btn btn-ghost btn-sm supporter-breadcrumb">
              ← Back to alerts
            </Link>
          ) : (
            <Link to="/supporter/users" className="btn btn-ghost btn-sm supporter-breadcrumb">
              ← Back to users
            </Link>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            {profilePictureUrl ? (
              <img
                src={profilePictureUrl}
                alt={displayName}
                style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', fontWeight: '600', color: 'var(--gray-600)' }}>
                {(displayName || '?')[0].toUpperCase()}
              </div>
            )}
            <h1 style={{ margin: 0 }}>{displayName}</h1>
          </div>
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

      {error && <div className="alert alert-error">{error}</div>}

      {!details && !error && (
        <div className="card page-center" style={{ minHeight: 140 }}>
          <span className="spinner" />
        </div>
      )}

      {details && (
        <>
          {/* Compact signal strip */}
          {signals && (
            <div className="signal-strip">
              {[signals.velocity, signals.inactivity, signals.duplicates].map((sig) => (
                <span key={sig.label} className={`signal-chip signal-chip-${sig.level}`}>
                  <span className="signal-chip-dot" aria-hidden="true" />
                  <span className="signal-chip-label">{sig.label}:</span>
                  <span className="signal-chip-value">{sig.value}</span>
                </span>
              ))}
            </div>
          )}

          {/* Recommended action banner */}
          {careSignals.length > 0 && (
            <div className="care-action-banner">
              <span className="care-action-icon" aria-hidden="true">⚡</span>
              <p className="care-action-text">{careSignals[0]}</p>
              {careSignals.length > 1 && (
                <button
                  className="btn btn-ghost btn-sm care-action-more"
                  onClick={() => setActiveConcern('snapshot')}
                >
                  +{careSignals.length - 1} more
                </button>
              )}
            </div>
          )}

        <div className="card supporter-care-panel">
          <div className="supporter-concern-nav" role="tablist" aria-label="User care concerns">
            {['snapshot', 'chat_controls', 'finance_controls', 'history', 'ai'].map((tab) => (
              <button
                key={tab}
                className={`supporter-concern-tab${activeConcern === tab ? ' active' : ''}`}
                role="tab"
                aria-selected={activeConcern === tab}
                onClick={() => setActiveConcern(tab)}
              >
                {{
                  snapshot: 'Overview',
                  chat_controls: 'Chat',
                  finance_controls: 'Limits & Data',
                  history: 'History',
                  ai: 'AI Copilot',
                }[tab]}
              </button>
            ))}
          </div>

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

              <section className="supporter-care-section supporter-notes-inline">
                <h3>Your notes</h3>
                <textarea
                  className="supporter-note-input"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add guidance notes for this user..."
                  rows={3}
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

          {activeConcern === 'chat_controls' && (
            <section className="supporter-concern-panel" role="tabpanel">

              {/* ── User's conversation with AI ─────────────────────────── */}
              <div className="chat-review-block">
                <div className="chat-review-header">
                  <span className="chat-review-title">{firstName}'s conversation with AI</span>
                  <span className={`status-badge ${details.chat_pause?.is_paused ? 'status-warning' : 'status-stable'}`}>
                    {details.chat_pause?.is_paused ? 'Paused' : 'Active'}
                  </span>
                </div>

                {financeChat?.messages?.length > 0 ? (
                  <div className="supp-chat-messages" aria-live="polite">
                    {financeChat.messages.slice(-16).map((m) => {
                      const roleClass =
                        m.role === 'supporter' ? 'supporter' :
                        m.role === 'user'      ? 'user' :
                        'assistant'
                      const roleLabel =
                        m.role === 'user'      ? firstName :
                        m.role === 'supporter' ? 'You (sent)' :
                        'AI'
                      return (
                        <div key={m.id} className={`supp-chat-msg supp-chat-msg-${roleClass}`}>
                          <span className="supp-chat-msg-label">{roleLabel}</span>
                          <div className="supp-chat-msg-text chat-markdown">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text || ''}</ReactMarkdown>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="muted chat-review-empty">No messages yet — this user hasn't started a conversation.</p>
                )}
              </div>

              {/* ── Message composer ────────────────────────────────────── */}
              <div className="sfc-composer">
                <p className="sfc-composer-label">Send a message to {firstName}</p>

                <div className="msg-template-row" role="group" aria-label="Message templates">
                  {MESSAGE_TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      className="msg-template-chip"
                      onClick={() => { setInjectText(t.text); clearTranslationPreview() }}
                      title={t.text}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <textarea
                  className="supp-chat-input"
                  value={injectText}
                  onChange={(e) => { setInjectText(e.target.value); clearTranslationPreview() }}
                  placeholder={`Write a message for ${firstName}…`}
                  rows={3}
                />

                {/* Send actions */}
                <div className="sfc-send-row">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleSendDirect}
                    disabled={injecting || !injectText.trim()}
                  >
                    {injecting && !injectPreviewReady ? 'Sending…' : 'Send'}
                  </button>

                  {targetInjectLanguage !== 'english' && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handlePreviewInjectTranslation}
                      disabled={previewingInject || !injectText.trim()}
                    >
                      {previewingInject
                        ? 'Translating…'
                        : `Translate to ${targetInjectLanguageLabel}`}
                    </button>
                  )}
                </div>

                {/* Translation preview */}
                {injectPreviewReady && (
                  <div className="sfc-translation-preview">
                    <p className="sfc-preview-original">
                      <strong>Original:</strong> {injectPreviewSource}
                    </p>
                    <p className="sfc-preview-translated">
                      <strong>In {targetInjectLanguageLabel}:</strong> {translatedInjectText}
                    </p>
                    <div className="sfc-preview-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleInjectMessage}
                        disabled={injecting}
                      >
                        {injecting ? 'Sending…' : 'Confirm & send translated'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={clearTranslationPreview}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Pause controls ──────────────────────────────────────── */}
              <div className="chat-pause-section">
                <div className="chat-pause-row">
                  <div className="chat-pause-info">
                    <span className="chat-pause-label">Chat access</span>
                    <span className={`status-badge ${details.chat_pause?.is_paused ? 'status-warning' : 'status-stable'}`}>
                      {details.chat_pause?.is_paused ? 'Paused' : 'Active'}
                    </span>
                    {details.chat_pause?.is_paused && details.chat_pause?.reason && (
                      <span className="chat-pause-reason">"{details.chat_pause.reason}"</span>
                    )}
                  </div>
                  <div className="chat-pause-actions">
                    <input
                      className="sfc-reason-input"
                      value={pauseReasonText}
                      onChange={(e) => setPauseReasonText(e.target.value)}
                      placeholder="Reason (optional)"
                      aria-label="Optional pause reason"
                    />
                    <button
                      className={`btn btn-sm ${details.chat_pause?.is_paused ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleToggleChatPause(details.chat_pause?.is_paused ? 'unpause' : 'pause')}
                      disabled={saving}
                    >
                      {saving ? '…' : details.chat_pause?.is_paused ? 'Resume chat' : 'Pause chat'}
                    </button>
                  </div>
                </div>
              </div>

            </section>
          )}

          {activeConcern === 'finance_controls' && (
            <section className="supporter-concern-panel" role="tabpanel">
              <div className="supporter-care-columns">
                <div className="supporter-care-col">
                  <section className="supporter-care-section">
                    <h3>Upload statement</h3>
                    <p className="muted">Upload a statement for {firstName} without leaving this page.</p>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      style={{ display: 'none' }}
                    />

                    <button
                      type="button"
                      className={`supporter-upload-zone${uploadFile ? ' has-file' : ''}`}
                      onClick={() => uploadInputRef.current?.click()}
                    >
                      <span className="supporter-upload-icon" aria-hidden="true">📄</span>
                      <span className="supporter-upload-filename">
                        {uploadFile ? uploadFile.name : 'Choose statement file'}
                      </span>
                      <span className="supporter-upload-hint">PDF, JPG, PNG, WEBP</span>
                    </button>

                    {uploadFileSummary && <p className="supporter-upload-meta">{uploadFileSummary}</p>}

                    <div className="supporter-upload-controls">
                      <label className="supporter-upload-lang-label">
                        Statement language
                        <select value={uploadLanguage} onChange={(e) => setUploadLanguage(e.target.value)}>
                          {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                        </select>
                      </label>

                      <button className="btn btn-secondary btn-sm" onClick={handleUploadStatement} disabled={!uploadFile || uploadingStatement}>
                        {uploadingStatement ? 'Uploading...' : 'Upload statement'}
                      </button>

                      {uploadFile && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setUploadFile(null)} disabled={uploadingStatement}>
                          Clear
                        </button>
                      )}
                    </div>
                  </section>

                  <section className="supporter-care-section">
                    <h3>ABSA connect session</h3>
                    <p className="muted">Start ABSA connection for this user and manage saved sessions.</p>
                    <div className="supporter-alert-actions">
                      <button className="btn btn-secondary btn-sm" onClick={handleStartAbsaSession} disabled={absaBusy}>
                        {absaBusy ? 'Starting...' : 'Connect ABSA for user'}
                      </button>
                    </div>

                    {absaSessions.length > 0 ? (
                      <div className="supporter-absa-session-list" role="list">
                        {absaSessions.map((session) => (
                          <div className="supporter-absa-session-row" role="listitem" key={session.id}>
                            <div>
                              <p><strong>Session #{session.id}</strong> · {session.status}</p>
                              <p className="muted">Created: {formatDateTime(session.created_at)}</p>
                            </div>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleDeleteAbsaSession(session.id)}
                              disabled={absaBusy}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted" style={{ marginTop: 8 }}>No ABSA sessions for this user yet.</p>
                    )}
                  </section>
                </div>

                <div className="supporter-care-col">
                  <section className="supporter-care-section">
                    <h3>Spending limits</h3>
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
        </>
      )}
    </div>
  )
}
