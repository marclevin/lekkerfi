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
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    err.data = data
    throw err
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

export function requestLoginAssist(body) {
  return request('/auth/login-assist/request', { method: 'POST', body: JSON.stringify(body) })
}

export function verifyLoginAssist(body) {
  return request('/auth/login-assist/verify', { method: 'POST', body: JSON.stringify(body) })
}

export function getMe() {
  return request('/auth/me')
}

export function updateMe(body) {
  return request('/auth/me', { method: 'PUT', body: JSON.stringify(body) })
}

export function registerUser(body) {
  return request('/auth/register-user', { method: 'POST', body: JSON.stringify(body) })
}

export function listMyUsers() {
  return request('/auth/my-users')
}

// ── Supporters ────────────────────────────────────────────────────────────────

export function searchSupporters(q) {
  return request(`/supporters/search?q=${encodeURIComponent(q)}`)
}

export function searchUsersForSupporter(q) {
  return request(`/supporters/search-users?q=${encodeURIComponent(q)}`)
}

export function sendLinkRequest(userId) {
  return request('/supporters/link-requests', { method: 'POST', body: JSON.stringify({ user_id: userId }) })
}

export function getIncomingLinkRequests() {
  return request('/supporters/link-requests/incoming')
}

export function respondLinkRequest(requestId, action) {
  return request(`/supporters/link-requests/${requestId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}

export function listMySuporters() {
  return request('/supporters/mine')
}

export function addSupporter(body) {
  return request('/supporters/mine', { method: 'POST', body: JSON.stringify(body) })
}

export function removeSupporter(id) {
  return request(`/supporters/mine/${id}`, { method: 'DELETE' })
}

export function getNotifications() {
  return request('/supporters/notifications')
}

export function sendNotification(toUserId, message) {
  return request('/supporters/notifications', {
    method: 'POST',
    body: JSON.stringify({ to_user_id: toUserId, message }),
  })
}

export function markNotificationRead(notifId) {
  return request(`/supporters/notifications/${notifId}/read`, { method: 'PUT' })
}

export function getSupporterDashboardAlerts({ limit = 50, offset = 0, userId = null } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (userId != null) params.set('user_id', String(userId))
  return request(`/supporters/dashboard/alerts?${params.toString()}`)
}

export function getSupporterDashboardUsers() {
  return request('/supporters/dashboard/users')
}

export function getSupporterUserDetails(userId) {
  return request(`/supporters/dashboard/users/${userId}/details`)
}

export function getUserFinanceChat(userId) {
  return request(`/supporters/dashboard/users/${userId}/finance-chat`)
}

export function injectSupporterMessage(userId, message) {
  return request(`/supporters/dashboard/users/${userId}/finance-chat/inject`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}

export function dismissSupporterAlert(alertId) {
  return request(`/supporters/dashboard/alerts/${alertId}/dismiss`, { method: 'PUT' })
}

export function markSupporterAlertRead(alertId) {
  return request(`/supporters/dashboard/alerts/${alertId}/read`, { method: 'PUT' })
}

export function decideSupporterAlert(alertId, decision, note = '') {
  return request(`/supporters/dashboard/alerts/${alertId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, note }),
  })
}

export function setSupporterUserChatPause(userId, action, reason = '') {
  return request(`/supporters/dashboard/users/${userId}/chat-pause`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  })
}

export function upsertUserSpendingLimit(body) {
  return request('/supporters/dashboard/spending-limit', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function addSupporterNote(body) {
  return request('/supporters/dashboard/notes', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getSupporterChatMessages(userId) {
  return request(`/supporters/chat/${userId}/messages`)
}

export function sendSupporterChatMessage(userId, message, language = 'english') {
  return request(`/supporters/chat/${userId}/send`, {
    method: 'POST',
    body: JSON.stringify({ message, language }),
  })
}

export function resetSupporterChatMessages(userId) {
  return request(`/supporters/chat/${userId}/reset`, {
    method: 'POST',
  })
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

// ── Statements ────────────────────────────────────────────────────────────────

export function uploadStatement(file, language) {
  const token = getToken()
  const formData = new FormData()
  formData.append('file', file)
  formData.append('language', language)
  return fetch(`${BASE}/statements/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
    return data
  })
}

export function supporterUploadStatement(userId, file, language) {
  const token = getToken()
  const formData = new FormData()
  formData.append('file', file)
  formData.append('language', language)
  return fetch(`${BASE}/supporters/dashboard/users/${userId}/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
    return data
  })
}

export function listStatements() {
  return request('/statements/')
}

export function getStatementStatus(id) {
  return request(`/statements/${id}/status`)
}

export function deleteStatement(id) {
  return request(`/statements/${id}`, { method: 'DELETE' })
}

export function listAbsaSessions() {
  return request('/absa/sessions')
}

export function deleteAbsaSession(id) {
  return request(`/absa/session/${id}`, { method: 'DELETE' })
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

export function visualizeInsight(id) {
  return request(`/insights/${id}/visualize`)
}

export function getWeeklyWin() {
  return request('/insights/weekly-win')
}

export function translateMessage(text, targetLanguage) {
  return request('/insights/translate-message', {
    method: 'POST',
    body: JSON.stringify({ text, target_language: targetLanguage }),
  })
}

export function getAccessibleInsight(id, language) {
  const params = new URLSearchParams()
  if (language) params.set('language', language)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return request(`/insights/${id}/accessible${suffix}`)
}

// ── Chat ───────────────────────────────────────────────────────────────────────

export function listChatSessions() {
  return request('/chat/sessions')
}

export function createChatSession(body = {}) {
  return request('/chat/sessions', { method: 'POST', body: JSON.stringify(body) })
}

export function getChatMessages(sessionId) {
  return request(`/chat/sessions/${sessionId}/messages`)
}

export function sendChatMessage(sessionId, message, language, trustedSupporterName) {
  return request(`/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      language,
      trusted_supporter_name: trustedSupporterName || undefined,
    }),
  })
}

export function logCalmAutoActivation(payload) {
  return request('/chat/calm-auto-activation', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  })
}
