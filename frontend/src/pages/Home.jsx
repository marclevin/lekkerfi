import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getNotifications, getWeeklyWin, listInsights, listMySuporters,
  listMyUsers, markNotificationRead, sendNotification, visualizeInsight,
} from '../api/client'
import { useAuth } from '../context/AuthContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(value) {
  if (value == null) return '—'
  return `R ${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function todayLabel() {
  return new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })
}

// ── Nudge card (caretaker message at top) ────────────────────────────────────

function NudgeBanner({ userId }) {
  const [nudge, setNudge] = useState(null)

  useEffect(() => {
    if (!userId) return
    getNotifications()
      .then((d) => {
        const unread = (d.notifications || []).filter(
          (n) => n.to_user_id === userId && !n.read && !n.is_mine
        )
        if (unread.length > 0) {
          setNudge(unread[0])
          markNotificationRead(unread[0].id).catch(() => {})
        }
      })
      .catch(() => {})
  }, [userId])

  if (!nudge) return null

  return (
    <div className="nudge-card" role="alert" aria-live="polite">
      <div className="nudge-card-from">
        <span className="nudge-card-avatar" aria-hidden="true">
          {(nudge.from_name || '?')[0].toUpperCase()}
        </span>
        <span className="nudge-card-name">{nudge.from_name} sent you a message</span>
        <button
          type="button"
          className="nudge-card-dismiss"
          onClick={() => setNudge(null)}
          aria-label="Dismiss message"
        >
          ×
        </button>
      </div>
      <p className="nudge-card-text">"{nudge.message}"</p>
    </div>
  )
}

// ── Weekly win (compact strip) ────────────────────────────────────────────────

function WeeklyWinSection({ weeklyWin }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!weeklyWin?.share_text) return
    await navigator.clipboard.writeText(weeklyWin.share_text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  if (!weeklyWin?.wins?.length) return null

  return (
    <div className="weekly-win-strip" role="status" aria-label="Weekly win">
      <span className="weekly-win-strip-icon" aria-hidden="true">🏆</span>
      <p className="weekly-win-strip-text">{weeklyWin.wins[0]}</p>
      <button className="weekly-win-strip-btn" onClick={handleCopy} aria-label="Share weekly win">
        {copied ? '✓' : 'Share'}
      </button>
    </div>
  )
}

// ── What to do now (compact) ─────────────────────────────────────────────────

function ActionBanner({ hasInsights, isSupporter, onConnect, onInsights, onChat }) {
  if (isSupporter) return null
  return (
    <section className="action-banner card" aria-label="Your next step">
      <p className="action-banner-label">
        <span className="action-banner-label-icon" aria-hidden="true">🧭</span>
        What to do now
      </p>
      {hasInsights ? (
        <>
          <p className="action-banner-text">Your money summary is ready to read.</p>
          <div className="action-banner-btns">
            <button className="btn btn-primary" onClick={onInsights}>
              <span aria-hidden="true">📊</span>
              Read my summary
            </button>
            <button className="btn btn-ghost" onClick={onChat}>
              <span aria-hidden="true">💬</span>
              Ask a question
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="action-banner-text">Add your bank data to see how your money is doing.</p>
          <button className="btn btn-primary" onClick={onConnect}>
            <span aria-hidden="true">🏦</span>
            Add my bank data
          </button>
        </>
      )}
    </section>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ amount, name, desc, type, icon }) {
  return (
    <div className={`stat-card${type ? ` stat-card-${type}` : ''}`}>
      <span className="stat-card-icon" aria-hidden="true">{icon}</span>
      <span className="stat-card-amount">{amount}</span>
      <span className="stat-card-name">{name}</span>
      <span className="stat-card-desc">{desc}</span>
    </div>
  )
}

// ── Financial snapshot (stats only, no charts) ────────────────────────────────

function FinancialSnapshot({ latestInsight, summary, vizLoading, onViewAll }) {
  if (vizLoading) {
    return (
      <section className="card" style={{ padding: '24px', textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </section>
    )
  }
  if (!summary) return null

  return (
    <section className="snapshot-section card">
      <div className="snapshot-header">
        <div>
          <h2 className="snapshot-title">Your money at a glance</h2>
          {latestInsight && <p className="snapshot-sub">{fmtDate(latestInsight.created_at)}</p>}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onViewAll}>Full view →</button>
      </div>
      <div className="stat-cards-grid">
        <StatCard
          amount={fmt(summary.total_income)}
          name="Money in"
          desc="Came into your account"
          type="positive"
          icon="⬇️"
        />
        <StatCard
          amount={fmt(summary.total_expenses)}
          name="Money out"
          desc="What you spent"
          type="negative"
          icon="⬆️"
        />
        <StatCard
          amount={fmt(summary.net_flow)}
          name="Left over"
          desc={summary.net_flow >= 0 ? 'More came in than went out' : 'More went out than came in'}
          type={summary.net_flow >= 0 ? 'positive' : 'negative'}
          icon={summary.net_flow >= 0 ? '✅' : '⚠️'}
        />
        <StatCard
          amount={fmt(summary.account_balance)}
          name="Balance now"
          desc="Your account right now"
          type=""
          icon="💳"
        />
      </div>
    </section>
  )
}

// ── Contact helpers ───────────────────────────────────────────────────────────

function detectContactType(contact) {
  if (!contact) return null
  if (/@/.test(contact)) return 'email'
  if (/[0-9+]/.test(contact.replace(/[\s()-]/g, ''))) return 'phone'
  return null
}

function whatsappUrl(phone) {
  return `https://wa.me/${phone.replace(/[^\d+]/g, '')}`
}

// ── Supporter hub card ────────────────────────────────────────────────────────

function SupporterCard({ supporter, notifs, onNewNotif }) {
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef(null)
  const feedEndRef = useRef(null)
  const contactType = detectContactType(supporter.contact)
  const limit = supporter.spending_limit

  // Sort oldest-first for chat display; show last 10
  const messages = [...notifs]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(-10)

  const newFromSupporter = notifs.filter((n) => !n.is_mine && !n.read).length

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [notifs.length])

  async function handleSend(e) {
    e.preventDefault()
    if (!msg.trim() || !supporter.linked_supporter_id) return
    setSending(true)
    try {
      const data = await sendNotification(supporter.linked_supporter_id, msg.trim())
      onNewNotif(data.notification)
      setMsg('')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="sc-hub">
      {/* ── Identity row ── */}
      <div className="sc-hub-header">
        <div className="sc-hub-avatar">{(supporter.display_name || '?')[0].toUpperCase()}</div>
        <div className="sc-hub-identity">
          <span className="sc-hub-name">
            {supporter.display_name}
            {supporter.is_registered && <span className="sc-reg-badge">Active</span>}
          </span>
          <span className="sc-hub-role">Your trusted supporter</span>
          {supporter.contact && <span className="sc-hub-contact">{supporter.contact}</span>}
        </div>
        <div className="sc-hub-contacts">
          {contactType === 'phone' && (
            <>
              <a className="sc-action-btn" href={whatsappUrl(supporter.contact)} target="_blank" rel="noreferrer" title="WhatsApp">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              </a>
              <a className="sc-action-btn" href={`tel:${supporter.contact}`} title="Call">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.05 1.19 2 2 0 012.03 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/></svg>
              </a>
            </>
          )}
          {contactType === 'email' && (
            <a className="sc-action-btn" href={`mailto:${supporter.contact}`} title="Email">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </a>
          )}
        </div>
      </div>

      {/* ── Budget limits ── */}
      {limit && (
        <div className="sc-budget">
          <p className="sc-budget-label">
            <span aria-hidden="true">💰</span> Budget set by {supporter.display_name}
          </p>
          <div className="sc-budget-grid">
            {limit.monthly_spend_limit != null && (
              <div className="sc-budget-item">
                <span className="sc-budget-val">{fmt(limit.monthly_spend_limit)}</span>
                <span className="sc-budget-key">per month</span>
              </div>
            )}
            {limit.weekly_spend_limit != null && (
              <div className="sc-budget-item">
                <span className="sc-budget-val">{fmt(limit.weekly_spend_limit)}</span>
                <span className="sc-budget-key">per week</span>
              </div>
            )}
            {limit.daily_spend_limit != null && (
              <div className="sc-budget-item">
                <span className="sc-budget-val">{fmt(limit.daily_spend_limit)}</span>
                <span className="sc-budget-key">per day</span>
              </div>
            )}
            {limit.min_balance_threshold != null && (
              <div className="sc-budget-item">
                <span className="sc-budget-val">{fmt(limit.min_balance_threshold)}</span>
                <span className="sc-budget-key">keep in account</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Message feed (always open) ── */}
      <div className="sc-feed-section">
        <div className="sc-feed-header">
          <span className="sc-feed-label">Messages</span>
          {newFromSupporter > 0 && (
            <span className="sc-feed-new-badge" aria-label={`${newFromSupporter} new messages`}>
              {newFromSupporter} new
            </span>
          )}
        </div>

        <div className="sc-feed" role="log" aria-live="polite" aria-label="Message history">
          {messages.length === 0 ? (
            <p className="sc-feed-empty">
              No messages yet. Send {supporter.display_name} a message below.
            </p>
          ) : (
            messages.map((n) => (
              <div
                key={n.id}
                className={`sc-bubble${n.is_mine ? ' sc-bubble-mine' : ' sc-bubble-theirs'}${!n.is_mine && !n.read ? ' sc-bubble-unread' : ''}`}
              >
                {!n.is_mine && (
                  <span className="sc-bubble-from">{n.from_name}</span>
                )}
                <p className="sc-bubble-text">{n.message}</p>
                {!n.is_mine && !n.read && (
                  <span className="sc-bubble-new-dot" aria-label="New message">NEW</span>
                )}
              </div>
            ))
          )}
          <div ref={feedEndRef} />
        </div>

        {supporter.is_registered ? (
          <form className="sc-reply-form" onSubmit={handleSend}>
            <input
              ref={inputRef}
              className="sc-reply-input"
              placeholder={`Reply to ${supporter.display_name}…`}
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              disabled={sending}
              aria-label="Type a reply"
            />
            <button className="sc-reply-send" type="submit" disabled={!msg.trim() || sending} aria-label="Send">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </form>
        ) : (
          <p className="sc-not-registered">
            {supporter.display_name} hasn't joined LekkerFi yet — you can contact them directly using the buttons above.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Support Hub section ───────────────────────────────────────────────────────

function SupportCircle({ userId }) {
  const navigate = useNavigate()
  const [supporters, setSupporters] = useState(null)
  const [notifications, setNotifications] = useState([])

  useEffect(() => {
    listMySuporters()
      .then((d) => setSupporters(d.supporters || []))
      .catch(() => setSupporters([]))
    getNotifications()
      .then((d) => {
        setNotifications(d.notifications || [])
        const unread = (d.notifications || []).filter((n) => n.to_user_id === userId && !n.read)
        unread.forEach((n) => markNotificationRead(n.id).catch(() => {}))
      })
      .catch(() => {})
  }, [userId])

  function notifsFor(linkedSupporterId) {
    if (!linkedSupporterId) return []
    return notifications.filter(
      (n) => n.from_user_id === linkedSupporterId || n.to_user_id === linkedSupporterId
    )
  }

  function handleNewNotif(notif) {
    setNotifications((prev) => [notif, ...prev])
  }

  if (supporters === null) {
    return (
      <section className="card sc-section">
        <p className="section-label">Your Support Hub</p>
        <div className="spinner" style={{ margin: '12px auto' }} />
      </section>
    )
  }

  if (supporters.length === 0) {
    return (
      <section className="card sc-section">
        <p className="section-label">Your Support Hub</p>
        <div className="sc-empty">
          <p className="sc-empty-title">No supporter yet</p>
          <p className="sc-empty-desc">
            A trusted supporter helps you make thoughtful spending decisions. They don't see your account — they're just there when you need them.
          </p>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/profile')}>
            Add a supporter
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="card sc-section">
      <div className="sc-header">
        <p className="section-label">Your Support Hub</p>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/profile')}>+ Add</button>
      </div>
      {supporters.map((s) => (
        <SupporterCard
          key={s.id}
          supporter={s}
          notifs={notifsFor(s.linked_supporter_id)}
          onNewNotif={handleNewNotif}
        />
      ))}
    </section>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [insights, setInsights] = useState(null)
  const [viz, setViz] = useState(null)
  const [vizLoading, setVizLoading] = useState(false)
  const [weeklyWin, setWeeklyWin] = useState(null)
  const [managedUsers, setManagedUsers] = useState(null)
  const isSupporter = user?.role === 'supporter'

  useEffect(() => {
    listInsights()
      .then((d) => setInsights(d.insights))
      .catch(() => setInsights([]))
  }, [])

  const latestInsight = insights?.[0] ?? null

  useEffect(() => {
    if (!latestInsight) return
    setViz(null)
    setVizLoading(true)
    visualizeInsight(latestInsight.id)
      .then(setViz)
      .catch(() => {})
      .finally(() => setVizLoading(false))
  }, [latestInsight?.id])

  useEffect(() => {
    getWeeklyWin()
      .then(setWeeklyWin)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!isSupporter) return
    listMyUsers()
      .then((d) => setManagedUsers(d.users || []))
      .catch(() => setManagedUsers([]))
  }, [isSupporter])

  const firstName = user?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || ''
  const hasInsights = !!latestInsight

  return (
    <div className="page dashboard-page">

      {/* ── Greeting ── */}
      <header className="home-greeting">
        <p className="home-greeting-time">{greeting()}</p>
        <h1 className="home-greeting-name">{firstName || 'there'}</h1>
        {isSupporter && <span className="home-role-tag">Trusted Supporter</span>}
        <p className="home-greeting-date">{todayLabel()}</p>
      </header>

      {/* ── Caretaker messages ── */}
      {!isSupporter && <NudgeBanner userId={user?.id} />}

      {/* ── Weekly wins (near top, prominent) ── */}
      {!isSupporter && <WeeklyWinSection weeklyWin={weeklyWin} />}

      {/* ── What to do now (compact) ── */}
      <ActionBanner
        hasInsights={hasInsights}
        isSupporter={isSupporter}
        onConnect={() => navigate('/connect')}
        onInsights={() => navigate('/insights')}
        onChat={() => navigate('/chat')}
      />

      {/* ── Supporter: managed users ── */}
      {isSupporter && (
        <section className="card" style={{ marginBottom: '1rem' }}>
          <p className="section-label">
            <span aria-hidden="true">👥</span>
            Managed Users
          </p>
          {managedUsers === null ? (
            <div className="spinner" style={{ margin: '12px auto' }} />
          ) : managedUsers.length === 0 ? (
            <div>
              <p style={{ color: 'var(--gray-600)', margin: '0.5rem 0 0.75rem' }}>
                You haven't added anyone yet. Create accounts for the people you support.
              </p>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/profile')}>
                Add someone
              </button>
            </div>
          ) : (
            <div className="managed-users-list" style={{ marginTop: '0.5rem' }}>
              {managedUsers.map((u) => (
                <div key={u.id} className="managed-user-item">
                  <div className="managed-user-avatar">
                    {(u.full_name || u.email)[0].toUpperCase()}
                  </div>
                  <div className="managed-user-info">
                    <span className="managed-user-name">{u.full_name || u.email.split('@')[0]}</span>
                    <span className="managed-user-email">{u.email}</span>
                  </div>
                  <span className="managed-user-lang">
                    <span aria-hidden="true">🌐</span>
                    {u.preferred_language}
                  </span>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => navigate('/profile')}>
                + Add user
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Loading ── */}
      {insights === null && (
        <div className="page-center" style={{ minHeight: 80 }}>
          <div className="spinner" />
        </div>
      )}

      {/* ── No insights yet ── */}
      {insights?.length === 0 && !isSupporter && (
        <div className="home-onboarding">
          <p className="section-label">How it works</p>
          <div className="hiw-grid">
            <div className="hiw-step">
              <div className="hiw-number">1</div>
              <span className="hiw-icon" aria-hidden="true">🏦</span>
              <h3>Add bank data</h3>
              <p>Upload a statement or link your ABSA account.</p>
            </div>
            <div className="hiw-step">
              <div className="hiw-number">2</div>
              <span className="hiw-icon" aria-hidden="true">🤖</span>
              <h3>AI reads it</h3>
              <p>We find patterns and trends in your spending.</p>
            </div>
            <div className="hiw-step">
              <div className="hiw-number">3</div>
              <span className="hiw-icon" aria-hidden="true">📝</span>
              <h3>Simple summary</h3>
              <p>Plain language in your own South African language.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Financial snapshot (stats only) ── */}
      {hasInsights && (
        <FinancialSnapshot
          latestInsight={latestInsight}
          summary={viz?.summary}
          vizLoading={vizLoading}
          onViewAll={() => navigate('/insights')}
        />
      )}

      {/* ── Support circle ── */}
      {!isSupporter && <SupportCircle userId={user?.id} />}
    </div>
  )
}
