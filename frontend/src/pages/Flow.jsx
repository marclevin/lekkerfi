import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  generateInsight,
  getAccounts,
  listSurechecks,
  respondSurecheck,
  startSession,
} from '../api/client'
import { useAuth } from '../context/AuthContext'

const STEPS = ['Start Session', 'Approve SureCheck', 'Select Accounts', 'View Insight']

const LANGUAGES = [
  { value: 'xhosa', label: 'isiXhosa' },
  { value: 'zulu', label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho', label: 'Sesotho' },
  { value: 'english', label: 'English' },
]

function StepIndicator({ current }) {
  return (
    <div className="step-indicator">
      {STEPS.map((label, i) => (
        <div key={i} className={`step-item ${i === current ? 'active' : ''} ${i < current ? 'done' : ''}`}>
          <div className="step-circle">{i < current ? '✓' : i + 1}</div>
          <span className="step-label">{label}</span>
          {i < STEPS.length - 1 && <div className="step-line" />}
        </div>
      ))}
    </div>
  )
}

// ── Step 1: Start Session ─────────────────────────────────────────────────────

function StepStartSession({ onDone }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleStart() {
    setError('')
    setLoading(true)
    try {
      const data = await startSession()
      onDone(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="step-content">
      <h2>Start Consent Session</h2>
      <p className="step-desc">
        This will request a long-lived consent from ABSA for account{' '}
        <strong>{user?.access_account}</strong> and send a SureCheck to your registered email.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <button className="btn btn-primary" onClick={handleStart} disabled={loading}>
        {loading ? 'Starting…' : 'Start Session'}
      </button>
    </div>
  )
}

// ── Step 2: Approve SureCheck ─────────────────────────────────────────────────

function StepSurecheck({ sessionData, onDone }) {
  const [surechecks, setSurechecks] = useState(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingRef, setLoadingRef] = useState('')
  const [error, setError] = useState('')

  async function handleLoad() {
    setError('')
    setLoadingList(true)
    try {
      const data = await listSurechecks()
      setSurechecks(data.surechecks || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingList(false)
    }
  }

  async function handleRespond(absaRef, action) {
    setError('')
    setLoadingRef(absaRef)
    try {
      const data = await respondSurecheck(absaRef, action)
      if (data.session_status === 'active') {
        onDone()
      } else {
        setError('SureCheck was rejected. Please start a new session.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingRef('')
    }
  }

  return (
    <div className="step-content">
      <h2>Approve SureCheck</h2>
      <p className="step-desc">
        A SureCheck request was sent (reference:{' '}
        <code>{sessionData?.surecheck?.absaReference || '—'}</code>). Load your pending
        SureChecks below and accept to continue.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <button className="btn btn-secondary" onClick={handleLoad} disabled={loadingList}>
        {loadingList ? 'Loading…' : 'Load SureChecks'}
      </button>

      {surechecks !== null && (
        <div className="surecheck-list">
          {surechecks.length === 0 ? (
            <p className="empty-hint">No pending SureChecks found. Try loading again.</p>
          ) : (
            surechecks.map((sc) => (
              <div key={sc.absaReference} className="surecheck-item">
                <div className="surecheck-info">
                  <span className="surecheck-ref">{sc.absaReference}</span>
                  <span className="surecheck-type">{sc.type || sc.requestType}</span>
                  <span className={`badge badge-${sc.status?.toLowerCase()}`}>{sc.status}</span>
                </div>
                <div className="surecheck-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={loadingRef === sc.absaReference}
                    onClick={() => handleRespond(sc.absaReference, 'Accepted')}
                  >
                    {loadingRef === sc.absaReference ? '…' : 'Accept'}
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={loadingRef === sc.absaReference}
                    onClick={() => handleRespond(sc.absaReference, 'Rejected')}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Step 3: Select Accounts ───────────────────────────────────────────────────

function StepAccounts({ onDone }) {
  const [accounts, setAccounts] = useState(null)
  const [selected, setSelected] = useState([])
  const [language, setLanguage] = useState('xhosa')
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [loadingGenerate, setLoadingGenerate] = useState(false)
  const [error, setError] = useState('')

  async function handleLoad() {
    setError('')
    setLoadingAccounts(true)
    try {
      const data = await getAccounts()
      setAccounts(data.accounts || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingAccounts(false)
    }
  }

  function toggleAccount(num) {
    setSelected((prev) =>
      prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num]
    )
  }

  async function handleGenerate() {
    if (selected.length === 0) {
      setError('Select at least one account.')
      return
    }
    setError('')
    setLoadingGenerate(true)
    try {
      const data = await generateInsight(selected, language)
      onDone(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingGenerate(false)
    }
  }

  return (
    <div className="step-content">
      <h2>Select Accounts</h2>
      <p className="step-desc">
        Load your accounts, choose which ones to analyse, pick a language, then generate your
        financial insights.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <button className="btn btn-secondary" onClick={handleLoad} disabled={loadingAccounts}>
        {loadingAccounts ? 'Loading…' : 'Load Accounts'}
      </button>

      {accounts !== null && (
        <>
          {accounts.length === 0 ? (
            <p className="empty-hint">No accounts found.</p>
          ) : (
            <div className="account-list">
              {accounts.map((acc) => {
                const num = acc.accountNumber || acc.account_number
                const name = acc.accountName || acc.account_name || num
                const balance = acc.currentBalance || acc.current_balance || '—'
                const type = acc.accountType || acc.account_type || ''
                return (
                  <label key={num} className={`account-item ${selected.includes(num) ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected.includes(num)}
                      onChange={() => toggleAccount(num)}
                    />
                    <div className="account-details">
                      <span className="account-name">{name}</span>
                      <span className="account-num">{num}</span>
                      {type && <span className="account-type">{type}</span>}
                    </div>
                    <span className="account-balance">R {balance}</span>
                  </label>
                )
              })}
            </div>
          )}

          <div className="form-group generate-options">
            <label htmlFor="language">Translation language</label>
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={loadingGenerate || selected.length === 0}
          >
            {loadingGenerate
              ? 'Generating insights… (this may take a moment)'
              : `Generate Insights for ${selected.length} account${selected.length !== 1 ? 's' : ''}`}
          </button>
        </>
      )}
    </div>
  )
}

// ── Step 4: Insight Result ────────────────────────────────────────────────────

function StepInsight({ insight }) {
  const navigate = useNavigate()

  return (
    <div className="step-content">
      <h2>Your Financial Insights</h2>
      <p className="step-desc">
        Based on your last 90 days of transactions across{' '}
        <strong>{insight.accounts?.join(', ')}</strong>.
      </p>

      <div className="insight-section">
        <h3>Summary</h3>
        <div className="insight-bullets">
          {insight.simplified?.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>

      <div className="insight-section">
        <h3>
          Translated{' '}
          <span className="lang-badge">
            {LANGUAGES.find((l) => l.value === insight.language)?.label || insight.language}
          </span>
        </h3>
        <div className="insight-bullets translated">
          {insight.translated?.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>

      <div className="insight-actions">
        <button className="btn btn-secondary" onClick={() => navigate('/insights')}>
          View all insights
        </button>
        <button className="btn btn-ghost" onClick={() => window.location.reload()}>
          Start new analysis
        </button>
      </div>
    </div>
  )
}

// ── Main Flow page ─────────────────────────────────────────────────────────────

export default function Flow() {
  const [step, setStep] = useState(0)
  const [sessionData, setSessionData] = useState(null)
  const [insight, setInsight] = useState(null)

  function handleSessionDone(data) {
    setSessionData(data)
    setStep(1)
  }

  function handleSurecheckDone() {
    setStep(2)
  }

  function handleInsightDone(data) {
    setInsight(data)
    setStep(3)
  }

  return (
    <div className="page">
      <StepIndicator current={step} />
      <div className="card flow-card">
        {step === 0 && <StepStartSession onDone={handleSessionDone} />}
        {step === 1 && <StepSurecheck sessionData={sessionData} onDone={handleSurecheckDone} />}
        {step === 2 && <StepAccounts onDone={handleInsightDone} />}
        {step === 3 && insight && <StepInsight insight={insight} />}
      </div>
    </div>
  )
}
