import { useEffect, useState } from 'react'
import { listMySuporters } from '../api/client'

function fmt(value) {
  if (value == null) return 'Not set'
  return `R ${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function LimitRow({ label, value }) {
  const isSet = value != null
  return (
    <div className="spending-limit-row">
      <span className="spending-limit-label">{label}</span>
      <span className={`spending-limit-value${isSet ? ' spending-limit-set' : ' spending-limit-unset'}`}>
        {fmt(value)}
      </span>
    </div>
  )
}

export default function SpendingLimits() {
  const [supporters, setSupporters] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listMySuporters()
      .then((d) => setSupporters(d.supporters || []))
      .catch((e) => setError(e.message))
  }, [])

  const supportersWithLimits = (supporters || []).filter(
    (s) => s.spending_limit != null && s.is_registered,
  )

  return (
    <div className="page">
      <div className="page-header">
        <h1>Spending Limits</h1>
        <p>Limits set by your trusted supporters to help you stay on track.</p>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {!supporters && !error && (
        <div className="page-center" style={{ minHeight: 120 }}>
          <span className="spinner" />
        </div>
      )}

      {supporters && supportersWithLimits.length === 0 && (
        <div className="card empty-state">
          <p style={{ fontSize: '2rem', marginBottom: 8 }}>🛡️</p>
          <p>No spending limits have been set for you yet.</p>
          <p className="muted" style={{ marginTop: 4 }}>
            Your trusted supporter can set daily, weekly, and monthly limits to help you manage your money.
          </p>
        </div>
      )}

      {supportersWithLimits.map((s) => {
        const lim = s.spending_limit
        return (
          <div key={s.id} className="card spending-limit-card">
            <div className="spending-limit-header">
              <span className="spending-limit-supporter-icon" aria-hidden="true">🤝</span>
              <div>
                <p className="spending-limit-supporter-name">{s.display_name}</p>
                <p className="spending-limit-supporter-label">Set by your supporter</p>
              </div>
            </div>
            <div className="spending-limit-rows">
              <LimitRow label="Daily limit" value={lim.daily_spend_limit} />
              <LimitRow label="Weekly limit" value={lim.weekly_spend_limit} />
              <LimitRow label="Monthly limit" value={lim.monthly_spend_limit} />
              <LimitRow label="Low balance alert" value={lim.min_balance_threshold} />
            </div>
            <p className="spending-limit-footer">
              Last updated {new Date(lim.updated_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        )
      })}
    </div>
  )
}
