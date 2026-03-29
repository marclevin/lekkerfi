import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupporterDashboardAlerts, getSupporterDashboardUsers } from '../api/client'
import {
  computeAggregateSignals,
  formatDateTime,
  formatMoney,
  isChatAlert,
  SignalCard,
  timeMs,
} from './supporterShared'

export default function SupporterHome() {
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [alerts, setAlerts] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchUsers = useCallback(async () => {
    const data = await getSupporterDashboardUsers()
    setUsers(data.users || [])
  }, [])

  const fetchAlerts = useCallback(async () => {
    const data = await getSupporterDashboardAlerts()
    setAlerts(data.alerts || [])
    setUnreadCount(data.unread_count || 0)
  }, [])

  const initialLoad = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await Promise.all([fetchUsers(), fetchAlerts()])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [fetchAlerts, fetchUsers])

  useEffect(() => { initialLoad() }, [initialLoad])

  useEffect(() => {
    const timer = setInterval(() => {
      fetchUsers().catch(() => {})
      fetchAlerts().catch(() => {})
    }, 10000)
    return () => clearInterval(timer)
  }, [fetchAlerts, fetchUsers])

  const managementSummary = useMemo(() => {
    const pausedChats = users.filter((u) => u.chat_pause?.is_paused).length
    const criticalAlerts = alerts.filter((a) => a.severity === 'critical').length
    const overdueAlerts = alerts.filter((a) => a.is_overdue).length
    const lastSeen = [...users]
      .map((u) => timeMs(u.last_login_at || u.last_active || u.last_chat_at))
      .sort((a, b) => b - a)[0]

    return {
      managedUsers: users.length,
      pausedChats,
      criticalAlerts,
      overdueAlerts,
      lastSeen: lastSeen ? new Date(lastSeen).toISOString() : null,
    }
  }, [alerts, users])

  const signals = useMemo(() => computeAggregateSignals(users, alerts), [alerts, users])
  const sortedRecentAlerts = useMemo(() => {
    return [...alerts]
      .sort((a, b) => timeMs(b.created_at) - timeMs(a.created_at))
      .slice(0, 5)
  }, [alerts])

  const scamDetectionMock = useMemo(() => {
    const suspicious = alerts.filter((a) => {
      const message = String(a.metadata?.message || '').toLowerCase()
      return message.includes('otp') || message.includes('urgent') || message.includes('verification')
    }).length
    return {
      suspiciousCount: suspicious,
      openCases: Math.max(1, Math.min(3, suspicious + (unreadCount > 0 ? 1 : 0))),
    }
  }, [alerts, unreadCount])

  return (
    <div className="page supporter-dashboard-page">
      <div className="page-header supporter-header">
        <h1>Supporter Dashboard</h1>
        <p>A clean overview of your support circle, with clear next actions.</p>
        {unreadCount > 0 && (
          <span className="supporter-unread-pill">
            {unreadCount} unread alert{unreadCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="page-center"><span className="spinner" /></div>
      ) : (
        <>
          <section className="supporter-summary-grid" aria-label="Supporter summary metrics">
            <div className="supporter-summary-card card">
              <p className="supporter-summary-label">Managed users</p>
              <p className="supporter-summary-value">{managementSummary.managedUsers}</p>
            </div>
            <div className="supporter-summary-card card">
              <p className="supporter-summary-label">Paused chats</p>
              <p className="supporter-summary-value">{managementSummary.pausedChats}</p>
            </div>
            <div className="supporter-summary-card card">
              <p className="supporter-summary-label">Critical alerts</p>
              <p className="supporter-summary-value">{managementSummary.criticalAlerts}</p>
            </div>
            <div className="supporter-summary-card card">
              <p className="supporter-summary-label">Overdue alerts</p>
              <p className="supporter-summary-value">{managementSummary.overdueAlerts}</p>
            </div>
            <div className="supporter-summary-card card">
              <p className="supporter-summary-label">Last user sign-in</p>
              <p className="supporter-summary-value supporter-summary-value-small">{formatDateTime(managementSummary.lastSeen)}</p>
            </div>
          </section>

          <section className="card" aria-label="Behavioural signals overview">
            <div className="supporter-overview-head">
              <h2>Behavioural Signals</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/supporter/alerts')}>Open alerts</button>
            </div>
            <div className="signal-cards">
              <SignalCard signal={signals.velocity} />
              <SignalCard signal={signals.inactivity} />
              <SignalCard signal={signals.duplicates} />
            </div>
          </section>

          <section className="card supporter-quick-grid" aria-label="Quick actions">
            <button className="supporter-quick-card" onClick={() => navigate('/supporter/users')}>
              <span className="supporter-quick-icon" aria-hidden="true">👥</span>
              <span className="supporter-quick-title">Manage Users</span>
              <span className="supporter-quick-desc">Open focused user management and care tools.</span>
            </button>
            <button className="supporter-quick-card" onClick={() => navigate('/supporter/alerts')}>
              <span className="supporter-quick-icon" aria-hidden="true">🚨</span>
              <span className="supporter-quick-title">Review Alerts</span>
              <span className="supporter-quick-desc">Triage chat and financial alerts in one place.</span>
            </button>
            <button className="supporter-quick-card" onClick={() => navigate('/profile')}>
              <span className="supporter-quick-icon" aria-hidden="true">⚙️</span>
              <span className="supporter-quick-title">Account Settings</span>
              <span className="supporter-quick-desc">Add users and update supporter profile settings.</span>
            </button>
          </section>

          <section className="card supporter-scam-dashboard" aria-label="Scam detection prototype">
            <div className="supporter-overview-head">
              <h2>Scam Detection (Mocked)</h2>
              <span className="status-badge status-warning">Prototype</span>
            </div>
            <div className="supporter-scam-grid">
              <article className="supporter-scam-metric">
                <p className="supporter-summary-label">Open cases</p>
                <p className="supporter-summary-value">{scamDetectionMock.openCases}</p>
              </article>
              <article className="supporter-scam-metric">
                <p className="supporter-summary-label">Suspicious wording flags</p>
                <p className="supporter-summary-value">{scamDetectionMock.suspiciousCount}</p>
              </article>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              Next rollout: merchant risk scoring, phone number trust checks, and beneficiary verification prompts.
            </p>
          </section>

          <section className="card" aria-label="Recent alert activity">
            <div className="supporter-overview-head">
              <h2>Recent Alert Activity</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/supporter/alerts')}>View all</button>
            </div>
            {sortedRecentAlerts.length === 0 ? (
              <div className="empty-state"><p>No active alerts right now.</p></div>
            ) : (
              <div className="supporter-recent-list">
                {sortedRecentAlerts.map((alert) => (
                  <button
                    key={alert.id}
                    className="supporter-recent-row"
                    onClick={() => navigate(`/supporter/alerts?focus=${alert.id}`)}
                  >
                    <span className={`status-badge status-${alert.severity || 'info'}`}>
                      {isChatAlert(alert) ? 'Chat' : 'Finance'}
                    </span>
                    <span className="supporter-recent-body">
                      <strong>{alert.user_name || 'User'}</strong>
                      <span>{alert.metadata?.message || 'Supporter attention required'}</span>
                    </span>
                    <span className="supporter-recent-right">
                      <span>{formatMoney(alert.safe_to_spend)}</span>
                      <span>{formatDateTime(alert.created_at)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
