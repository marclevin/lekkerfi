import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  connectAbsaAccounts,
  generateInsight,
  getAccounts,
  listSurechecks,
  respondSurecheck,
  startSession,
} from '../api/client'
import { useAuth } from '../context/AuthContext'
import { readStoredBoolean, subscribeCalmModeChanges, CALM_MODE_KEY } from '../utils/calmMode'
import {
  friendlyAccountList,
  maskAccountReference,
  readAccountTags,
} from '../utils/accountTags'

const STEPS = ['Your details', 'Connect bank', 'Approve', 'Choose account', 'Summary']

const LANGUAGES = [
  { value: 'xhosa',     label: 'isiXhosa' },
  { value: 'zulu',      label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho',     label: 'Sesotho' },
  { value: 'english',   label: 'English' },
]

function normalizeLanguage(value) {
  const candidate = String(value || '').toLowerCase()
  return LANGUAGES.some((l) => l.value === candidate) ? candidate : 'english'
}

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

// ── Step 0: Account Details ──────────────────────────────────────────────────────

function StepAccountDetails({ onDone }) {
  const { user, saveProfile } = useAuth()
  const [accessAccount, setAccessAccount] = useState(user?.access_account || '')
  const [userNumber, setUserNumber] = useState(user?.user_number || '1')
  const [email, setEmail] = useState(user?.user_email || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!accessAccount.trim()) {
      setError('Access account number is required.')
      return
    }
    setError('')
    setSaving(true)
    try {
      await saveProfile({
        access_account: accessAccount.trim(),
        user_number: userNumber.trim() || '1',
        user_email: email.trim() || undefined,
      })
      onDone({
        access_account: accessAccount.trim(),
        user_number: userNumber.trim() || '1',
        user_email: email.trim(),
      })
    } catch (err) {
      setError(err.message || 'Failed to save account details.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="step-content" aria-live="polite">
      <h2>Your Account Details</h2>
      <p className="step-desc">
        Check these details so we can connect your ABSA account.
      </p>

      <div className="callout callout-info">
        <span className="callout-icon">ℹ️</span>
        <div className="callout-body">
          <strong>Common defaults are pre-filled.</strong> If your details are different, please update them below.
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }} aria-describedby="account-details-help">
        <p id="account-details-help" className="sr-only">Complete account number, user number, and optional email to continue.</p>
        <div className="form-group">
          <label htmlFor="accessAccount">Access Account Number</label>
          <input
            id="accessAccount"
            className="input"
            type="text"
            placeholder="e.g., 4048195297"
            value={accessAccount}
            onChange={(e) => setAccessAccount(e.target.value)}
            required
          />
          <small style={{ color: 'var(--gray-400)' }}>Your primary ABSA account number</small>
        </div>

        <div className="form-group">
          <label htmlFor="userNumber">User Number</label>
          <input
            id="userNumber"
            className="input"
            type="text"
            placeholder="e.g., 1"
            value={userNumber}
            onChange={(e) => setUserNumber(e.target.value)}
            required
          />
          <small style={{ color: 'var(--gray-400)' }}>Your ABSA user number (usually 1)</small>
        </div>

        <div className="form-group">
          <label htmlFor="userEmail">Registered Email (optional)</label>
          <input
            id="userEmail"
            className="input"
            type="email"
            placeholder="your.email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <small style={{ color: 'var(--gray-400)' }}>Email where ABSA SureCheck notifications will arrive</small>
        </div>

        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}

// ── Step 1: Start Session ─────────────────────────────────────────────────────

function StepStartSession({ accountDetails, onDone }) {
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
    <div className="step-content" aria-live="polite">
      <h2>Start Consent Session</h2>
      <p className="step-desc">
        Start a secure ABSA connection so LekkerFi can read your transactions.
      </p>

      <div className="callout callout-info">
        <span className="callout-icon">🔒</span>
        <div className="callout-body">
          <strong>What happens next:</strong>
          <p>ABSA will send a <strong>SureCheck</strong> notification to your device for account <strong>{accountDetails?.access_account || '—'}</strong>. You'll need to approve it in the next step.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <button className="btn btn-primary" onClick={handleStart} disabled={loading}>
        {loading ? 'Starting…' : 'Start Session'}
      </button>
    </div>
  )
}

// ── Step 2: Approve SureCheck ─────────────────────────────────────────────────

const STATUS_BADGE = {
  Accepted:   'badge-accepted',
  Rejected:   'badge-rejected',
  Unaccepted: 'badge-pending',
}
const STATUS_LABEL = {
  Accepted:   'Accepted',
  Rejected:   'Rejected',
  Unaccepted: 'Sent',
}

function StepSurecheck({ sessionData, onDone }) {
  const [surechecks, setSurechecks] = useState(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingRef, setLoadingRef] = useState('')
  const [error, setError] = useState('')
  const [serverMessage, setServerMessage] = useState('')
  const [readyToContinue, setReadyToContinue] = useState(false)

  useEffect(() => {
    handleLoad()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleLoad() {
    setError('')
    setLoadingList(true)
    try {
      const data = await listSurechecks()
      setServerMessage(data.message || '')
      setReadyToContinue(Boolean(data.ready_to_continue))
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
        // Rejected — refresh to show updated status
        await handleLoad()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingRef('')
    }
  }

  return (
    <div className="step-content" aria-live="polite">
      <h2>Approve SureCheck</h2>
      <p className="step-desc">
        Approve the SureCheck from ABSA to continue.
      </p>

      {sessionData?.surecheck?.absaReference && (
        <div className="callout callout-tip">
          <span className="callout-icon">📨</span>
          <div className="callout-body">
            SureCheck <code>{sessionData.surecheck.absaReference}</code> sent
            {sessionData.surecheck.sent_to ? <> to <strong>{sessionData.surecheck.sent_to}</strong></> : ' to your registered ABSA contact'}.
          </div>
        </div>
      )}

      {readyToContinue && (
        <div className="callout callout-success" style={{ marginTop: '0.75rem' }}>
          <span className="callout-icon">✅</span>
          <div className="callout-body" style={{ display: 'grid', gap: '0.6rem' }}>
            <strong>{serverMessage || 'Consent active.'}</strong>
            <button className="btn btn-primary btn-sm" onClick={onDone}>Continue to Accounts</button>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error" role="alert" style={{ marginTop: '0.75rem' }}>{error}</div>}

      {!readyToContinue && (
        <>
          <button
            className="btn btn-secondary"
            onClick={handleLoad}
            disabled={loadingList}
            style={{ marginTop: '0.75rem' }}
          >
            {loadingList ? 'Refreshing…' : 'Refresh'}
          </button>

          {surechecks !== null && (
            <div className="surecheck-list">
              {surechecks.length === 0 ? (
                <div className="callout callout-tip">
                  <span className="callout-icon">⏳</span>
                  <div className="callout-body">No SureChecks found yet. Refresh in a few seconds.</div>
                </div>
              ) : (() => {
                // Only show Sent (Unaccepted) and Accepted; hide Rejected
                const visible = surechecks.filter((sc) => sc.status === 'Unaccepted' || sc.status === 'Accepted')
                // If multiple Sent, keep only the most recent one
                const sentItems = visible.filter((sc) => sc.status === 'Unaccepted')
                const acceptedItems = visible.filter((sc) => sc.status === 'Accepted')
                const displayList = [...(sentItems.length > 0 ? [sentItems[0]] : []), ...acceptedItems]

                if (displayList.length === 0) {
                  return (
                    <div className="callout callout-tip">
                      <span className="callout-icon">⏳</span>
                      <div className="callout-body">No SureChecks found yet. Refresh in a few seconds.</div>
                    </div>
                  )
                }

                return displayList.map((sc) => (
                  <div key={sc.absaReference} className="surecheck-item">
                    <div className="surecheck-info">
                      <span className="surecheck-ref">{sc.absaReference}</span>
                      <span className="surecheck-type">{sc.type || sc.requestType || 'Long-term'}</span>
                      <span className={`badge ${STATUS_BADGE[sc.status] || 'badge-pending'}`}>
                        {STATUS_LABEL[sc.status] || sc.status}
                      </span>
                    </div>
                    <div className="surecheck-actions">
                      {sc.status === 'Unaccepted' && (
                        <>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={!!loadingRef}
                            onClick={() => handleRespond(sc.absaReference, 'Accepted')}
                          >
                            {loadingRef === sc.absaReference ? '…' : 'Accept'}
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={!!loadingRef}
                            onClick={() => handleRespond(sc.absaReference, 'Rejected')}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              })()}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Step 3: Select Accounts ───────────────────────────────────────────────────

const DEMO_ACCOUNT_ALLOWLIST = new Set(['4048195297', '4048223317'])

function parseBalanceForDisplay(raw) {
  if (raw == null || raw === '' || raw === '—') return null

  const text = String(raw).trim()
  if (!text || text === '—') return null

  const clean = text.replace(/[R\s,]/g, '')
  const parsed = Number.parseFloat(clean)
  if (Number.isNaN(parsed)) return null

  // ABSA demo payloads can send integer minor units (cents), e.g. 2927040 => 29270.40.
  const hasExplicitDecimal = clean.includes('.')
  if (!hasExplicitDecimal && Number.isInteger(parsed)) {
    return parsed / 100
  }

  return parsed
}

function fmtBalance(raw) {
  const amount = parseBalanceForDisplay(raw)
  if (amount == null) return '—'
  return `R\u00A0${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function StepAccounts({ onDone }) {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState(null)
  const [selected, setSelected] = useState([])
  const [language] = useState(() => normalizeLanguage(user?.preferred_language))
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [loadingGenerate, setLoadingGenerate] = useState(false)
  const [error, setError] = useState('')

  async function handleLoad() {
    setError('')
    setLoadingAccounts(true)
    try {
      const data = await getAccounts()
      const nextAccounts = (data.accounts || []).filter((acc) => {
        const accountNumber = String(acc.accountNumber || acc.account_number || '').trim()
        return DEMO_ACCOUNT_ALLOWLIST.has(accountNumber)
      })
      setAccounts(nextAccounts)
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
      await connectAbsaAccounts(selected)
      onDone({
        selectedAccounts: selected,
        accountObjects: accounts.filter((acc) => selected.includes(String(acc.accountNumber || acc.account_number || '').trim())),
        connectedAt: new Date().toISOString(),
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingGenerate(false)
    }
  }

  return (
    <div className="step-content" aria-live="polite">
      <h2>Pick your money source</h2>
      <p className="step-desc">
        Choose which account to connect. We use the bank-provided account names automatically.
      </p>

      <div className="callout callout-info">
        <span className="callout-icon">📊</span>
        <div className="callout-body">
          <strong>What happens next:</strong> We will securely connect the selected account(s) and save recent transaction history so your dashboard can use it.
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <button className="btn btn-secondary" onClick={handleLoad} disabled={loadingAccounts}>
        {loadingAccounts ? 'Loading…' : 'Load Accounts'}
      </button>

      {accounts !== null && (
        <>
          {accounts.length === 0 ? (
            <p className="empty-hint">No accounts found.</p>
          ) : (
            <div className="account-list">
              {accounts.map((acc, index) => {
                const num = String(acc.accountNumber || acc.account_number || '').trim()
                const accountName = String(
                  acc.accountName || acc.productName || acc.name || acc.accountType || acc.account_type || 'Account'
                ).trim()
                const balance = acc.currentBalance || acc.current_balance || '—'
                const type = acc.accountType || acc.account_type || ''
                return (
                  <div
                    key={num || `account-${index}`}
                    className={`account-item ${selected.includes(num) ? 'selected' : ''}`}
                    role="checkbox"
                    aria-checked={selected.includes(num)}
                    tabIndex={0}
                    onClick={() => toggleAccount(num)}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault()
                        toggleAccount(num)
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(num)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleAccount(num)}
                      aria-label={`Use ${accountName} for summary`}
                    />
                    <div className="account-details">
                      <span className="account-tag-label">Account name</span>
                      <span className="account-name">{accountName}</span>
                      <span className="account-num">{maskAccountReference(num)}</span>
                      {type && <span className="account-type">{type}</span>}
                    </div>
                    <span className="account-balance">{fmtBalance(balance)}</span>
                  </div>
                )
              })}
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={loadingGenerate || selected.length === 0}
          >
            {loadingGenerate
              ? 'Connecting selected accounts…'
              : 'Connect selected'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Step 4: Insight Result ────────────────────────────────────────────────────

function StepInsight({ selectedAccounts, accountObjects = [] }) {
  const navigate = useNavigate()
  const accountTags = readAccountTags()

  // Display exact ABSA account names from the account objects if available, otherwise fall back to friendly names
  const displayNames = accountObjects.length > 0
    ? accountObjects.map((acc) => String(acc.accountName || acc.productName || acc.name || acc.accountType || acc.account_type || 'Account').trim()).join(', ')
    : friendlyAccountList(selectedAccounts, accountTags, ', ')

  return (
    <div className="step-content" aria-live="polite">
      <h2>Accounts connected</h2>
      <p className="step-desc">
        Your selected money source is now connected:{' '}
        <strong>{displayNames}</strong>.
      </p>

      <div className="callout callout-success">
        <span className="callout-icon">✅</span>
        <div className="callout-body">
          Connection complete. Recent transaction history has been saved and is ready for your dashboard features.
        </div>
      </div>

      <div className="insight-actions">
        <button className="btn btn-primary" onClick={() => navigate('/home')}>
          View Dashboard
        </button>
        <button className="btn btn-secondary" onClick={() => navigate('/insights')}>
          View all insights
        </button>
      </div>
    </div>
  )
}

// ── Main Flow page ─────────────────────────────────────────────────────────────

export default function Flow() {
  const [step, setStep] = useState(0)
  const [accountDetails, setAccountDetails] = useState(null)
  const [sessionData, setSessionData] = useState(null)
  const [connectedAccounts, setConnectedAccounts] = useState([])
  const [flowMessage, setFlowMessage] = useState('')
  const [calmMode, setCalmMode] = useState(() => readStoredBoolean(CALM_MODE_KEY, false))

  useEffect(() => {
    return subscribeCalmModeChanges((snapshot) => {
      const active = snapshot.override ? snapshot.manual : (snapshot.manual || snapshot.auto)
      setCalmMode(Boolean(active))
    })
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title-with-icon">
          <span className="page-title-icon" aria-hidden="true">🏦</span>
          Connect ABSA account
        </h1>
        <p>Follow these simple steps to connect your bank and get a clear money summary.</p>
      </div>

      {!calmMode && <StepIndicator current={step} />}
      {!calmMode && flowMessage && (
        <div className="callout callout-success" style={{ margin: '0.9rem 0' }} role="status" aria-live="polite">
          <span className="callout-icon">✅</span>
          <div className="callout-body">{flowMessage}</div>
        </div>
      )}
      <div className="card flow-card">
        {step === 0 && (
          <StepAccountDetails
            onDone={(details) => {
              setAccountDetails(details)
              setStep(1)
            }}
          />
        )}
        {step === 1 && (
          <StepStartSession
            accountDetails={accountDetails}
            onDone={(data) => {
              setSessionData(data)
              if (data?.already_active) {
                setFlowMessage(data?.message || "You're good. Long-lived consent is active.")
                setStep(3)
                return
              }
              setFlowMessage('')
              setStep(2)
            }}
          />
        )}
        {step === 2 && <StepSurecheck sessionData={sessionData} onDone={() => setStep(3)} />}
        {step === 3 && <StepAccounts onDone={(data) => { setConnectedAccounts(data); setStep(4) }} />}
        {step === 4 && <StepInsight selectedAccounts={connectedAccounts.selectedAccounts || []} accountObjects={connectedAccounts.accountObjects || []} />}
      </div>
    </div>
  )
}
