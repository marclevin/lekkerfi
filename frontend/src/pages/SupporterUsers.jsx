import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getSupporterDashboardUsers, searchUsersForSupporter, sendLinkRequest } from '../api/client'
import { formatDateTime, formatMoney, riskLabel, riskRank, timeMs } from './supporterShared'

function AddExistingUser() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [sending, setSending] = useState(null)
  const [feedback, setFeedback] = useState('')
  const debounceRef = useRef(null)

  function handleQueryChange(e) {
    const q = e.target.value
    setQuery(q)
    setFeedback('')
    clearTimeout(debounceRef.current)
    if (q.trim().length < 3) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await searchUsersForSupporter(q.trim())
        setResults(data.users || [])
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 400)
  }

  async function handleRequest(user) {
    setSending(user.id)
    setFeedback('')
    try {
      const data = await sendLinkRequest(user.id)
      setFeedback(data.message || 'Request sent!')
      setResults([])
      setQuery('')
    } catch (e) {
      setFeedback(e.message || 'Could not send request.')
    } finally {
      setSending(null)
    }
  }

  return (
    <div className="card add-existing-user-card">
      <div className="add-user-head">
        <h3>Add an existing user</h3>
        <span className="status-badge status-info">Invite flow</span>
      </div>
      <p className="muted">Search by name or email. They will receive a notification to approve.</p>
      <div className="add-user-search-row">
        <input
          className="input"
          type="search"
          placeholder="Search name or email…"
          value={query}
          onChange={handleQueryChange}
          aria-label="Search for a user to add"
        />
        {searching && <span className="spinner" style={{ marginLeft: 8 }} />}
      </div>
      {feedback && <p className="add-user-feedback">{feedback}</p>}
      {results.length > 0 && (
        <ul className="add-user-results">
          {results.map((u) => (
            <li key={u.id} className="add-user-result-row">
              <div>
                <strong>{u.display_name}</strong>
                <span className="add-user-email">{u.email}</span>
              </div>
              {u.already_linked ? (
                <span className="status-badge status-stable">Linked</span>
              ) : (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleRequest(u)}
                  disabled={sending === u.id}
                >
                  {sending === u.id ? 'Sending…' : 'Send request'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function SupporterUsers() {
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchUsers = useCallback(async () => {
    const data = await getSupporterDashboardUsers()
    setUsers(data.users || [])
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchUsers()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [fetchUsers])

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

  return (
    <div className="page supporter-dashboard-page">
      <div className="page-header supporter-header">
        <h1>Manage Users</h1>
        <p>Select a person to open their dedicated care page.</p>
      </div>

      <nav className="supporter-page-nav" aria-label="Supporter sections">
        <Link className="supporter-page-link" to="/supporter">Overview</Link>
        <Link className="supporter-page-link active" to="/supporter/users" aria-current="page">Manage users</Link>
        <Link className="supporter-page-link" to="/supporter/alerts">Alerts</Link>
      </nav>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="page-center"><span className="spinner" /></div>
      ) : (
        <div className="supporter-user-list-page">
          <div className="supporter-side-top">
            <h2>My Users</h2>
            <span className="status-badge status-selected">{sortedUsers.length} linked</span>
          </div>
          <AddExistingUser />

          {sortedUsers.length === 0 && (
            <div className="card empty-state">
              <p>No linked users yet. Go to Profile to add someone.</p>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/profile')}>Go to profile</button>
            </div>
          )}

          <div className="supporter-user-cards-grid">
            {sortedUsers.map((user) => (
              <Link
                key={user.id}
                to={`/supporter/users/${user.id}`}
                className="supporter-user-card-link card"
                aria-label={`Open care page for ${user.full_name}`}
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
                <span className="supporter-user-open-hint">Open care page →</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
