import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addSupporterNote,
  decideSupporterAlert,
  dismissSupporterAlert,
  getSupporterDashboardAlerts,
  getSupporterDashboardUsers,
  getSupporterUserDetails,
  markSupporterAlertRead,
  setSupporterUserChatPause,
  supporterUploadStatement,
  upsertUserSpendingLimit,
} from '../api/client'

const LANGUAGES = [
  { value: 'xhosa',     label: 'isiXhosa' },
  { value: 'zulu',      label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho',     label: 'Sesotho' },
  { value: 'english',   label: 'English' },
]

// ── Formatters ────────────────────────────────────────────────────────────────

function formatMoney(value) {
  if (value == null || Number.isNaN(Number(value))) return 'R 0.00'
  return `R ${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDateTime(iso) {
  if (!iso) return 'Unknown'
  return new Date(iso).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function riskLabel(status) {
  if (status === 'at_risk') return 'At Risk'
  if (status === 'watch') return 'Watch'
  if (status === 'stable') return 'Stable'
  return 'No Data'
}

function timeMs(value) {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function severityRank(value) {
  if (value === 'critical') return 3
  if (value === 'warning') return 2
  return 1
}

function riskRank(value) {
  if (value === 'at_risk') return 3
  if (value === 'watch') return 2
  if (value === 'stable') return 1
  return 0
}

function isChatAlert(alert) {
  return alert.alert_type === 'pause_prompt'
}

function alertTypeLabel(value) {
  if (value === 'pause_prompt') return 'Chat spending review'
  if (value === 'payday_warning') return 'Payday warning'
  if (value === 'low_balance') return 'Low balance'
  if (value === 'unusual_spend') return 'Unusual spend'
  return String(value || '').replace('_', ' ')
}

function alertTypeTone(value) {
  if (value === 'pause_prompt') return 'chat'
  return 'finance'
}

function chatSnippet(alert) {
  const ctx = alert.chat_context || alert.metadata?.chat_context || {}
  return {
    user: ctx.user_message || alert.metadata?.coach_signals?.trigger_user_message || null,
    assistant:
      ctx.assistant_message ||
      ctx.assistant_response_english ||
      alert.metadata?.coach_signals?.trigger_assistant_english ||
      null,
  }
}

// ── Behavioural signal computation ───────────────────────────────────────────

function daysSince(isoDate) {
  if (!isoDate) return null
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24))
}

function computeUserSignals(selectedDetails) {
  const mgmt = selectedDetails.management || {}
  const transactions = selectedDetails.transactions || []

  // Velocity
  const spending7d = mgmt.spending_7d || 0
  const avgDaily = mgmt.avg_daily_spend_30d || 0
  const expected7d = avgDaily * 7
  let velocity
  if (avgDaily === 0) {
    velocity = {
      level: 'ok',
      label: 'Spending Velocity',
      value: 'No baseline yet',
      desc: 'Upload a statement to start tracking spending pace.',
    }
  } else {
    const ratio = expected7d > 0 ? spending7d / expected7d : 0
    const pct = Math.round(ratio * 100)
    if (ratio > 1.8) {
      velocity = {
        level: 'critical',
        label: 'Spending Velocity',
        value: `${pct}% of weekly baseline`,
        desc: `Spending ${Math.round((ratio - 1) * 100)}% faster than usual. Consider an immediate check-in.`,
      }
    } else if (ratio > 1.3) {
      velocity = {
        level: 'warn',
        label: 'Spending Velocity',
        value: `${pct}% of weekly baseline`,
        desc: 'Pace is elevated this week. Watch for stress spending or impulse triggers.',
      }
    } else {
      velocity = {
        level: 'ok',
        label: 'Spending Velocity',
        value: `${pct}% of weekly baseline`,
        desc: 'Spending is on track relative to the 30-day baseline.',
      }
    }
  }

  // Inactivity
  const lastSeen = mgmt.last_login_at || mgmt.last_chat_at
  const daysInactive = daysSince(lastSeen)
  let inactivity
  if (daysInactive === null) {
    inactivity = {
      level: 'critical',
      label: 'Inactivity',
      value: 'Never logged in',
      desc: 'User has not accessed the app yet. Direct outreach recommended.',
    }
  } else if (daysInactive >= 14) {
    inactivity = {
      level: 'critical',
      label: 'Inactivity',
      value: `${daysInactive} days since login`,
      desc: 'Over two weeks without activity. Consider a welfare check.',
    }
  } else if (daysInactive >= 7) {
    inactivity = {
      level: 'warn',
      label: 'Inactivity',
      value: `${daysInactive} days since login`,
      desc: 'A week without activity. A short check-in message may help.',
    }
  } else {
    inactivity = {
      level: 'ok',
      label: 'Inactivity',
      value: daysInactive === 0 ? 'Active today' : `Last seen ${daysInactive}d ago`,
      desc: 'User is regularly engaging with the app.',
    }
  }

  // Duplicates — same description + amount within the last 7 days
  const now = Date.now()
  const recentTx = transactions.filter((tx) => {
    if (!tx.date) return false
    return (now - new Date(tx.date).getTime()) / (1000 * 60 * 60 * 24) <= 7
  })
  const groups = {}
  for (const tx of recentTx) {
    if (tx.amount >= 0) continue
    const key = `${(tx.description || '').toLowerCase().trim().slice(0, 50)}|${Math.abs(tx.amount).toFixed(2)}`
    groups[key] = (groups[key] || 0) + 1
  }
  const dupPairs = Object.values(groups).filter((count) => count >= 2).length
  let duplicates
  if (dupPairs >= 3) {
    duplicates = {
      level: 'critical',
      label: 'Duplicate Payments',
      value: `${dupPairs} repeat transactions`,
      desc: 'Multiple same-amount charges found this week. Review for accidental duplicates.',
    }
  } else if (dupPairs >= 1) {
    duplicates = {
      level: 'warn',
      label: 'Duplicate Payments',
      value: `${dupPairs} possible repeat`,
      desc: 'A similar charge appeared more than once this week. Worth verifying.',
    }
  } else {
    duplicates = {
      level: 'ok',
      label: 'Duplicate Payments',
      value: 'None detected',
      desc: 'No repeated transactions found in the last 7 days.',
    }
  }

  return { velocity, inactivity, duplicates }
}

function computeAggregateSignals(users) {
  const now = Date.now()

  const atRisk = users.filter((u) => u.risk_status === 'at_risk').length
  const watched = users.filter((u) => u.risk_status === 'watch').length
  let velocity
  if (atRisk > 0) {
    velocity = {
      level: 'critical',
      label: 'Spending Velocity',
      value: `${atRisk} user${atRisk > 1 ? 's' : ''} at risk`,
      desc: `${atRisk + watched} user${atRisk + watched > 1 ? 's' : ''} flagged for elevated or risky spending.`,
    }
  } else if (watched > 0) {
    velocity = {
      level: 'warn',
      label: 'Spending Velocity',
      value: `${watched} user${watched > 1 ? 's' : ''} on watch`,
      desc: 'Some users have spending worth monitoring. Review their recent activity.',
    }
  } else {
    velocity = {
      level: 'ok',
      label: 'Spending Velocity',
      value: users.length > 0 ? 'All users stable' : 'No users yet',
      desc: users.length > 0
        ? 'No elevated spending detected across your support circle.'
        : 'Link users to start seeing velocity signals.',
    }
  }

  const inactive7d = users.filter((u) => {
    const lastSeen = u.last_login_at || u.last_active
    if (!lastSeen) return true
    return (now - new Date(lastSeen).getTime()) / (1000 * 60 * 60 * 24) >= 7
  }).length
  let inactivity
  if (inactive7d >= 2) {
    inactivity = {
      level: 'critical',
      label: 'Inactivity',
      value: `${inactive7d} users inactive 7d+`,
      desc: 'Multiple users not seen in over a week. Consider reaching out.',
    }
  } else if (inactive7d === 1) {
    inactivity = {
      level: 'warn',
      label: 'Inactivity',
      value: '1 user inactive 7d+',
      desc: 'One user has not logged in for a week. A check-in may help.',
    }
  } else {
    inactivity = {
      level: 'ok',
      label: 'Inactivity',
      value: users.length > 0 ? 'All recently active' : 'No users yet',
      desc: users.length > 0 ? 'Good engagement across your support circle.' : 'Link users to start tracking.',
    }
  }

  const withAlerts = users.filter((u) => u.active_alert_count > 0).length
  let duplicates
  if (withAlerts >= 2) {
    duplicates = {
      level: 'critical',
      label: 'Unresolved Alerts',
      value: `${withAlerts} users have alerts`,
      desc: 'Multiple users have unresolved financial alerts needing attention.',
    }
  } else if (withAlerts === 1) {
    duplicates = {
      level: 'warn',
      label: 'Unresolved Alerts',
      value: '1 user has alerts',
      desc: 'One user has an unresolved financial alert. Review the Alerts tab.',
    }
  } else {
    duplicates = {
      level: 'ok',
      label: 'Unresolved Alerts',
      value: 'All clear',
      desc: 'No unresolved financial alerts across your users.',
    }
  }

  return { velocity, inactivity, duplicates }
}

// ── Signal Card ───────────────────────────────────────────────────────────────

function SignalCard({ signal }) {
  const iconMap = { ok: '✓', warn: '!', critical: '⚠' }
  return (
    <div className={`signal-card signal-card-${signal.level}`}>
      <div className="signal-card-header">
        <span className={`signal-card-icon signal-icon-${signal.level}`} aria-hidden="true">
          {iconMap[signal.level]}
        </span>
        <p className="signal-card-label">{signal.label}</p>
      </div>
      <p className="signal-card-value">{signal.value}</p>
      <p className="signal-card-desc">{signal.desc}</p>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function SupporterDashboard() {
  const [users, setUsers] = useState([])
  const [alerts, setAlerts] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
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
  const [alertFilter, setAlertFilter] = useState('all')
  const [activeTab, setActiveTab] = useState('signals')

  // Upload on behalf
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadLanguage, setUploadLanguage] = useState('english')
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const uploadInputRef = useRef(null)

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    const data = await getSupporterDashboardUsers()
    setUsers(data.users || [])
  }, [])

  const fetchAlerts = useCallback(async (userId = selectedUserId) => {
    const data = await getSupporterDashboardAlerts({ userId })
    setAlerts(data.alerts || [])
    setUnreadCount(data.unread_count || 0)
  }, [selectedUserId])

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

  const initialLoad = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await fetchUsers()
      await fetchAlerts()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [fetchAlerts, fetchUsers])

  useEffect(() => { initialLoad() }, [initialLoad])

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedDetails(null)
      setNoteText('')
      return
    }
    fetchUserDetails(selectedUserId).catch((err) => setError(err.message))
    fetchAlerts(selectedUserId).catch((err) => setError(err.message))
  }, [fetchAlerts, fetchUserDetails, selectedUserId])

  useEffect(() => {
    const timer = setInterval(() => {
      fetchAlerts().catch(() => {})
      fetchUsers().catch(() => {})
    }, 7000)
    return () => clearInterval(timer)
  }, [fetchAlerts, fetchUsers])

  // Auto-switch to Care tab when a user is selected
  useEffect(() => {
    if (selectedUserId) setActiveTab('care')
  }, [selectedUserId])

  // ── Derived state ───────────────────────────────────────────────────────────

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
    if (alertFilter === 'chat') return data.filter((alert) => isChatAlert(alert))
    if (alertFilter === 'finance') return data.filter((alert) => !isChatAlert(alert))
    return data
  }, [alerts, alertFilter])

  const groupedAlerts = useMemo(() => ({
    chat: sortedAlerts.filter((alert) => isChatAlert(alert)),
    finance: sortedAlerts.filter((alert) => !isChatAlert(alert)),
  }), [sortedAlerts])

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

  const behaviouralSignals = useMemo(() => {
    if (selectedDetails) return computeUserSignals(selectedDetails)
    return computeAggregateSignals(users)
  }, [selectedDetails, users])

  const hasSignalIssue = behaviouralSignals.velocity.level !== 'ok' ||
    behaviouralSignals.inactivity.level !== 'ok' ||
    behaviouralSignals.duplicates.level !== 'ok'

  const hasSignalCritical = [behaviouralSignals.velocity, behaviouralSignals.inactivity, behaviouralSignals.duplicates]
    .some((s) => s.level === 'critical')

  // ── Handlers ────────────────────────────────────────────────────────────────

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
      if (alert.user_id) setSelectedUserId(alert.user_id)
      await fetchAlerts(alert.user_id || selectedUserId)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDecision(alertId, decision) {
    try {
      await decideSupporterAlert(alertId, decision)
      await fetchAlerts()
      if (selectedUserId) {
        await fetchUsers()
        await fetchUserDetails(selectedUserId)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleToggleChatPause(action) {
    if (!selectedUserId) return
    setSaving(true)
    setError('')
    try {
      await setSupporterUserChatPause(selectedUserId, action, pauseReasonText.trim())
      setPauseReasonText('')
      await fetchUsers()
      await fetchUserDetails(selectedUserId)
      await fetchAlerts(selectedUserId)
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
    if (userId === selectedUserId) {
      setSelectedUserId(null)
      setActiveTab('signals')
    } else {
      setSelectedUserId(userId)
    }
  }

  // ── Alert renderer ──────────────────────────────────────────────────────────

  function renderAlert(alert) {
    const snippet = chatSnippet(alert)
    return (
      <article
        key={alert.id}
        className={`supporter-alert supporter-${alert.severity} supporter-alert-${alertTypeTone(alert.alert_type)}${alert.read ? ' supporter-alert-read' : ''}${alert.is_overdue ? ' supporter-alert-overdue' : ''}`}
      >
        <div className="supporter-alert-top">
          <div>
            <p className="supporter-alert-user">{alert.user_name}</p>
            <p className="supporter-alert-type">{alertTypeLabel(alert.alert_type)}</p>
          </div>
          <div className="supporter-alert-meta">
            {alert.is_overdue && (
              <span className="supporter-alert-overdue-pill">
                Overdue by {alert.overdue_by_minutes || 0}m
              </span>
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
              <button className="btn btn-primary btn-sm" onClick={() => handleDecision(alert.id, 'approve')}>
                Approve
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => handleDecision(alert.id, 'decline')}>
                Decline
              </button>
            </>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => handleOpenAlert(alert)}>
            View user
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => handleDismissAlert(alert.id)}>
            Dismiss
          </button>
        </div>
      </article>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="page supporter-dashboard-page">
      <div className="page-header supporter-header">
        <h1>Supporter Dashboard</h1>
        <p>Review behavioural signals, act on alerts, and care for your users.</p>
        {unreadCount > 0 && (
          <span className="supporter-unread-pill">
            {unreadCount} unread alert{unreadCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="supporter-summary-grid">
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
          <p className="supporter-summary-value supporter-summary-value-small">
            {formatDateTime(managementSummary.lastSeen)}
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="page-center"><span className="spinner" /></div>
      ) : (
        <div className="supporter-layout">

          {/* ── Sidebar ── */}
          <aside className="supporter-sidebar card">
            <div className="supporter-side-top">
              <h2>My Users</h2>
              {selectedUserId && (
                <button className="btn btn-ghost btn-sm" onClick={() => handleSelectUser(selectedUserId)}>
                  Clear
                </button>
              )}
            </div>

            <div className="supporter-user-list">
              {sortedUsers.length === 0 && <p className="muted">No linked users yet.</p>}
              {sortedUsers.map((user) => (
                <button
                  key={user.id}
                  className={`supporter-user-card${selectedUserId === user.id ? ' active' : ''}`}
                  onClick={() => handleSelectUser(user.id)}
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

          {/* ── Main tabbed area ── */}
          <section className="supporter-main">
            <div className="card supporter-tabbed-card">

              {/* Tab bar */}
              <div className="supporter-tab-row">
                <div className="tab-bar">
                  <button
                    className={`tab${activeTab === 'signals' ? ' active' : ''}`}
                    onClick={() => setActiveTab('signals')}
                  >
                    Signals
                    {hasSignalIssue && (
                      <span className={`tab-signal-dot tab-signal-${hasSignalCritical ? 'critical' : 'warn'}`} />
                    )}
                  </button>
                  <button
                    className={`tab${activeTab === 'alerts' ? ' active' : ''}`}
                    onClick={() => setActiveTab('alerts')}
                  >
                    Alerts
                    {unreadCount > 0 && <span className="tab-badge">{unreadCount}</span>}
                  </button>
                  {selectedUser && (
                    <button
                      className={`tab${activeTab === 'care' ? ' active' : ''}`}
                      onClick={() => setActiveTab('care')}
                    >
                      {selectedUser.full_name.split(' ')[0]}
                    </button>
                  )}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { fetchAlerts(); fetchUsers() }}
                >
                  Refresh
                </button>
              </div>

              {/* ── Signals panel ── */}
              {activeTab === 'signals' && (
                <div className="supporter-signals-panel">
                  <p className="signal-context-label">
                    {selectedUser && selectedDetails
                      ? <>Signals for <strong>{selectedUser.full_name}</strong></>
                      : selectedUser
                      ? <>Loading signals for {selectedUser.full_name}…</>
                      : <>Aggregate across {users.length} managed user{users.length !== 1 ? 's' : ''}. Select a user for individual signals.</>
                    }
                  </p>

                  <div className="signal-cards">
                    <SignalCard signal={behaviouralSignals.velocity} />
                    <SignalCard signal={behaviouralSignals.inactivity} />
                    <SignalCard signal={behaviouralSignals.duplicates} />
                  </div>

                  {sortedAlerts.length > 0 && (
                    <div className="signal-alerts-footer">
                      <span className="signal-alerts-count">
                        {sortedAlerts.length} active alert{sortedAlerts.length > 1 ? 's' : ''}
                        {managementSummary.overdueAlerts > 0 && (
                          <span className="signal-overdue-badge">
                            {managementSummary.overdueAlerts} overdue
                          </span>
                        )}
                      </span>
                      <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('alerts')}>
                        Review alerts
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Alerts panel ── */}
              {activeTab === 'alerts' && (
                <div className="supporter-alerts-panel">
                  <div className="supporter-alert-filter-row">
                    <div className="tab-bar">
                      <button className={`tab${alertFilter === 'all' ? ' active' : ''}`} onClick={() => setAlertFilter('all')}>All</button>
                      <button className={`tab${alertFilter === 'chat' ? ' active' : ''}`} onClick={() => setAlertFilter('chat')}>Chat review</button>
                      <button className={`tab${alertFilter === 'finance' ? ' active' : ''}`} onClick={() => setAlertFilter('finance')}>Financial</button>
                    </div>
                  </div>

                  {sortedAlerts.length === 0 ? (
                    <div className="empty-state"><p>No active alerts.</p></div>
                  ) : (
                    <div className="supporter-alert-groups">
                      {groupedAlerts.chat.length > 0 && (
                        <div className="supporter-alert-group">
                          <p className="supporter-alert-group-title">Chat spending reviews ({groupedAlerts.chat.length})</p>
                          <div className="supporter-alert-feed">
                            {groupedAlerts.chat.map((alert) => renderAlert(alert))}
                          </div>
                        </div>
                      )}
                      {groupedAlerts.finance.length > 0 && (
                        <div className="supporter-alert-group">
                          <p className="supporter-alert-group-title">Financial monitoring ({groupedAlerts.finance.length})</p>
                          <div className="supporter-alert-feed">
                            {groupedAlerts.finance.map((alert) => renderAlert(alert))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Care tab: no user selected ── */}
              {activeTab === 'care' && !selectedUser && (
                <div className="empty-state">
                  <p>Select a user from the list to open their care console.</p>
                </div>
              )}

              {/* ── Care tab: loading ── */}
              {activeTab === 'care' && selectedUser && !selectedDetails && (
                <div className="page-center" style={{ minHeight: 120 }}>
                  <span className="spinner" />
                </div>
              )}

              {/* ── Care tab: loaded ── */}
              {activeTab === 'care' && selectedUser && selectedDetails && (
                <div className="supporter-care-panel">

                  <div className="supporter-care-header">
                    <div>
                      <h2>{selectedUser.full_name}</h2>
                      <span className={`status-badge status-${selectedUser.risk_status}`} style={{ marginTop: 4, display: 'inline-block' }}>
                        {riskLabel(selectedUser.risk_status)}
                      </span>
                    </div>
                    <span className="status-badge status-selected">Care Console</span>
                  </div>

                  {/* Management stats */}
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

                  {/* Calm care playbook */}
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
                    <div className="supporter-script-row">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setNoteText('I am noticing this moment might feel intense. Let us take one step at a time and pick one safe spending action for today.')}
                      >
                        De-escalation script
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setNoteText('Quick memory aid: today we only review essentials, one budget number, and one support contact. Keep language short and concrete.')}
                      >
                        Memory support script
                      </button>
                    </div>
                  </div>

                  {/* Two-column action panels */}
                  <div className="supporter-care-columns">

                    <div className="supporter-care-col">

                      {/* Upload statement */}
                      <section className="supporter-care-section">
                        <h3>Upload Statement</h3>
                        <p className="muted">
                          Upload a bank statement on behalf of {selectedUser.full_name.split(' ')[0]}.
                        </p>
                        {uploadResult === 'done' ? (
                          <div className="callout callout-success" style={{ marginTop: 10 }}>
                            <span className="callout-icon">✅</span>
                            <div className="callout-body">
                              Statement uploaded and analysed.
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ marginLeft: 8 }}
                                onClick={() => setUploadResult(null)}
                              >
                                Upload another
                              </button>
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
                                <select
                                  value={uploadLanguage}
                                  onChange={(e) => setUploadLanguage(e.target.value)}
                                >
                                  {LANGUAGES.map((l) => (
                                    <option key={l.value} value={l.value}>{l.label}</option>
                                  ))}
                                </select>
                              </label>
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={handleSupporterUpload}
                                disabled={!uploadFile || uploading}
                              >
                                {uploading ? 'Uploading…' : 'Upload & Analyse'}
                              </button>
                            </div>
                          </>
                        )}
                      </section>

                      {/* Chat control */}
                      <section className="supporter-care-section">
                        <h3>Chat Control</h3>
                        <div className="supporter-chat-control">
                          <p>
                            Current state:{' '}
                            <strong>{selectedDetails.chat_pause?.is_paused ? 'Paused' : 'Active'}</strong>
                          </p>
                          {selectedDetails.chat_pause?.paused_reason && (
                            <p>Reason: {selectedDetails.chat_pause.paused_reason}</p>
                          )}
                          {selectedDetails.chat_pause?.paused_at && (
                            <p>Paused at: {formatDateTime(selectedDetails.chat_pause.paused_at)}</p>
                          )}
                          <textarea
                            className="supporter-note-input"
                            value={pauseReasonText}
                            onChange={(e) => setPauseReasonText(e.target.value)}
                            placeholder="Optional reason shown to user"
                            rows={2}
                          />
                          <div className="supporter-alert-actions">
                            {!selectedDetails.chat_pause?.is_paused ? (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleToggleChatPause('pause')}
                                disabled={saving}
                              >
                                Pause chat
                              </button>
                            ) : (
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleToggleChatPause('unpause')}
                                disabled={saving}
                              >
                                Unpause chat
                              </button>
                            )}
                          </div>
                        </div>
                      </section>

                    </div>

                    <div className="supporter-care-col">

                      {/* Spending limits */}
                      <section className="supporter-care-section">
                        <h3>Spending Limits</h3>
                        <div className="supporter-limit-grid">
                          <label>
                            Daily limit
                            <input
                              type="number"
                              value={limits.daily_spend_limit}
                              onChange={(e) => setLimits((prev) => ({ ...prev, daily_spend_limit: e.target.value }))}
                            />
                          </label>
                          <label>
                            Weekly limit
                            <input
                              type="number"
                              value={limits.weekly_spend_limit}
                              onChange={(e) => setLimits((prev) => ({ ...prev, weekly_spend_limit: e.target.value }))}
                            />
                          </label>
                          <label>
                            Monthly limit
                            <input
                              type="number"
                              value={limits.monthly_spend_limit}
                              onChange={(e) => setLimits((prev) => ({ ...prev, monthly_spend_limit: e.target.value }))}
                            />
                          </label>
                          <label>
                            Min balance alert
                            <input
                              type="number"
                              value={limits.min_balance_threshold}
                              onChange={(e) => setLimits((prev) => ({ ...prev, min_balance_threshold: e.target.value }))}
                            />
                          </label>
                        </div>
                        <button className="btn btn-primary btn-sm" onClick={handleSaveLimits} disabled={saving}>
                          Save limits
                        </button>
                      </section>

                      {/* Notes */}
                      <section className="supporter-care-section">
                        <h3>Supporter Notes</h3>
                        <textarea
                          className="supporter-note-input"
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="Add guidance notes for this user…"
                          rows={4}
                        />
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={handleSaveNote}
                          disabled={saving || !noteText.trim()}
                        >
                          Save note
                        </button>
                      </section>

                    </div>
                  </div>

                  {/* Recent transactions */}
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

            </div>
          </section>

        </div>
      )}
    </div>
  )
}
