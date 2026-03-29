import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  decideSupporterAlert,
  dismissSupporterAlert,
  getSupporterDashboardAlerts,
  injectSupporterMessage,
  markSupporterAlertRead,
} from '../api/client'
import {
  alertTypeLabel,
  chatSnippet,
  formatDateTime,
  formatMoney,
  hasSafetyFlag,
  isChatAlert,
  severityRank,
  timeMs,
} from './supporterShared'

const QUICK_TEMPLATES = [
  "Checking in on you — how are things going?",
  "Before that purchase, let's chat — I want to help you think it through.",
  "Your payday is coming up — let's plan together.",
]

function getPriorityLane(alert) {
  if (alert.is_overdue) return 'act_now'
  if (hasSafetyFlag(alert)) return 'act_now'
  const isPaused = Boolean(alert.metadata?.coach_signals?.pause_required)
  const needsDecision =
    alert.alert_type === 'pause_prompt' ||
    (alert.alert_type === 'decision_support' && isPaused)
  if (needsDecision && !alert.read) return 'act_now'
  if (!alert.read) return 'review'
  return 'logged'
}

export default function SupporterAlerts() {
  const navigate = useNavigate()
  const location = useLocation()
  const focusId = useMemo(() => new URLSearchParams(location.search).get('focus'), [location.search])

  const [alerts, setAlerts] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [lane, setLane] = useState('act_now')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Per-alert inline message state
  const [quickMsgOpen, setQuickMsgOpen] = useState({})
  const [quickMsgMap, setQuickMsgMap] = useState({})
  const [quickMsgSending, setQuickMsgSending] = useState({})
  const [quickMsgSent, setQuickMsgSent] = useState({})

  const fetchAlerts = useCallback(async () => {
    const data = await getSupporterDashboardAlerts()
    setAlerts(data.alerts || [])
    setUnreadCount(data.unread_count || 0)
  }, [])

  const initialLoad = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await fetchAlerts()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [fetchAlerts])

  useEffect(() => { initialLoad() }, [initialLoad])

  useEffect(() => {
    const timer = setInterval(() => {
      fetchAlerts().catch(() => {})
    }, 9000)
    return () => clearInterval(timer)
  }, [fetchAlerts])

  const sorted = useMemo(() => {
    return [...alerts].sort((a, b) => {
      const overdueDiff = Number(Boolean(b.is_overdue)) - Number(Boolean(a.is_overdue))
      if (overdueDiff !== 0) return overdueDiff
      const unreadDiff = Number(!b.read) - Number(!a.read)
      if (unreadDiff !== 0) return unreadDiff
      const chatDiff = Number(isChatAlert(b)) - Number(isChatAlert(a))
      if (chatDiff !== 0) return chatDiff
      const sevDiff = severityRank(b.severity) - severityRank(a.severity)
      if (sevDiff !== 0) return sevDiff
      return timeMs(b.created_at) - timeMs(a.created_at)
    })
  }, [alerts])

  const lanes = useMemo(() => ({
    act_now: sorted.filter((a) => getPriorityLane(a) === 'act_now'),
    review:  sorted.filter((a) => getPriorityLane(a) === 'review'),
    logged:  sorted.filter((a) => getPriorityLane(a) === 'logged'),
  }), [sorted])

  const visible = useMemo(() => lanes[lane] ?? [], [lane, lanes])

  async function handleDismissAlert(alertId) {
    try {
      await dismissSupporterAlert(alertId)
      await fetchAlerts()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleOpenAlert(alert) {
    try {
      await markSupporterAlertRead(alert.id)
      await fetchAlerts()
      if (alert.user_id) {
        navigate(`/supporter/users/${alert.user_id}?concern=chat-controls&focus=${alert.id}`)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDecision(alertId, decision) {
    try {
      await decideSupporterAlert(alertId, decision)
      await fetchAlerts()
    } catch (err) {
      setError(err.message)
    }
  }

  function toggleQuickMsg(alertId) {
    setQuickMsgOpen((prev) => ({ ...prev, [alertId]: !prev[alertId] }))
  }

  async function handleQuickMessage(alert) {
    const text = (quickMsgMap[alert.id] || '').trim()
    if (!text || !alert.user_id) return
    setQuickMsgSending((p) => ({ ...p, [alert.id]: true }))
    try {
      await injectSupporterMessage(alert.user_id, text, { targetLanguage: 'english' })
      setQuickMsgOpen((p) => ({ ...p, [alert.id]: false }))
      setQuickMsgMap((p) => ({ ...p, [alert.id]: '' }))
      setQuickMsgSent((p) => ({ ...p, [alert.id]: true }))
      setTimeout(() => setQuickMsgSent((p) => ({ ...p, [alert.id]: false })), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setQuickMsgSending((p) => ({ ...p, [alert.id]: false }))
    }
  }

  function renderAlert(alert) {
    const snippet = chatSnippet(alert)
    const focused = focusId && String(alert.id) === String(focusId)
    const safetyFlagged = hasSafetyFlag(alert)
    const concernSummary = alert.metadata?.concern_summary || null
    const isPaused = Boolean(alert.metadata?.coach_signals?.pause_required)
    const showDecisionButtons =
      alert.alert_type === 'pause_prompt' ||
      (alert.alert_type === 'decision_support' && isPaused)
    const firstName = (alert.user_name || 'User').split(' ')[0]
    const isQuickOpen = Boolean(quickMsgOpen[alert.id])
    const quickText = quickMsgMap[alert.id] || ''
    const sent = Boolean(quickMsgSent[alert.id])

    // Status banner label
    let bannerLabel = null
    let bannerClass = ''
    if (alert.is_overdue) {
      bannerLabel = `Overdue by ${alert.overdue_by_minutes || 0} minutes — needs immediate action`
      bannerClass = 'banner-overdue'
    } else if (safetyFlagged) {
      bannerLabel = 'Needs your attention'
      bannerClass = 'banner-safety'
    } else if (alert.severity === 'critical') {
      bannerLabel = 'Critical alert'
      bannerClass = 'banner-critical'
    }

    return (
      <article
        key={alert.id}
        className={[
          'supporter-alert-v2',
          `severity-${alert.severity}`,
          alert.read ? 'alert-v2-read' : 'alert-v2-unread',
          focused ? 'alert-v2-focused' : '',
        ].filter(Boolean).join(' ')}
      >
        {/* Top status banner */}
        {bannerLabel && (
          <div className={`alert-status-banner ${bannerClass}`}>
            {bannerLabel}
          </div>
        )}

        {/* Header row */}
        <div className="alert-v2-header">
          <div className="alert-v2-identity">
            <span className="alert-v2-name">{alert.user_name}</span>
            <span className="alert-v2-type">{alertTypeLabel(alert.alert_type)}</span>
          </div>
          <span className="alert-v2-time">{formatDateTime(alert.created_at)}</span>
        </div>

        {/* Concern summary */}
        {concernSummary && (
          <p className="alert-v2-summary">{concernSummary}</p>
        )}

        {/* Financial pill badges */}
        <div className="alert-financial-pills">
          <span className="alert-pill alert-pill-safe">
            Safe: <strong>{formatMoney(alert.safe_to_spend)}</strong>
          </span>
          {alert.metadata?.coach_signals?.purchase_amount && (
            <span className="alert-pill alert-pill-want">
              Wants: <strong>{formatMoney(alert.metadata.coach_signals.purchase_amount)}</strong>
            </span>
          )}
        </div>

        {/* Chat snippet as speech bubbles */}
        {(snippet.user || snippet.assistant) && (
          <div className="alert-chat-bubbles">
            {snippet.user && (
              <div className="bubble-row bubble-user">
                <div className="chat-bubble">{snippet.user}</div>
                {snippet.userEnglish && (
                  <p className="bubble-translation">({snippet.userEnglish})</p>
                )}
              </div>
            )}
            {snippet.assistant && (
              <div className="bubble-row bubble-ai">
                <div className="chat-bubble">{snippet.assistant}</div>
              </div>
            )}
          </div>
        )}

        {/* Decision buttons — primary, full-width */}
        {showDecisionButtons && (
          <div className="alert-decision-row">
            <button className="btn btn-approve" onClick={() => handleDecision(alert.id, 'approve')}>
              Approve — Resume chat
            </button>
            <button className="btn btn-decline" onClick={() => handleDecision(alert.id, 'decline')}>
              Decline — Keep paused
            </button>
          </div>
        )}

        {/* Secondary actions */}
        <div className="alert-secondary-row">
          {sent ? (
            <span className="alert-sent-confirm">Message sent</span>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => toggleQuickMsg(alert.id)}>
              {isQuickOpen ? 'Cancel' : 'Quick message'}
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => handleOpenAlert(alert)}>
            Open care page →
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => handleDismissAlert(alert.id)}>
            Dismiss
          </button>
        </div>

        {/* Inline quick message composer */}
        {isQuickOpen && (
          <div className="alert-quick-compose">
            <div className="quick-msg-templates">
              {QUICK_TEMPLATES.map((t) => (
                <button
                  key={t}
                  className="quick-template-chip"
                  onClick={() => setQuickMsgMap((p) => ({ ...p, [alert.id]: t }))}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="quick-msg-input-row">
              <textarea
                className="quick-msg-input"
                value={quickText}
                onChange={(e) => setQuickMsgMap((p) => ({ ...p, [alert.id]: e.target.value }))}
                placeholder={`Message to ${firstName}…`}
                rows={2}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleQuickMessage(alert)}
                disabled={!quickText.trim() || quickMsgSending[alert.id]}
              >
                {quickMsgSending[alert.id] ? '…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </article>
    )
  }

  const laneLabels = {
    act_now: 'Act Now',
    review:  'Review',
    logged:  'Logged',
  }

  return (
    <div className="page supporter-dashboard-page">
      <div className="page-header supporter-header">
        <h1>Alerts</h1>
        <p>Triage and act on chat and financial alerts for your users.</p>
        {unreadCount > 0 && (
          <span className="supporter-unread-pill">
            {unreadCount} unread
          </span>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="page-center"><span className="spinner" /></div>
      ) : (
        <>
          {/* Priority lane tabs */}
          <div className="priority-lane-bar">
            {['act_now', 'review', 'logged'].map((l) => (
              <button
                key={l}
                className={`priority-lane-tab${lane === l ? ' active' : ''}${l === 'act_now' && lanes.act_now.length > 0 ? ' has-urgent' : ''}`}
                onClick={() => setLane(l)}
                aria-pressed={lane === l}
              >
                {laneLabels[l]}
                {lanes[l].length > 0 && (
                  <span className="lane-count">{lanes[l].length}</span>
                )}
              </button>
            ))}
          </div>

          <section className="supporter-alert-feed-v2" aria-label={`${laneLabels[lane]} alerts`}>
            {visible.length === 0 ? (
              <div className="empty-state card">
                <p>
                  {lane === 'act_now'
                    ? 'No urgent alerts right now — check the Review tab for unread items.'
                    : lane === 'review'
                    ? 'All caught up — nothing new to review.'
                    : 'No logged alerts yet.'}
                </p>
              </div>
            ) : (
              visible.map((alert) => renderAlert(alert))
            )}
          </section>
        </>
      )}
    </div>
  )
}
