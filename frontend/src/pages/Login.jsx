import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { login as apiLogin, requestLoginAssist, verifyLoginAssist } from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(() => {
    let rememberedEmail = ''
    try {
      rememberedEmail = localStorage.getItem('lekkerfi_last_email') || ''
    } catch {}
    return { email: rememberedEmail, password: '' }
  })
  const [rememberEmail, setRememberEmail] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [speakingHelp, setSpeakingHelp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [assistEmail, setAssistEmail] = useState('')
  const [assistCode, setAssistCode] = useState('')
  const [assistTicketId, setAssistTicketId] = useState('')
  const [assistStep, setAssistStep] = useState('request')
  const [assistMessage, setAssistMessage] = useState('')
  const [assistLoading, setAssistLoading] = useState(false)

  function readLoginHelp() {
    if (!('speechSynthesis' in window)) return
    if (speakingHelp) {
      window.speechSynthesis.cancel()
      setSpeakingHelp(false)
      return
    }

    const text = 'Login help. Option 1: type your email and password, then tap Log in. Option 2: tap Need help logging in, enter your email, call your trusted supporter for the six digit code, then enter the code.'
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.92
    utterance.pitch = 1
    utterance.onend = () => setSpeakingHelp(false)
    utterance.onerror = () => setSpeakingHelp(false)

    setSpeakingHelp(true)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await apiLogin(form)
      try {
        if (rememberEmail) {
          localStorage.setItem('lekkerfi_last_email', form.email.trim())
        } else {
          localStorage.removeItem('lekkerfi_last_email')
        }
      } catch {}
      login(data.access_token, data.user)
      navigate('/home')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRequestAssist(e) {
    e.preventDefault()
    if (!assistEmail.trim()) return
    setError('')
    setAssistMessage('')
    setAssistLoading(true)
    try {
      const data = await requestLoginAssist({ email: assistEmail.trim() })
      setAssistMessage(data.message || 'If your account has a trusted supporter, they were notified.')
      if (data.ticket_id) {
        setAssistTicketId(data.ticket_id)
        setAssistStep('verify')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setAssistLoading(false)
    }
  }

  async function handleVerifyAssist(e) {
    e.preventDefault()
    if (!assistEmail.trim() || !assistTicketId || !assistCode.trim()) return
    setError('')
    setAssistLoading(true)
    try {
      const data = await verifyLoginAssist({
        email: assistEmail.trim(),
        ticket_id: assistTicketId,
        code: assistCode.trim(),
      })
      try { localStorage.setItem('lekkerfi_last_email', assistEmail.trim()) } catch {}
      login(data.access_token, data.user)
      navigate('/home')
    } catch (err) {
      setError(err.message)
    } finally {
      setAssistLoading(false)
    }
  }

  function resetAssistFlow() {
    setAssistStep('request')
    setAssistCode('')
    setAssistTicketId('')
    setAssistMessage('')
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="login-brand">
          <span className="login-brand-name">LekkerFi</span>
          <p className="auth-subtitle">Simple login. We will guide you after this.</p>
        </div>

        <section className="login-help" aria-label="Login help">
          <p className="login-help-title">How to log in</p>
          <ol className="login-help-list">
            <li>Type your email.</li>
            <li>Type your password.</li>
            <li>Tap the green Log in button.</li>
          </ol>
          <p className="login-help-tip">If you forget your password, use Trusted Supporter assist code below.</p>
          <button className="btn btn-ghost btn-sm" type="button" onClick={readLoginHelp} aria-label="Read login help out loud">
            {speakingHelp ? 'Stop reading' : 'Read this out loud'}
          </button>
        </section>

        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit} className="form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="password-row">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={form.password}
                onChange={handleChange}
                required
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="form-group remember-row">
            <label htmlFor="remember-email" className="remember-label">
              <input
                id="remember-email"
                type="checkbox"
                checked={rememberEmail}
                onChange={(e) => setRememberEmail(e.target.checked)}
              />
              Remember my email on this phone
            </label>
            <p className="remember-hint">Use this only on your own phone.</p>
          </div>
          <button className="btn btn-primary btn-full" disabled={loading} aria-label="Log in">
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <section className="assist-login" aria-label="Trusted supporter login help">
          <div className="assist-login-top">
            <p className="assist-login-title">Need help logging in?</p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setAssistOpen((prev) => !prev)
                resetAssistFlow()
                setError('')
              }}
            >
              {assistOpen ? 'Hide help' : 'Open help'}
            </button>
          </div>

          {assistOpen && (
            <>
              <p className="assist-login-copy">
                We can send a one-time 6-digit login code to your trusted supporter. Call them, then enter the code here.
              </p>

              {assistStep === 'request' && (
                <form className="assist-login-form" onSubmit={handleRequestAssist}>
                  <div className="form-group">
                    <label htmlFor="assist-email">Your email</label>
                    <input
                      id="assist-email"
                      type="email"
                      value={assistEmail}
                      onChange={(e) => setAssistEmail(e.target.value)}
                      required
                    />
                  </div>
                  <button className="btn btn-secondary btn-full" disabled={assistLoading}>
                    {assistLoading ? 'Sending code request…' : 'Send code request to supporter'}
                  </button>
                </form>
              )}

              {assistStep === 'verify' && (
                <form className="assist-login-form" onSubmit={handleVerifyAssist}>
                  <div className="form-group">
                    <label htmlFor="assist-email-verify">Your email</label>
                    <input
                      id="assist-email-verify"
                      type="email"
                      value={assistEmail}
                      onChange={(e) => setAssistEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="assist-code">6-digit code from supporter</label>
                    <input
                      id="assist-code"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={assistCode}
                      onChange={(e) => setAssistCode(e.target.value.replace(/[^0-9]/g, ''))}
                      required
                    />
                  </div>
                  <button className="btn btn-secondary btn-full" disabled={assistLoading}>
                    {assistLoading ? 'Verifying code…' : 'Log in with assist code'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-full" onClick={resetAssistFlow} disabled={assistLoading}>
                    Request a new code
                  </button>
                </form>
              )}

              {assistMessage && <p className="assist-login-note">{assistMessage}</p>}
            </>
          )}
        </section>

        <p className="auth-footer">
          Don't have an account?{' '}
          <Link to="/register">Sign up</Link>
        </p>
      </div>
    </div>
  )
}
