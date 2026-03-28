import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  addSupporter, listMySuporters, listMyUsers, registerUser,
  removeSupporter, searchSupporters,
} from '../api/client'
import { useAuth } from '../context/AuthContext'

const LANGUAGES = [
  { value: 'english',   label: 'English' },
  { value: 'xhosa',     label: 'isiXhosa' },
  { value: 'zulu',      label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho',     label: 'Sesotho' },
]

function Section({ title, children }) {
  return (
    <div className="profile-section card">
      <p className="section-label">{title}</p>
      {children}
    </div>
  )
}

function Field({ label, value, hint }) {
  return (
    <div className="profile-field">
      <span className="profile-field-label">{label}</span>
      <span className="profile-field-value">{value || '—'}</span>
      {hint && <span className="profile-field-hint">{hint}</span>}
    </div>
  )
}

// ── Supporter manager (for regular users) ─────────────────────────────────────

function SupporterManager() {
  const [supporters, setSupporters] = useState(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const [showManual, setShowManual] = useState(false)
  const [manual, setManual] = useState({ display_name: '', contact: '' })
  const [addingManual, setAddingManual] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const debounceRef = useRef(null)

  useEffect(() => {
    listMySuporters()
      .then((d) => setSupporters(d.supporters || []))
      .catch(() => setSupporters([]))
  }, [])

  function handleQueryChange(e) {
    const val = e.target.value
    setQuery(val)
    setSearchResults([])
    clearTimeout(debounceRef.current)
    if (val.trim().length < 2) return
    debounceRef.current = setTimeout(() => {
      setSearching(true)
      searchSupporters(val.trim())
        .then((d) => setSearchResults(d.supporters || []))
        .catch(() => {})
        .finally(() => setSearching(false))
    }, 300)
  }

  async function handleAddRegistered(sup) {
    setError('')
    setAddingId(sup.id)
    try {
      const data = await addSupporter({ linked_supporter_id: sup.id })
      setSupporters((prev) => [...(prev || []), data.supporter])
      setQuery('')
      setSearchResults([])
      flash('Added to your Support Circle')
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingId(null)
    }
  }

  async function handleAddManual(e) {
    e.preventDefault()
    if (!manual.display_name.trim()) return
    setError('')
    setAddingManual(true)
    try {
      const data = await addSupporter({
        display_name: manual.display_name.trim(),
        contact: manual.contact.trim(),
      })
      setSupporters((prev) => [...(prev || []), data.supporter])
      setManual({ display_name: '', contact: '' })
      setShowManual(false)
      flash('Added to your Support Circle')
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingManual(false)
    }
  }

  async function handleRemove(id) {
    setError('')
    setRemovingId(id)
    try {
      await removeSupporter(id)
      setSupporters((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      setError(err.message)
    } finally {
      setRemovingId(null)
    }
  }

  function flash(msg) {
    setSuccess(msg)
    setTimeout(() => setSuccess(''), 2500)
  }

  const linkedIds = new Set((supporters || []).map((s) => s.linked_supporter_id).filter(Boolean))

  return (
    <div className="supporter-manager">
      <p className="profile-section-desc">
        Supporters are trusted people — like a family member or friend — who help you make good decisions with your money.
        They don't see your account; they're just there for you.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Search registered supporters */}
      <div className="sm-search-wrap">
        <label className="sm-search-label">Find a registered supporter</label>
        <div className="sm-search-box">
          <svg className="sm-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="sm-search-input"
            type="text"
            placeholder="Search by name or email…"
            value={query}
            onChange={handleQueryChange}
          />
          {searching && <div className="spinner sm-spinner" />}
        </div>

        {searchResults.length > 0 && (
          <div className="sm-search-results">
            {searchResults.map((r) => {
              const alreadyAdded = linkedIds.has(r.id)
              return (
                <div key={r.id} className="sm-result-item">
                  <div className="sm-result-avatar">{(r.display_name || '?')[0].toUpperCase()}</div>
                  <div className="sm-result-info">
                    <span className="sm-result-name">{r.display_name}</span>
                    <span className="sm-result-email">{r.email}</span>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={alreadyAdded || addingId === r.id}
                    onClick={() => handleAddRegistered(r)}
                  >
                    {alreadyAdded ? 'Added' : addingId === r.id ? '…' : '+ Add'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {query.length >= 2 && !searching && searchResults.length === 0 && (
          <p className="sm-no-results">No registered supporters found. Try adding someone manually below.</p>
        )}
      </div>

      {/* Current supporters */}
      {supporters === null ? (
        <div className="spinner" style={{ margin: '10px auto' }} />
      ) : supporters.length > 0 ? (
        <div className="sm-current">
          <p className="sm-current-label">Your Support Circle</p>
          {supporters.map((s) => (
            <div key={s.id} className="sm-current-item">
              <div className="managed-user-avatar" style={{ background: s.is_registered ? 'var(--blue-light)' : 'var(--gray-100)', color: s.is_registered ? 'var(--blue)' : 'var(--gray-600)' }}>
                {(s.display_name || '?')[0].toUpperCase()}
              </div>
              <div className="managed-user-info">
                <span className="managed-user-name">
                  {s.display_name}
                  {s.is_registered && <span className="sc-reg-badge" style={{ marginLeft: 6 }}>Registered</span>}
                </span>
                {s.contact && <span className="managed-user-email">{s.contact}</span>}
              </div>
              <button
                className="sm-remove-btn"
                onClick={() => handleRemove(s.id)}
                disabled={removingId === s.id}
                title="Remove supporter"
              >
                {removingId === s.id ? '…' : '✕'}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Manual add */}
      {!showManual ? (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setShowManual(true)}>
          + Add someone manually (name + contact)
        </button>
      ) : (
        <form className="supporter-add-form" onSubmit={handleAddManual}>
          <p className="supporter-add-title">Add someone manually</p>
          <p style={{ fontSize: '0.82rem', color: 'var(--gray-600)', marginBottom: 8 }}>
            They don't need a LekkerFi account. You can reach them via phone or email instead.
          </p>
          <div className="form-group">
            <label htmlFor="man-name">Their name</label>
            <input
              id="man-name"
              className="input"
              type="text"
              placeholder="e.g. Mom, Thabo, Pastor Dube"
              value={manual.display_name}
              onChange={(e) => setManual((m) => ({ ...m, display_name: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="man-contact">Phone or email (optional)</label>
            <input
              id="man-contact"
              className="input"
              type="text"
              placeholder="+27 82 123 4567 or name@email.com"
              value={manual.contact}
              onChange={(e) => setManual((m) => ({ ...m, contact: e.target.value }))}
            />
          </div>
          <div className="profile-form-actions">
            <button className="btn btn-primary" type="submit" disabled={addingManual}>
              {addingManual ? 'Adding…' : 'Add supporter'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => { setShowManual(false); setError('') }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Supporter: managed users list + add form ───────────────────────────────────

function SupporterSection() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    access_account: '',
    preferred_language: user?.preferred_language || 'english',
  })
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState('')

  useEffect(() => {
    listMyUsers()
      .then((d) => setUsers(d.users || []))
      .catch(() => {})
      .finally(() => setLoadingUsers(false))
  }, [])

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleAdd(e) {
    e.preventDefault()
    setAddError('')
    setAddSuccess('')
    setAdding(true)
    try {
      const data = await registerUser(form)
      setUsers((prev) => [data.user, ...prev])
      setAddSuccess(`Account created for ${data.user.full_name || data.user.email}`)
      setForm({ full_name: '', email: '', password: '', access_account: '', preferred_language: user?.preferred_language || 'english' })
      setShowForm(false)
      setTimeout(() => setAddSuccess(''), 3000)
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <Section title="Managed users">
      <p className="profile-section-desc">
        These are the people whose accounts you manage. You can create a new account on their behalf below.
      </p>

      {addSuccess && <div className="alert alert-success">{addSuccess}</div>}

      {loadingUsers ? (
        <div className="spinner" style={{ margin: '12px auto' }} />
      ) : users.length === 0 ? (
        <p className="profile-empty-msg">No managed users yet.</p>
      ) : (
        <div className="managed-users-list">
          {users.map((u) => (
            <div key={u.id} className="managed-user-item">
              <div className="managed-user-avatar">
                {(u.full_name || u.email)[0].toUpperCase()}
              </div>
              <div className="managed-user-info">
                <span className="managed-user-name">{u.full_name || u.email.split('@')[0]}</span>
                <span className="managed-user-email">{u.email}</span>
              </div>
              <span className="managed-user-lang">{u.preferred_language}</span>
            </div>
          ))}
        </div>
      )}

      {!showForm ? (
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => setShowForm(true)}>
          + Add user
        </button>
      ) : (
        <form className="supporter-add-form" onSubmit={handleAdd}>
          <p className="supporter-add-title">Create account for someone</p>
          {addError && <div className="alert alert-error">{addError}</div>}
          <div className="form-group">
            <label htmlFor="su-name">Their name</label>
            <input id="su-name" name="full_name" className="input" type="text" placeholder="e.g. Thabo Nkosi" value={form.full_name} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label htmlFor="su-email">Their email</label>
            <input id="su-email" name="email" className="input" type="email" value={form.email} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="su-password">Set a password for them</label>
            <input id="su-password" name="password" className="input" type="password" value={form.password} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="su-account">Their ABSA account number</label>
            <input id="su-account" name="access_account" className="input" type="text" placeholder="e.g. 4048195297" value={form.access_account} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label htmlFor="su-lang">Preferred language</label>
            <select id="su-lang" name="preferred_language" value={form.preferred_language} onChange={handleChange}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          <div className="profile-form-actions">
            <button className="btn btn-primary" type="submit" disabled={adding}>{adding ? 'Creating…' : 'Create account'}</button>
            <button className="btn btn-ghost" type="button" onClick={() => { setShowForm(false); setAddError('') }}>Cancel</button>
          </div>
        </form>
      )}
    </Section>
  )
}

// ── Main profile page ──────────────────────────────────────────────────────────

export default function Profile() {
  const { user, saveProfile, logout } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [preferredLanguage, setPreferredLanguage] = useState('english')
  const [accessAccount, setAccessAccount] = useState('')
  const [userNumber, setUserNumber] = useState('1')
  const [userEmail, setUserEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setFullName(user?.full_name || '')
    setPreferredLanguage(user?.preferred_language || 'english')
    setAccessAccount(user?.access_account || '')
    setUserNumber(user?.user_number || '1')
    setUserEmail(user?.user_email || '')
  }, [user?.full_name, user?.preferred_language, user?.access_account, user?.user_number, user?.user_email])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      await saveProfile({
        full_name: fullName,
        preferred_language: preferredLanguage,
        access_account: accessAccount,
        user_number: userNumber || '1',
        user_email: userEmail,
      })
      try { localStorage.setItem('lekkerfi_chat_lang', preferredLanguage) } catch {}
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message || 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const displayName = user?.full_name || user?.email?.split('@')[0] || 'Profile'
  const initials = displayName[0]?.toUpperCase() ?? '?'
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
    : null
  const isSupporter = user?.role === 'supporter'

  return (
    <div className="page profile-page">
      <div className="profile-hero">
        <div className="profile-avatar-lg">{initials}</div>
        <div className="profile-hero-text">
          <h1 className="profile-name">{displayName}</h1>
          <div className="profile-hero-meta">
            {isSupporter && <span className="role-badge role-badge-supporter">Trusted Supporter</span>}
            {memberSince && <p className="profile-since">Member since {memberSince}</p>}
          </div>
        </div>
      </div>

      {/* ── Account info ── */}
      <Section title="Account">
        <Field label="Email" value={user?.email} hint="Cannot be changed" />
      </Section>

      {/* ── Personal info + ABSA details ── */}
      <Section title="Personal info">
        <form className="profile-form" onSubmit={handleSave}>
          <div className="form-group">
            <label htmlFor="full-name">Full name</label>
            <input
              id="full-name"
              className="input"
              type="text"
              placeholder="Your name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          {!isSupporter && (
            <>
              <p className="profile-section-subhead">ABSA account details</p>
              <div className="form-group">
                <label htmlFor="access-account">
                  Access account number
                  <span className="label-hint"> — your primary ABSA account</span>
                </label>
                <input
                  id="access-account"
                  className="input"
                  type="text"
                  placeholder="e.g. 4048195297"
                  value={accessAccount}
                  onChange={(e) => setAccessAccount(e.target.value)}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="user-number">
                    User number
                    <span className="label-hint"> — usually 1</span>
                  </label>
                  <input
                    id="user-number"
                    className="input"
                    type="text"
                    placeholder="1"
                    value={userNumber}
                    onChange={(e) => setUserNumber(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="user-email">
                    SureCheck email
                    <span className="label-hint"> — leave blank to use login email</span>
                  </label>
                  <input
                    id="user-email"
                    className="input"
                    type="email"
                    placeholder="Optional"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div className="form-group">
            <label htmlFor="preferred-language">Preferred language</label>
            <select
              id="preferred-language"
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="profile-form-actions">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {saved && <span className="profile-saved-msg">Saved</span>}
          </div>
        </form>
      </Section>

      {/* ── Support Circle (regular users only) ── */}
      {!isSupporter && (
        <Section title="Support Circle">
          <SupporterManager />
        </Section>
      )}

      {/* ── Supporter: managed users ── */}
      {isSupporter && <SupporterSection />}

      {/* ── Session ── */}
      <Section title="Session">
        <p className="profile-section-desc">Signing out will clear your session on this device.</p>
        <button className="btn btn-danger" onClick={handleLogout}>
          Sign out
        </button>
      </Section>
    </div>
  )
}
