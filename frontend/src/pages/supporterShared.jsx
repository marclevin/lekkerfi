import React from 'react'

export const LANGUAGES = [
  { value: 'xhosa', label: 'isiXhosa' },
  { value: 'zulu', label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho', label: 'Sesotho' },
  { value: 'english', label: 'English' },
]

export function formatMoney(value) {
  if (value == null || Number.isNaN(Number(value))) return 'R 0.00'
  return `R ${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDateTime(iso) {
  if (!iso) return 'Unknown'
  return new Date(iso).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function riskLabel(status) {
  if (status === 'at_risk') return 'At Risk'
  if (status === 'watch') return 'Watch'
  if (status === 'stable') return 'Stable'
  return 'No Data'
}

export function timeMs(value) {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

export function severityRank(value) {
  if (value === 'critical') return 3
  if (value === 'warning') return 2
  return 1
}

export function riskRank(value) {
  if (value === 'at_risk') return 3
  if (value === 'watch') return 2
  if (value === 'stable') return 1
  return 0
}

export function isChatAlert(alert) {
  return alert.alert_type === 'pause_prompt'
}

export function alertTypeLabel(value) {
  if (value === 'pause_prompt') return 'Chat spending review'
  if (value === 'payday_warning') return 'Payday warning'
  if (value === 'low_balance') return 'Low balance'
  if (value === 'unusual_spend') return 'Unusual spend'
  return String(value || '').replace('_', ' ')
}

export function alertTypeTone(value) {
  if (value === 'pause_prompt') return 'chat'
  return 'finance'
}

export function chatSnippet(alert) {
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

function daysSince(isoDate) {
  if (!isoDate) return null
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24))
}

export function computeUserSignals(selectedDetails) {
  const mgmt = selectedDetails.management || {}
  const transactions = selectedDetails.transactions || []

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

export function computeAggregateSignals(users, alerts = []) {
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

  const withAlerts = alerts.filter((a) => a.status !== 'dismissed').length > 0
    ? users.filter((u) => u.active_alert_count > 0).length
    : users.filter((u) => u.active_alert_count > 0).length
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
      desc: 'One user has an unresolved financial alert. Review the Alerts page.',
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

export function SignalCard({ signal }) {
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
