import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { login as apiLogin, register as apiRegister } from '../api/client'
import { useAuth } from '../context/AuthContext'

const LANGUAGES = [
  { value: 'english',   label: 'English' },
  { value: 'xhosa',     label: 'isiXhosa' },
  { value: 'zulu',      label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho',     label: 'Sesotho' },
]

// ── Step 1: who are you? ───────────────────────────────────────────────────────

function RolePicker({ onSelect }) {
  return (
    <div className="auth-page">
      <div className="role-picker-wrap">
        <div className="role-picker-header">
          <h1 className="auth-title">Welcome to LekkerFi</h1>
          <p className="auth-subtitle">Who are you signing up as?</p>
        </div>

        <div className="role-cards">
          <button className="role-card" onClick={() => onSelect('user')}>
            <div className="role-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
            </div>
            <div className="role-card-body">
              <span className="role-card-title">I'm the account holder</span>
              <span className="role-card-desc">
                I want to manage my finances and understand my spending.
              </span>
              <ul className="role-card-features">
                <li>Connect your ABSA account</li>
                <li>Upload bank statements</li>
                <li>Chat with your finances in your language</li>
                <li>Get personalised insights and tips</li>
                <li>Invite a Trusted Supporter to help you out</li>
              </ul>
            </div>
            <div className="role-card-arrow">→</div>
          </button>

          <button className="role-card role-card-supporter" onClick={() => onSelect('supporter')}>
            <div className="role-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div className="role-card-body">
              <span className="role-card-title">I'm a Trusted Supporter</span>
              <span className="role-card-desc">
                I help someone else manage their finances — a family member, carer, or advisor.
              </span>
              <ul className="role-card-features">
                <li>Create accounts on behalf of others</li>
                <li>View their financial summaries</li>
                <li>Support multiple people</li>
              </ul>
            </div>
            <div className="role-card-arrow">→</div>
          </button>
        </div>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  )
}

// ── Step 2: basic details ──────────────────────────────────────────────────────

function DetailsForm({ role, form, onChange, onBack, onContinue, error, loading }) {
  const isSupporter = role === 'supporter'

  function handleSubmit(e) {
    e.preventDefault()
    onContinue()
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <button className="role-back-btn" onClick={onBack} type="button">← Back</button>

        <div className="role-badge-header">
          <span className={`role-badge ${isSupporter ? 'role-badge-supporter' : 'role-badge-user'}`}>
            {isSupporter ? 'Trusted Supporter' : 'Account holder'}
          </span>
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-subtitle" style={{ marginTop: 2 }}>Just the basics — you can fill in more later.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="form">
          <div className="form-group">
            <label htmlFor="full_name">Your name</label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              placeholder={isSupporter ? 'e.g. Nomsa Dlamini' : 'e.g. Thabo Nkosi'}
              value={form.full_name}
              onChange={onChange}
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={onChange}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={onChange}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="preferred_language">
              Preferred language
              <span className="label-hint"> — for insights and chat</span>
            </label>
            <select
              id="preferred_language"
              name="preferred_language"
              value={form.preferred_language}
              onChange={onChange}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          <button className="btn btn-primary btn-full" disabled={loading}>
            {isSupporter
              ? (loading ? 'Creating account…' : 'Create account')
              : 'Continue →'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  )
}

// ── Step 3: trusted supporter question (users only) ────────────────────────────

function SupporterStep({ onSkip, onBack, loading }) {
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <button className="role-back-btn" onClick={onBack} type="button">← Back</button>

        <div style={{ marginBottom: 20 }}>
          <h1 className="auth-title">Do you have a Trusted Supporter?</h1>
          <p className="auth-subtitle" style={{ marginTop: 6 }}>
            A Trusted Supporter is someone — like a family member, friend, or carer — who helps you make good decisions with your money.
          </p>
          <p className="auth-subtitle" style={{ marginTop: 6 }}>
            They won't have access to your account. They're just there to support you when you need it.
          </p>
        </div>

        <div className="supporter-step-cards">

          {/* Option 1: skip — active */}
          <button className="supporter-option-card" onClick={onSkip} disabled={loading}>
            <div className="supporter-option-icon supporter-option-icon-neutral">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </div>
            <div className="supporter-option-body">
              <span className="supporter-option-title">I don't have one right now</span>
              <span className="supporter-option-desc">That's okay! You can always add a supporter later in your profile.</span>
            </div>
            <span className="supporter-option-arrow">{loading ? '…' : '→'}</span>
          </button>

          {/* Option 2: choose existing — coming soon */}
          <div className="supporter-option-card supporter-option-card-disabled" aria-disabled="true">
            <div className="supporter-option-icon supporter-option-icon-blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div className="supporter-option-body">
              <span className="supporter-option-title">
                Choose someone I know
                <span className="supporter-coming-soon">Coming soon</span>
              </span>
              <span className="supporter-option-desc">Pick an existing LekkerFi supporter from your contacts.</span>
            </div>
          </div>

          {/* Option 3: invite — coming soon */}
          <div className="supporter-option-card supporter-option-card-disabled" aria-disabled="true">
            <div className="supporter-option-icon supporter-option-icon-green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </div>
            <div className="supporter-option-body">
              <span className="supporter-option-title">
                Invite a friend or family member
                <span className="supporter-coming-soon">Coming soon</span>
              </span>
              <span className="supporter-option-desc">Send them a link so they can sign up as your supporter.</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────

export default function Register() {
  const { login } = useAuth()
  const navigate = useNavigate()

  // 'role' | 'form' | 'supporter'
  const [step, setStep] = useState('role')
  const [role, setRole] = useState(null)
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    preferred_language: 'english',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  function handleRoleSelect(r) {
    setRole(r)
    setStep('form')
  }

  function handleFormContinue() {
    setError('')
    if (role === 'user') {
      setStep('supporter')
    } else {
      submit()
    }
  }

  async function submit() {
    setError('')
    setLoading(true)
    try {
      const body = {
        ...form,
        role,
        // ABSA details have sensible defaults; user sets them in the Connect flow
        access_account: '',
        user_number: '1',
        user_email: form.email,
      }
      await apiRegister(body)
      const data = await apiLogin({ email: form.email, password: form.password })
      login(data.access_token, data.user)
      navigate('/home')
    } catch (err) {
      setError(err.message)
      // If we're on the supporter step, surface error there by going back
      setStep('form')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'role') {
    return <RolePicker onSelect={handleRoleSelect} />
  }

  if (step === 'form') {
    return (
      <DetailsForm
        role={role}
        form={form}
        onChange={handleChange}
        onBack={() => { setStep('role'); setError('') }}
        onContinue={handleFormContinue}
        error={error}
        loading={loading}
      />
    )
  }

  // step === 'supporter' (users only)
  return (
    <SupporterStep
      onSkip={submit}
      onBack={() => setStep('form')}
      loading={loading}
    />
  )
}
