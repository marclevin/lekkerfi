export const CALM_MODE_KEY = 'lekkerfi_calm_mode'
export const CALM_AUTO_MODE_KEY = 'lekkerfi_calm_auto'
export const CALM_OVERRIDE_KEY = 'lekkerfi_calm_override'
export const CALM_REASON_KEY = 'lekkerfi_calm_reason'
export const CALM_SOURCE_KEY = 'lekkerfi_calm_source'
export const CALM_MODE_EVENT = 'lekkerfi-calm-mode-change'

function isBrowser() {
  return typeof window !== 'undefined'
}

export function readStoredBoolean(key, fallback = false) {
  if (!isBrowser()) return fallback
  try {
    const value = localStorage.getItem(key)
    if (value == null) return fallback
    return value === 'true'
  } catch {
    return fallback
  }
}

function writeStoredBoolean(key, value) {
  if (!isBrowser()) return
  try {
    localStorage.setItem(key, String(Boolean(value)))
  } catch {}
}

function readSessionBoolean(key, fallback = false) {
  if (!isBrowser()) return fallback
  try {
    const value = sessionStorage.getItem(key)
    if (value == null) return fallback
    return value === 'true'
  } catch {
    return fallback
  }
}

function writeSessionBoolean(key, value) {
  if (!isBrowser()) return
  try {
    sessionStorage.setItem(key, String(Boolean(value)))
  } catch {}
}

function readStoredString(key, fallback = '') {
  if (!isBrowser()) return fallback
  try {
    const value = localStorage.getItem(key)
    return value == null ? fallback : String(value)
  } catch {
    return fallback
  }
}

function writeStoredString(key, value) {
  if (!isBrowser()) return
  try {
    localStorage.setItem(key, String(value || ''))
  } catch {}
}

export function readCalmSnapshot() {
  return {
    manual: readStoredBoolean(CALM_MODE_KEY, false),
    auto: readStoredBoolean(CALM_AUTO_MODE_KEY, false),
    override: readSessionBoolean(CALM_OVERRIDE_KEY, false),
    reason: readStoredString(CALM_REASON_KEY, ''),
    source: readStoredString(CALM_SOURCE_KEY, ''),
  }
}

export function emitCalmModeChange() {
  if (!isBrowser()) return
  window.dispatchEvent(new CustomEvent(CALM_MODE_EVENT, { detail: readCalmSnapshot() }))
}

export function writeCalmManualMode(value) {
  writeStoredBoolean(CALM_MODE_KEY, value)
  emitCalmModeChange()
}

export function writeCalmAutoMode(value) {
  writeStoredBoolean(CALM_AUTO_MODE_KEY, value)
  if (!value) {
    writeStoredString(CALM_REASON_KEY, '')
    writeStoredString(CALM_SOURCE_KEY, '')
  }
  emitCalmModeChange()
}

export function activateCalmAutoMode({ reason = 'high_risk_signal', source = 'chat_signal' } = {}) {
  writeStoredBoolean(CALM_AUTO_MODE_KEY, true)
  writeStoredString(CALM_REASON_KEY, reason)
  writeStoredString(CALM_SOURCE_KEY, source)
  emitCalmModeChange()
}

export function writeCalmManualOverride(value) {
  writeSessionBoolean(CALM_OVERRIDE_KEY, value)
  emitCalmModeChange()
}

export function subscribeCalmModeChanges(onChange) {
  if (!isBrowser() || typeof onChange !== 'function') return () => {}

  const notify = () => onChange(readCalmSnapshot())
  const onStorage = (event) => {
    if (!event?.key) return
    if ([CALM_MODE_KEY, CALM_AUTO_MODE_KEY, CALM_REASON_KEY, CALM_SOURCE_KEY].includes(event.key)) {
      notify()
    }
  }

  window.addEventListener(CALM_MODE_EVENT, notify)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CALM_MODE_EVENT, notify)
    window.removeEventListener('storage', onStorage)
  }
}

const CALMING_TEMPLATES = {
  general_pause: {
    title: 'Let us slow down for a moment',
    standard: [
      'I hear that this feels urgent, and you are not alone.',
      'Chat is paused so your Trusted Supporter can help with a safer next step.',
      'Take one slow breath in for 4 seconds, then out for 6 seconds.',
      'If you feel in immediate danger, contact local emergency services now.',
    ],
    simplified: [
      'This feels urgent. You are not alone.',
      'Chat is paused while your Trusted Supporter helps you choose a safer step.',
      'Breathe in slowly for 4 seconds, then breathe out for 6 seconds.',
      'If you are in danger right now, call emergency services now.',
    ],
  },
  mania_impulsivity_pause: {
    title: 'Pause for control and safety',
    standard: [
      'Your message sounds intense, and it makes sense to pause before any decision.',
      'Chat is paused so your Trusted Supporter can review this with you.',
      'Try grounding: name 5 things you can see and 4 things you can feel.',
      'When you are ready, wait for supporter guidance before making purchases.',
    ],
    simplified: [
      'Your message sounds very intense. Let us pause first.',
      'Chat is paused so your Trusted Supporter can help you choose safely.',
      'Grounding step: name 5 things you see and 4 things you feel.',
      'Please wait for supporter guidance before buying anything.',
    ],
  },
  illegal_drugs_pause: {
    title: 'Safety pause is active',
    standard: [
      'I cannot help with buying illegal drugs, and your safety matters.',
      'Chat is paused while your Trusted Supporter reviews this situation.',
      'Step back from spending for 10 minutes and drink water if possible.',
      'If you feel out of control or unsafe, reach out to emergency support now.',
    ],
    simplified: [
      'I cannot help with buying illegal drugs. Your safety matters.',
      'Chat is paused while your Trusted Supporter reviews this.',
      'Please stop spending for 10 minutes and drink some water.',
      'If you feel unsafe, contact emergency support now.',
    ],
  },
  weapons_pause: {
    title: 'Safety review required',
    standard: [
      'I cannot assist with buying weapons for harm, and we need a safety pause.',
      'Your Trusted Supporter has been asked to review before chat continues.',
      'Take a short break from decision-making and move to a calm space.',
      'If there is immediate danger, contact emergency services now.',
    ],
    simplified: [
      'I cannot help with buying weapons for harm. We must pause for safety.',
      'Your Trusted Supporter is reviewing this before chat can continue.',
      'Take a short break and move to a calm place if you can.',
      'If danger is immediate, call emergency services now.',
    ],
  },
  self_harm_pause: {
    title: 'You deserve immediate support',
    standard: [
      'I am really glad you reached out. You deserve support right now.',
      'Chat is paused so your Trusted Supporter can help respond quickly.',
      'Please contact local emergency services or a crisis line if you might act on these thoughts.',
      'If possible, move near another person and stay with them while support is arranged.',
    ],
    simplified: [
      'I am glad you reached out. You need support right now.',
      'Chat is paused so your Trusted Supporter can respond quickly.',
      'If you might act on these thoughts, call emergency services or a crisis line now.',
      'If you can, stay near another person while help is arranged.',
    ],
  },
  violence_pause: {
    title: 'Pause to reduce harm risk',
    standard: [
      'I cannot help with harming someone, and we need a safety pause now.',
      'Your Trusted Supporter has been alerted to review this with urgency.',
      'Step away from anything that could be used to hurt someone.',
      'If you think harm could happen soon, contact emergency services immediately.',
    ],
    simplified: [
      'I cannot help with harming someone. We must pause now for safety.',
      'Your Trusted Supporter was alerted to review this urgently.',
      'Please step away from anything that could hurt someone.',
      'If harm could happen soon, call emergency services now.',
    ],
  },
  harmful_spending_pause: {
    title: 'Take a short cooling-off pause',
    standard: [
      'This sounds like a high-risk spending moment, so a pause is the safer choice.',
      'Chat is paused while your Trusted Supporter reviews your next step.',
      'Try a 10-minute break before any money decision and avoid opening payment apps.',
      'When support arrives, choose one low-risk action first.',
    ],
    simplified: [
      'This looks like risky spending. A pause is safer right now.',
      'Chat is paused while your Trusted Supporter reviews your next step.',
      'Take a 10-minute break and do not open payment apps.',
      'When support arrives, take one small safe action first.',
    ],
  },
}

const CATEGORY_TO_TEMPLATE = {
  mania_impulsivity: 'mania_impulsivity_pause',
  illegal_drugs_purchase: 'illegal_drugs_pause',
  weapons_purchase: 'weapons_pause',
  self_harm: 'self_harm_pause',
  violence_threat: 'violence_pause',
  harmful_spending: 'harmful_spending_pause',
}

export function getCalmingPauseMessage({
  category,
  templateKey,
  languageVariant,
  useSimplified = false,
} = {}) {
  const mappedKey = templateKey || CATEGORY_TO_TEMPLATE[String(category || '')] || 'general_pause'
  const selected = CALMING_TEMPLATES[mappedKey] || CALMING_TEMPLATES.general_pause
  const variant = useSimplified || languageVariant === 'simplified' ? 'simplified' : 'standard'
  const lines = selected[variant] || selected.standard
  return {
    key: mappedKey,
    title: selected.title,
    lines,
  }
}