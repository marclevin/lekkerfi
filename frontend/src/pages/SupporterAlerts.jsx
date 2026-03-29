import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  decideSupporterAlert,
  dismissSupporterAlert,
  getSupporterDashboardAlerts,
  markSupporterAlertRead,
} from '../api/client'
import {
  alertTypeLabel,
  alertTypeTone,
  chatSnippet,
  formatDateTime,
  formatMoney,
  isChatAlert,
  severityRank,
  timeMs,
} from './supporterShared'

export default function SupporterAlerts() {
  const navigate = useNavigate()
  const location = useLocation()
  const focusId = useMemo(() => new URLSearchParams(location.search).get('focus'), [location.search])

  const [alerts, setAlerts] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [alertFilter, setAlertFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  const sortedAlerts = useMemo(() => {
    const data = [...alerts].sort((a, b) => {
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

    if (alertFilter === 'chat') return data.filter((a) => isChatAlert(a))
    if (alertFilter === 'finance') return data.filter((a) => !isChatAlert(a))
    return data
  }, [alertFilter, alerts])

  const groupedAlerts = useMemo(() => ({
    chat: sortedAlerts.filter((alert) => isChatAlert(alert)),
    finance: sortedAlerts.filter((alert) => !isChatAlert(alert)),
  }), [sortedAlerts])

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

  function renderAlert(alert) {
    const snippet = chatSnippet(alert)
    const focused = focusId && String(alert.id) === String(focusId)

    return (
      <article
        key={alert.id}
        className={`supporter-alert supporter-${alert.severity} supporter-alert-${alertTypeTone(alert.alert_type)}${alert.read ? ' supporter-alert-read' : ''}${alert.is_overdue ? ' supporter-alert-overdue' : ''}${focused ? ' supporter-alert-focused' : ''}`}
      >
        <div className="supporter-alert-top">
          <div>
            <p className="supporter-alert-user">{alert.user_name}</p>
            <p className="supporter-alert-type">{alertTypeLabel(alert.alert_type)}</p>
          </div>
          <div className="supporter-alert-meta">
            {alert.is_overdue && (
              <span className="supporter-alert-overdue-pill">Overdue by {alert.overdue_by_minutes || 0}m</span>
            )}
            <span className="supporter-alert-time">{formatDateTime(alert.created_at)}</span>
          </div>
        </div>

        <div className="supporter-alert-body">
          <p>Safe to spend: <strong>{formatMoney(alert.safe_to_spend)}</strong></p>
          {alert.metadata?.message && <p>{alert.metadata.message}</p>}
          {alert.metadata?.coach_signals?.purchase_amount && (
            <p>Purchase amount: <strong>{formatMoney(alert.metadata.coach_signals.purchase_amount)}</strong></p>
          )}
        </div>

        {(snippet.user || snippet.assistant || alert.alert_type === 'pause_prompt') && (
          <div className="supporter-chat-snippet">
            <p className="supporter-chat-snippet-label">Triggered by chat</p>
            {snippet.user && <p className="supporter-chat-snippet-line"><strong>User:</strong> {snippet.user}</p>}
            {snippet.assistant && <p className="supporter-chat-snippet-line"><strong>Assistant:</strong> {snippet.assistant}</p>}
            {!snippet.user && !snippet.assistant && (
              <p className="supporter-chat-snippet-line"><strong>Context:</strong> Chat snippet is still being prepared.</p>
            )}
          </div>
        )}

        <div className="supporter-alert-actions">
          {alert.alert_type === 'pause_prompt' && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => handleDecision(alert.id, 'approve')}>Approve</button>
              <button className="btn btn-secondary btn-sm" onClick={() => handleDecision(alert.id, 'decline')}>Decline</button>
            </>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => handleOpenAlert(alert)}>Open user</button>
          <button className="btn btn-ghost btn-sm" onClick={() => handleDismissAlert(alert.id)}>Dismiss</button>
        </div>
      </article>
    )
  }

  return (
    <div className="page supporter-dashboard-page">
      <div className="page-header supporter-header">
        <h1>Supporter Alerts</h1>
        <p>A dedicated triage view for chat and financial alerts.</p>
        {unreadCount > 0 && (
          <span className="supporter-unread-pill">
            {unreadCount} unread alert{unreadCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <nav className="supporter-page-nav" aria-label="Supporter sections">
        <Link className="supporter-page-link" to="/supporter">Overview</Link>
        <Link className="supporter-page-link" to="/supporter/users">Manage users</Link>
        <Link className="supporter-page-link active" to="/supporter/alerts" aria-current="page">Alerts</Link>
      </nav>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="page-center"><span className="spinner" /></div>
      ) : (
        <section className="card supporter-alerts-panel">
          <div className="supporter-alert-filter-row">
            <div className="tab-bar" role="tablist" aria-label="Alert filters">
              <button role="tab" aria-selected={alertFilter === 'all'} className={`tab${alertFilter === 'all' ? ' active' : ''}`} onClick={() => setAlertFilter('all')}>All</button>
              <button role="tab" aria-selected={alertFilter === 'chat'} className={`tab${alertFilter === 'chat' ? ' active' : ''}`} onClick={() => setAlertFilter('chat')}>Chat review</button>
              <button role="tab" aria-selected={alertFilter === 'finance'} className={`tab${alertFilter === 'finance' ? ' active' : ''}`} onClick={() => setAlertFilter('finance')}>Financial</button>
            </div>
          </div>

          {sortedAlerts.length === 0 ? (
            <div className="empty-state"><p>No active alerts.</p></div>
          ) : (
            <div className="supporter-alert-groups">
              {groupedAlerts.chat.length > 0 && (
                <div className="supporter-alert-group">
                  <p className="supporter-alert-group-title">Chat spending reviews ({groupedAlerts.chat.length})</p>
                  <div className="supporter-alert-feed">{groupedAlerts.chat.map((alert) => renderAlert(alert))}</div>
                </div>
              )}
              {groupedAlerts.finance.length > 0 && (
                <div className="supporter-alert-group">
                  <p className="supporter-alert-group-title">Financial monitoring ({groupedAlerts.finance.length})</p>
                  <div className="supporter-alert-feed">{groupedAlerts.finance.map((alert) => renderAlert(alert))}</div>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
