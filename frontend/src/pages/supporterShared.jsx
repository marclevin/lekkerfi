import React, { useState } from 'react'

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

  const spending7d = Number(mgmt.spending_7d || 0)
  const spending30d = Number(mgmt.spending_30d || 0)
  const avgDailyRaw = Number(mgmt.avg_daily_spend_30d || 0)
  const avgDaily = avgDailyRaw > 0 ? avgDailyRaw : (spending30d > 0 ? spending30d / 30 : 0)
  const expected7d = avgDaily * 7
  let velocity
  if (avgDaily === 0) {
    velocity = {
      level: 'ok',
      label: 'Spending Velocity',
      value: 'No baseline yet',
      desc: 'Upload a statement to start tracking spending pace.',
      detail: null,
    }
  } else {
    const ratio = expected7d > 0 ? spending7d / expected7d : 0
    const pct = Math.round(ratio * 100)
    const overBy = spending7d - expected7d
    const detail = [
      `7-day spend: ${formatMoney(spending7d)}`,
      `Expected (30d avg × 7): ${formatMoney(expected7d)}`,
      `Daily average (30d): ${formatMoney(avgDaily)}`,
      overBy > 0
        ? `Over baseline by ${formatMoney(overBy)} — check for large or unusual purchases`
        : `Within baseline by ${formatMoney(Math.abs(overBy))}`,
    ]
    if (ratio > 1.8) {
      velocity = {
        level: 'critical',
        label: 'Spending Velocity',
        value: `${pct}% of weekly baseline`,
        desc: `Spending ${Math.round((ratio - 1) * 100)}% faster than usual. Consider an immediate check-in.`,
        detail,
      }
    } else if (ratio > 1.3) {
      velocity = {
        level: 'warn',
        label: 'Spending Velocity',
        value: `${pct}% of weekly baseline`,
        desc: 'Pace is elevated this week. Watch for stress spending or impulse triggers.',
        detail,
      }
    } else {
      velocity = {
        level: 'ok',
        label: 'Spending Velocity',
        value: `${pct}% of weekly baseline`,
        desc: 'Spending is on track relative to the 30-day baseline.',
        detail,
      }
    }
  }

  const lastSeen = mgmt.last_login_at || mgmt.last_chat_at
  const daysInactive = daysSince(lastSeen)
  const lastLoginFormatted = lastSeen ? new Date(lastSeen).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null
  let inactivity
  if (daysInactive === null) {
    inactivity = {
      level: 'critical',
      label: 'Inactivity',
      value: 'Never logged in',
      desc: 'User has not accessed the app yet. Direct outreach recommended.',
      detail: ['No login recorded. Account may need setup help or direct contact.'],
    }
  } else if (daysInactive >= 14) {
    inactivity = {
      level: 'critical',
      label: 'Inactivity',
      value: `${daysInactive} days since login`,
      desc: 'Over two weeks without activity. Consider a welfare check.',
      detail: [
        `Last seen: ${lastLoginFormatted}`,
        `Days since last activity: ${daysInactive}`,
        'Suggested action: Direct phone or WhatsApp check-in.',
      ],
    }
  } else if (daysInactive >= 7) {
    inactivity = {
      level: 'warn',
      label: 'Inactivity',
      value: `${daysInactive} days since login`,
      desc: 'A week without activity. A short check-in message may help.',
      detail: [
        `Last seen: ${lastLoginFormatted}`,
        `Days since last activity: ${daysInactive}`,
        'Suggested action: Send a supportive nudge message.',
      ],
    }
  } else {
    inactivity = {
      level: 'ok',
      label: 'Inactivity',
      value: daysInactive === 0 ? 'Active today' : `Last seen ${daysInactive}d ago`,
      desc: 'User is regularly engaging with the app.',
      detail: [`Last seen: ${lastLoginFormatted || 'recently'}`],
    }
  }

  const now = Date.now()
  const recentTx = transactions.filter((tx) => {
    if (!tx.date) return false
    const parsed = new Date(tx.date).getTime()
    if (Number.isNaN(parsed)) return false
    return (now - parsed) / (1000 * 60 * 60 * 24) <= 7
  })
  const groups = {}
  for (const tx of recentTx) {
    const amount = Number(tx.amount || 0)
    const key = `${(tx.description || '').toLowerCase().trim().slice(0, 50)}|${Math.abs(amount).toFixed(2)}`
    if (!groups[key]) groups[key] = { count: 0, description: tx.description, amount: tx.amount }
    groups[key].count += 1
  }
  const dupEntries = Object.values(groups).filter((g) => g.count >= 2)
  const dupPairs = dupEntries.length
  const dupDetail = dupEntries.map(
    (g) => `"${g.description || 'Unknown'}" — ${formatMoney(Math.abs(g.amount))} × ${g.count}`
  )

  let duplicates
  if (dupPairs >= 3) {
    duplicates = {
      level: 'critical',
      label: 'Duplicate Payments',
      value: `${dupPairs} repeat transactions`,
      desc: 'Multiple same-amount charges found this week. Review for accidental duplicates.',
      detail: dupDetail.length ? dupDetail : null,
    }
  } else if (dupPairs >= 1) {
    duplicates = {
      level: 'warn',
      label: 'Duplicate Payments',
      value: `${dupPairs} possible repeat`,
      desc: 'A similar charge appeared more than once this week. Worth verifying.',
      detail: dupDetail.length ? dupDetail : null,
    }
  } else {
    duplicates = {
      level: 'ok',
      label: 'Duplicate Payments',
      value: 'None detected',
      desc: 'No repeated transactions found in the last 7 days.',
      detail: null,
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
  const [expanded, setExpanded] = useState(false)
  const iconMap = { ok: '✓', warn: '!', critical: '⚠' }
  const hasDetail = Array.isArray(signal.detail) && signal.detail.length > 0

  return (
    <div className={`signal-card signal-card-${signal.level}${expanded ? ' signal-card-expanded' : ''}`}>
      <div className="signal-card-header">
        <span className={`signal-card-icon signal-icon-${signal.level}`} aria-hidden="true">
          {iconMap[signal.level]}
        </span>
        <p className="signal-card-label">{signal.label}</p>
      </div>
      <p className="signal-card-value">{signal.value}</p>
      <p className="signal-card-desc">{signal.desc}</p>
      {hasDetail && (
        <button
          type="button"
          className="signal-card-expand-btn"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Hide detail ▲' : 'See detail ▼'}
        </button>
      )}
      {hasDetail && expanded && (
        <ul className="signal-card-detail" aria-label="Signal detail">
          {signal.detail.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
