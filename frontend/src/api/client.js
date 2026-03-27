const BASE = '/api'

function getToken() {
  return localStorage.getItem('token')
}

async function request(path, options = {}) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return data
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function register(body) {
  return request('/auth/register', { method: 'POST', body: JSON.stringify(body) })
}

export function login(body) {
  return request('/auth/login', { method: 'POST', body: JSON.stringify(body) })
}

export function getMe() {
  return request('/auth/me')
}

// ── ABSA flow ─────────────────────────────────────────────────────────────────

export function startSession() {
  return request('/absa/session/start', { method: 'POST' })
}

export function listSurechecks() {
  return request('/absa/surechecks')
}

export function respondSurecheck(absa_reference, action) {
  return request('/absa/surechecks/respond', {
    method: 'POST',
    body: JSON.stringify({ absa_reference, action }),
  })
}

export function getAccounts() {
  return request('/absa/accounts')
}

// ── Insights ──────────────────────────────────────────────────────────────────

export function generateInsight(selected_accounts, language) {
  return request('/insights/generate', {
    method: 'POST',
    body: JSON.stringify({ selected_accounts, language }),
  })
}

export function listInsights() {
  return request('/insights/')
}

export function getInsight(id) {
  return request(`/insights/${id}`)
}

export function translateInsight(id, language) {
  return request(`/insights/${id}/translate`, {
    method: 'POST',
    body: JSON.stringify({ language }),
  })
}
