import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getNotifications, getWeeklyWin, listInsights, listMySuporters,
  listMyUsers, listStatements, markNotificationRead,
  sendNotification, translateMessage, visualizeInsight,
} from '../api/client'
import { useAuth } from '../context/AuthContext'
import { activateCalmAutoMode, readStoredBoolean, subscribeCalmModeChanges, CALM_MODE_KEY } from '../utils/calmMode'

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

function buildHomeEssentialsMock() {
  return [
    {
      key: 'rent_housing',
      icon: '🏠',
      title: 'Rent and housing',
      order: 1,
      monthlyTarget: 3200,
      weeklyTarget: 800,
      note: 'Keep your housing costs first before non-essential spending.',
    },
    {
      key: 'food_groceries',
      icon: '🍳',
      title: 'Food and groceries',
      order: 2,
      monthlyTarget: 1800,
      weeklyTarget: 450,
      note: 'Plan basic food needs first, then review non-essential purchases.',
    },
    {
      key: 'transport_fuel',
      icon: '🚌',
      title: 'Transport and fuel',
      order: 3,
      monthlyTarget: 1250,
      weeklyTarget: 320,
      note: 'Protect transport costs for work, school, and essential travel.',
    },
  ]
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
  if (!weeklyWin?.wins?.length) return null

  return (
    <div className="weekly-win-strip" role="status" aria-label="Weekly win">
      <span className="weekly-win-strip-icon" aria-hidden="true">🏆</span>
      <p className="weekly-win-strip-text">{weeklyWin.wins[0]}</p>
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

function StatCard({ amount, name, desc, tip, type, icon }) {
  const [showTip, setShowTip] = useState(false)
  return (
    <div className={`stat-card${type ? ` stat-card-${type}` : ''}`}>
      <span className="stat-card-icon" aria-hidden="true">{icon}</span>
      <span className="stat-card-amount">{amount}</span>
      <span className="stat-card-name">{name}</span>
      <span className="stat-card-desc">{desc}</span>
      {tip && (
        <button
          type="button"
          className="stat-card-tip-btn"
          aria-expanded={showTip}
          onClick={() => setShowTip((v) => !v)}
          aria-label={showTip ? 'Hide explanation' : 'What does this mean?'}
        >
          {showTip ? 'Hide ▲' : 'What does this mean? ▼'}
        </button>
      )}
      {tip && showTip && (
        <p className="stat-card-tip" role="note">{tip}</p>
      )}
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

  const netFlow = Number(summary.net_flow ?? 0)
  const isPositive = netFlow >= 0

  return (
    <section className="snapshot-section card">
      <div className="snapshot-header">
        <div>
          <h2 className="snapshot-title">Your money at a glance</h2>
          {latestInsight && <p className="snapshot-sub">Based on data from {fmtDate(latestInsight.created_at)}</p>}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onViewAll}>Full view →</button>
      </div>

      {/* Plain-language summary sentence */}
      <div className="snapshot-summary-banner" role="status" aria-live="polite">
        <span className="snapshot-summary-icon" aria-hidden="true">{isPositive ? '✅' : '⚠️'}</span>
        <p className="snapshot-summary-text">
          {isPositive
            ? `You had ${fmt(netFlow)} more coming in than going out. That is a good result.`
            : `You spent ${fmt(Math.abs(netFlow))} more than came in. This is worth looking at.`}
        </p>
      </div>

      <div className="stat-cards-grid">
        <StatCard
          amount={fmt(summary.total_income)}
          name="Money that came in"
          desc="Salary, grants, or other payments received"
          tip="This is all the money that arrived in your account — like your pay, a grant, or money someone sent you."
          type="positive"
          icon="⬇️"
        />
        <StatCard
          amount={fmt(summary.total_expenses)}
          name="Money that went out"
          desc="Shops, bills, and payments you made"
          tip="This is everything you paid for — food, transport, bills, and anything else bought or paid."
          type="negative"
          icon="⬆️"
        />
        <StatCard
          amount={fmt(netFlow)}
          name={isPositive ? 'You kept this much' : 'You went over by'}
          desc={isPositive ? 'More came in than went out — well done' : 'More went out than came in this period'}
          tip={isPositive
            ? 'The difference between what came in and what went out. Positive means you are managing well.'
            : 'You spent more than you received this period. Looking at your full summary can help you find where to adjust.'}
          type={isPositive ? 'positive' : 'negative'}
          icon={isPositive ? '✅' : '⚠️'}
        />
        <StatCard
          amount={fmt(summary.account_balance)}
          name="Your balance right now"
          desc="How much is in your account today"
          tip="This is the current amount sitting in your account at the time we last checked."
          type=""
          icon="💳"
        />
      </div>

      <button className="btn btn-secondary btn-sm snapshot-explain-btn" onClick={onViewAll}>
        📊 See the full breakdown
      </button>
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

function SupporterCard({ supporter, notifs, onNewNotif, preferredLanguage }) {
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [translations, setTranslations] = useState({}) // notif.id → translated text
  const inputRef = useRef(null)
  const feedEndRef = useRef(null)
  const contactType = detectContactType(supporter.contact)
  const limit = supporter.spending_limit

  // Sort oldest-first for chat display; show last 10
  const messages = [...notifs]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(-10)

  // Auto-translate incoming supporter messages if user language ≠ english
  useEffect(() => {
    if (!preferredLanguage || preferredLanguage === 'english') return
    const toTranslate = messages.filter(
      (n) => !n.is_mine && !translations[n.id]
    )
    toTranslate.forEach((n) => {
      translateMessage(n.message, preferredLanguage)
        .then((d) => {
          if (d.translated && d.translated !== n.message) {
            setTranslations((prev) => ({ ...prev, [n.id]: d.translated }))
          }
        })
        .catch(() => {})
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifs.length, preferredLanguage])

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
            messages.map((n) => {
              const displayText = (!n.is_mine && translations[n.id]) ? translations[n.id] : n.message
              const wasTranslated = !n.is_mine && !!translations[n.id]
              return (
                <div
                  key={n.id}
                  className={`sc-bubble${n.is_mine ? ' sc-bubble-mine' : ' sc-bubble-theirs'}${!n.is_mine && !n.read ? ' sc-bubble-unread' : ''}`}
                >
                  {!n.is_mine && (
                    <span className="sc-bubble-from">{n.from_name}</span>
                  )}
                  <p className="sc-bubble-text">{displayText}</p>
                  {wasTranslated && (
                    <span className="sc-bubble-translated" aria-label="Translated message">Translated</span>
                  )}
                  {!n.is_mine && !n.read && (
                    <span className="sc-bubble-new-dot" aria-label="New message">NEW</span>
                  )}
                </div>
              )
            })
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

function SupportCircle({ userId, preferredLanguage }) {
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
      </div>
      {supporters.map((s) => (
        <SupporterCard
          key={s.id}
          supporter={s}
          notifs={notifsFor(s.linked_supporter_id)}
          onNewNotif={handleNewNotif}
          preferredLanguage={preferredLanguage}
        />
      ))}
    </section>
  )
}

function CalmEssentialsPanel({ onChat }) {
  const items = buildHomeEssentialsMock()
  const totalMonthly = items.reduce((sum, item) => sum + Number(item.monthlyTarget || 0), 0)
  const totalWeekly = items.reduce((sum, item) => sum + Number(item.weeklyTarget || 0), 0)

  return (
    <section className="card calm-essentials-panel" aria-label="Essentials card">
      <div className="tax-shield-head">
        <div>
          <p className="section-label">Essentials</p>
          <h2 className="tax-shield-title">Essentials card</h2>
        </div>
        <span className="status-badge status-info">Demo content</span>
      </div>
      <p className="calm-essentials-copy">Focus on these essentials first.</p>
      <div className="calm-essentials-metrics" role="status" aria-label="Demo essentials metrics">
        <span>{items.length} categories</span>
        <span>{fmt(totalWeekly)} weekly target</span>
        <span>{fmt(totalMonthly)} monthly target</span>
      </div>
      <div className="calm-essentials-list" role="list" aria-label="Essential categories">
        {items.map((item) => (
          <div key={item.key} className="calm-essentials-item" role="listitem">
            <div className="calm-essentials-item-top">
              <span className="calm-essentials-item-title">{item.icon} {item.order}. {item.title}</span>
              <span className="calm-essentials-item-amount">{fmt(item.monthlyTarget)}/mo</span>
            </div>
            <span className="calm-essentials-item-note">{item.note}</span>
            <span className="calm-essentials-item-sub">Weekly target: {fmt(item.weeklyTarget)}</span>
          </div>
        ))}
      </div>
      <div className="action-banner-btns">
        <button className="btn btn-primary" onClick={onChat}>
          💬 Ask about essentials
        </button>
      </div>
    </section>
  )
}

function TaxShieldSection() {
  const mockCards = [
    {
      title: 'Unused subscriptions',
      value: 'R 389.00 / month',
      note: 'You have services that look inactive. Review before the next billing cycle.',
    },
    {
      title: 'Expected grant date',
      value: '02 Apr 2026',
      note: 'Set a reminder 1 day before so key expenses are planned in advance.',
    },
    {
      title: 'Forgotten renewals',
      value: '2 upcoming',
      note: 'Insurance and utility renewals are due soon. Keep these ahead of impulse spending.',
    },
  ]

  return (
    <section className="card tax-shield-section" aria-label="Reminder dashboard">
      <div className="tax-shield-head">
        <div>
          <p className="section-label">Reminder Dashboard</p>
          <h2 className="tax-shield-title">Helpful reminders dashboard</h2>
        </div>
      </div>
      <div className="tax-shield-grid">
        {mockCards.map((card) => (
          <article key={card.title} className="tax-shield-card">
            <p className="tax-shield-label">{card.title}</p>
            <p className="tax-shield-value">{card.value}</p>
            <p className="tax-shield-note">{card.note}</p>
          </article>
        ))}
      </div>
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
  const [hasPendingStatement, setHasPendingStatement] = useState(false)
  const [activeHomeTab, setActiveHomeTab] = useState('glance')
  const [isCalmMode, setIsCalmMode] = useState(() => {
    const fromBody = document.body.classList.contains('calm-mode')
    const fromStorage = readStoredBoolean(CALM_MODE_KEY, false)
    return fromBody || fromStorage
  })
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

  useEffect(() => {
    if (isSupporter) return
    listStatements()
      .then((d) => setHasPendingStatement((d.statements || []).some((s) => s.status === 'processing')))
      .catch(() => {})
  }, [isSupporter])

  useEffect(() => {
    return subscribeCalmModeChanges((snapshot) => {
      const active = snapshot.override ? snapshot.manual : (snapshot.manual || snapshot.auto)
      setIsCalmMode(Boolean(active))
    })
  }, [])

  useEffect(() => {
    if (isSupporter || !viz?.summary) return
    const summary = viz.summary
    const spend24h = Number(summary.spend_24h ?? summary.spending_24h ?? 0)
    const avgDaily7d = Number(summary.avg_daily_spend_7d ?? summary.daily_avg_7d ?? 0)
    const totalIncome = Number(summary.total_income ?? 0)
    const totalExpenses = Number(summary.total_expenses ?? 0)
    const netFlow = Number(summary.net_flow ?? 0)

    const cadenceAnomaly = spend24h > 0 && avgDaily7d > 0 && spend24h >= avgDaily7d * 1.5
    const ratioAnomaly = totalIncome > 0 && totalExpenses >= totalIncome * 1.1
    const deepNegative = netFlow <= -300

    if (cadenceAnomaly || ratioAnomaly || deepNegative) {
      activateCalmAutoMode({
        reason: 'spending_pattern_anomaly',
        source: 'spending_anomaly',
      })
    }
  }, [isSupporter, viz?.summary])

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
      {!isSupporter && !isCalmMode && <NudgeBanner userId={user?.id} />}

      {/* ── Processing statement banner ── */}
      {!isSupporter && hasPendingStatement && (
        <div className="callout callout-info" style={{ margin: '0 0 12px' }}>
          <span className="callout-icon">⏳</span>
          <div className="callout-body">
            <strong>Your statement is being analysed in the background.</strong>
            <p>Head to <button className="link-btn" onClick={() => navigate('/insights')}>Insights</button> in a moment to see your results.</p>
          </div>
        </div>
      )}

      {/* ── Weekly wins (near top, prominent) ── */}
      {!isSupporter && !isCalmMode && <WeeklyWinSection weeklyWin={weeklyWin} />}

      {/* ── What to do now (compact) ── */}
      {!isCalmMode && (
        <ActionBanner
          hasInsights={hasInsights}
          isSupporter={isSupporter}
          onConnect={() => navigate('/connect')}
          onInsights={() => navigate('/insights')}
          onChat={() => navigate('/chat')}
        />
      )}

      {!isSupporter && (
        <div className="home-tab-strip" role="tablist" aria-label="Home sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeHomeTab === 'glance'}
            className={`home-tab-btn${activeHomeTab === 'glance' ? ' active' : ''}`}
            onClick={() => setActiveHomeTab('glance')}
          >
            Money at a glance
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeHomeTab === 'hub'}
            className={`home-tab-btn${activeHomeTab === 'hub' ? ' active' : ''}`}
            onClick={() => setActiveHomeTab('hub')}
          >
            Supporter Hub
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeHomeTab === 'shield'}
            className={`home-tab-btn${activeHomeTab === 'shield' ? ' active' : ''}`}
            onClick={() => setActiveHomeTab('shield')}
          >
            Helpful reminders
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeHomeTab === 'essentials'}
            className={`home-tab-btn${activeHomeTab === 'essentials' ? ' active' : ''}`}
            onClick={() => setActiveHomeTab('essentials')}
          >
            Essentials Hub
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            className="home-tab-btn"
            onClick={() => navigate('/limits')}
          >
            Spending limits
          </button>
        </div>
      )}

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
      {insights?.length === 0 && !isSupporter && activeHomeTab === 'glance' && (
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
      {!isSupporter && activeHomeTab === 'glance' && (
        hasInsights ? (
          <FinancialSnapshot
            latestInsight={latestInsight}
            summary={viz?.summary}
            vizLoading={vizLoading}
            onViewAll={() => navigate('/insights')}
          />
        ) : (
          <section className="card empty-state">
            <p>No money snapshot yet. Add your bank data to unlock your glance view.</p>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/connect')}>Add bank data</button>
          </section>
        )
      )}

      {!isSupporter && activeHomeTab === 'essentials' && (
        <CalmEssentialsPanel
          onChat={() => navigate('/chat?prefill=Help me focus on rent, food, and transport only. Give me one safe step for today.&autosend=1')}
        />
      )}

      {/* ── Support circle ── */}
      {!isSupporter && activeHomeTab === 'hub' && <SupportCircle userId={user?.id} preferredLanguage={user?.preferred_language} />}
      {!isSupporter && activeHomeTab === 'shield' && <TaxShieldSection />}
    </div>
  )
}
