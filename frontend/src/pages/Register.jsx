import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { login as apiLogin, register as apiRegister } from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    email: '',
    password: '',
    access_account: '',
    user_number: '1',
    user_email: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const body = {
        ...form,
        user_email: form.user_email || form.email,
      }
      await apiRegister(body)
      // Auto-login after registration
      const data = await apiLogin({ email: form.email, password: form.password })
      login(data.access_token, data.user)
      navigate('/home')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1 className="auth-title">Create account</h1>
        <p className="auth-subtitle">Get started with LekkerFi</p>

        {error && <div className="alert alert-error">{error}</div>}

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
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="access_account">
              ABSA Account Number
              <span className="label-hint"> — your main access account</span>
            </label>
            <input
              id="access_account"
              name="access_account"
              type="text"
              placeholder="e.g. 4048195297"
              value={form.access_account}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="user_number">
                User Number
                <span className="label-hint"> — playpen default: 1</span>
              </label>
              <input
                id="user_number"
                name="user_number"
                type="text"
                value={form.user_number}
                onChange={handleChange}
              />
            </div>
            <div className="form-group">
              <label htmlFor="user_email">
                SureCheck Email
                <span className="label-hint"> — leave blank to use login email</span>
              </label>
              <input
                id="user_email"
                name="user_email"
                type="email"
                placeholder="Optional"
                value={form.user_email}
                onChange={handleChange}
              />
            </div>
          </div>

          <button className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account?{' '}
          <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  )
}
