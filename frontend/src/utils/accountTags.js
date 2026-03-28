const ACCOUNT_TAGS_STORAGE_KEY = 'lekkerfi_account_tags_v1'

const DEFAULT_ACCOUNT_TAGS = [
  'Daily money',
  'Home account',
  'Savings pot',
  'Bills account',
  'Backup account',
]

export function normalizeAccountKey(accountNumber) {
  if (accountNumber == null) return ''
  return String(accountNumber).trim()
}

export function readAccountTags() {
  try {
    const raw = localStorage.getItem(ACCOUNT_TAGS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

export function writeAccountTags(tags) {
  try {
    localStorage.setItem(ACCOUNT_TAGS_STORAGE_KEY, JSON.stringify(tags || {}))
  } catch {}
}

export function buildDefaultAccountTag(index = 0) {
  if (index < DEFAULT_ACCOUNT_TAGS.length) return DEFAULT_ACCOUNT_TAGS[index]
  return `Money account ${index + 1}`
}

export function maskAccountReference(accountNumber) {
  const digits = String(accountNumber || '').replace(/\D/g, '')
  if (!digits) return 'Account reference unavailable'
  const last4 = digits.slice(-4)
  return `Ref ending ${last4}`
}

export function ensureAccountTags(existingTags, accountNumbers) {
  const nextTags = { ...(existingTags || {}) }
  let changed = false

  ;(accountNumbers || []).forEach((accountNumber, index) => {
    const key = normalizeAccountKey(accountNumber)
    if (!key) return

    const current = String(nextTags[key] || '').trim()
    if (!current) {
      nextTags[key] = buildDefaultAccountTag(index)
      changed = true
    }
  })

  return { tags: nextTags, changed }
}

export function friendlyAccountName(accountNumber, tags, index = 0) {
  const key = normalizeAccountKey(accountNumber)
  if (!key) return buildDefaultAccountTag(index)

  const fromTags = String(tags?.[key] || '').trim()
  if (fromTags) return fromTags

  return buildDefaultAccountTag(index)
}

export function friendlyAccountList(accountNumbers, tags, separator = ' · ') {
  const list = (accountNumbers || []).map((accountNumber, index) => friendlyAccountName(accountNumber, tags, index))
  return list.filter(Boolean).join(separator)
}
