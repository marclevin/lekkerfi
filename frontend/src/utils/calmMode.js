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

// ── Calming pause templates ────────────────────────────────────────────────────
//
// Two templates only:
//   supporter_review_pause — all financial, behavioural, and ambiguous safety flags.
//                            Does NOT name what was detected. Keeps tone warm and
//                            forward-looking: a human is on the way.
//   crisis_support_pause   — self-harm only. Keeps crisis-line direction and urgency.
//
// Each template is pre-translated into the five supported languages so the message
// appears in the user's chosen language with zero network latency during a pause.

const CALMING_TEMPLATES = {
  supporter_review_pause: {
    title: {
      english:   'Your Trusted Supporter is being notified',
      xhosa:     'Umxhasi wakho uyaziswa',
      zulu:      'USekeli wakho uxazululwa',
      afrikaans: 'Jou Vertroude Ondersteuner word in kennis gestel',
      sotho:     'Motlhatlheledi wa hau o a tsebiswa',
    },
    standard: {
      english: [
        'We have paused here so a real person can help guide your next step.',
        'Your Trusted Supporter has been alerted and will check in with you.',
        'Take a slow breath while we get them involved — you do not have to figure this out alone.',
        'If you feel in immediate danger, contact local emergency services now.',
      ],
      xhosa: [
        'Siphuze apha ukuze umntu wenyani akuncede kugqibela isinyathelo sakho esilandelayo.',
        'Umxhasi wakho okuThenjwayo uxelelwe kwaye uya kukujonga.',
        'Phefumla kancinci ngelixa sibandakanya — awunyanzelekanga ukuba ufumanise oku wedwa.',
        'Ukuba uziva usengozini ngoku, qhagamshelana neeenkonzo zezimele zasekuhlaleni ngoku.',
      ],
      zulu: [
        'Simile lapha ukuze umuntu wangempela akusizele eqondisa isinyathelo sakho esilandelayo.',
        'USekeli wakho okuThenjwayo wazisiwe futhi uzokuhlola.',
        'Phefumula kancane sihlela ukubandakanya — awudingeki ukuthola lokhu wedwa.',
        'Uma uzizwa usengozini ngokushesha, xhumana nezinsizakalo zezingozi zasekhaya manje.',
      ],
      afrikaans: [
        'Ons het hier gestaak sodat \'n regte persoon jou volgende stap kan help begelei.',
        'Jou Vertroude Ondersteuner is ingelig en sal by jou inskakel.',
        'Haal \'n stadige asem terwyl ons hulle betrek — jy hoef dit nie alleen uit te vind nie.',
        'As jy in onmiddellike gevaar voel, kontak plaaslike nooddienste nou.',
      ],
      sotho: [
        'Re emile mona e le hore motho wa nnete a tle a thuse ho tsamaisa mohato wa hau o hlahlamang.',
        'Motlhatlheledi wa hau oa Botshepehi o tsebisitswe \'me o tla o sheba.',
        'Hema butle ha re ntse re kenyelletsa — ha o hloke ho fumana sena o le mong.',
        'Ha o ikutlwa o le kotsing ka potlako, ikopanya le ditshebeletso tsa tšohanyetso tsa lehae joale.',
      ],
    },
    simplified: {
      english: [
        'We paused so your Trusted Supporter can help. You are not alone.',
        'They have been alerted and will check in soon.',
        'Take a slow breath. One step at a time.',
        'If you are in danger right now, call emergency services.',
      ],
      xhosa: [
        'Siphuze ukuze umxhasi wakho akuncede. Awukho wedwa.',
        'Baxelelwe kwaye baza kukujonga kungekudala.',
        'Phefumla kancinci. Isinyathelo esinye ngexesha.',
        'Ukuba usengozini ngoku, tsalela iinkonzo zezimele.',
      ],
      zulu: [
        'Simile ukuze usekeli wakho akusizele. Awulona wedwa.',
        'Bazisiwe futhi bazokuhlola maduze.',
        'Phefumula kancane. Isinyathelo esisodwa ngasikhathi.',
        'Uma usengozini manje, shayela izinsizakalo zezingozi.',
      ],
      afrikaans: [
        'Ons het gestaak sodat jou ondersteuner kan help. Jy is nie alleen nie.',
        'Hulle is ingelig en sal gou inskakel.',
        'Haal \'n stadige asem. Een stap op \'n slag.',
        'As jy nou in gevaar is, bel nooddienste.',
      ],
      sotho: [
        'Re emile e le hore motlhatlheledi wa hau a thuse. Ha o le mong.',
        'Ba tsebisitswe \'me ba tla sheba haufinyane.',
        'Hema butle. Mohato o le mong ka nako.',
        'Ha o le kotsing joale, letsa ditshebeletso tsa tšohanyetso.',
      ],
    },
  },

  crisis_support_pause: {
    title: {
      english:   'You deserve immediate support',
      xhosa:     'Ufaneleke ukuxhaswa ngoku',
      zulu:      'Ufanelwe usizo ngokushesha',
      afrikaans: 'Jy verdien onmiddellike ondersteuning',
      sotho:     'O tshoaneloa ke thuso ka potlako',
    },
    standard: {
      english: [
        'We are really glad you reached out. You deserve support right now.',
        'Chat is paused so your Trusted Supporter can respond quickly.',
        'Please contact a crisis line or local emergency services if you might act on these thoughts.',
        'If you can, stay near another person while help is arranged.',
      ],
      xhosa: [
        'Siyavuya kakhulu ukuba ufikile. Ufaneleke ukuxhaswa ngoku.',
        'Ingxoxo iphuziwe ukuze umxhasi wakho okuThenjwayo aphendule ngokukhawuleza.',
        'Nceda uqhagamshelane nomgca weengxaki okanye iinkonzo zezimele zasekuhlaleni ukuba ungenza ngezi mcimbi.',
        'Ukuba unako, hlala kufutshane nomnye umntu ngelixa uluncedo lulungiswa.',
      ],
      zulu: [
        'Sijabule kakhulu ukuthi wafika. Ufanelwe usizo manje.',
        'Ingxoxo imisiwe ukuze uSekeli wakho okuThenjwayo aphendule ngokushesha.',
        'Sicela uxhumane nomugqa wezinkinga noma izinsizakalo zezingozi zasekhaya uma ungase wenze lezi zinto.',
        'Uma ungakwenza, hlala eduze komuntu omnye ngenkathi usizo lulungiswa.',
      ],
      afrikaans: [
        'Ons is regtig bly dat jy uitgereik het. Jy verdien nou ondersteuning.',
        'Gesels is gestaak sodat jou Vertroude Ondersteuner vinnig kan reageer.',
        'Kontak asseblief \'n krisislyn of plaaslike nooddienste as jy dalk op hierdie gedagtes kan optree.',
        'As jy kan, bly naby \'n ander persoon terwyl hulp gereël word.',
      ],
      sotho: [
        'Re thaba haholo hoba o fihlile. O tshoaneloa ke thuso joale.',
        'Puisano e emisitswe e le hore Motlhatlheledi wa hau oa Botshepehi a arabe ka potlako.',
        'Ka kopo ikopanya le mola oa tšohanyetso kapa ditshebeletso tsa tšohanyetso tsa lehae haeba o ka etsa dinahano tsena.',
        'Ha o khona, lula haufi le motho e mong ha thuso e hlophiswa.',
      ],
    },
    simplified: {
      english: [
        'We are glad you reached out. You need support right now.',
        'Chat is paused so your Trusted Supporter can respond quickly.',
        'If you might act on these thoughts, call emergency services or a crisis line now.',
        'Stay near another person if you can while help is arranged.',
      ],
      xhosa: [
        'Siyavuya ukuba ufikile. Udinga inkxaso ngoku.',
        'Ingxoxo iphuziwe ukuze umxhasi wakho aphendule ngokukhawuleza.',
        'Ukuba ungenza ngezi mcimbi, tsalela iinkonzo zezimele okanye umgca weengxaki ngoku.',
        'Hlala kufutshane nomnye umntu ukuba unako ngelixa uluncedo lulungiswa.',
      ],
      zulu: [
        'Sijabule ukuthi wafika. Udinga usizo manje.',
        'Ingxoxo imisiwe ukuze uSekeli wakho aphendule ngokushesha.',
        'Uma ungase wenze lezi zinto, shayela izinsizakalo zezingozi noma umugqa wezinkinga manje.',
        'Hlala eduze komuntu omnye uma ungakwenza ngenkathi usizo lulungiswa.',
      ],
      afrikaans: [
        'Ons is bly dat jy uitgereik het. Jy het nou ondersteuning nodig.',
        'Gesels is gestaak sodat jou ondersteuner vinnig kan reageer.',
        'As jy dalk op hierdie gedagtes kan optree, bel nooddienste of \'n krisislyn nou.',
        'Bly naby \'n ander persoon as jy kan terwyl hulp gereël word.',
      ],
      sotho: [
        'Re thaba hoba o fihlile. O hloka thuso joale.',
        'Puisano e emisitswe e le hore motlhatlheledi wa hau a arabe ka potlako.',
        'Haeba o ka etsa dinahano tsena, letsa ditshebeletso tsa tšohanyetso kapa mola oa tšohanyetso joale.',
        'Lula haufi le motho e mong ha o khona ha thuso e hlophiswa.',
      ],
    },
  },
}

// All safety categories except self_harm route to supporter_review_pause.
// self_harm gets the crisis template with crisis-line direction.
const CATEGORY_TO_TEMPLATE = {
  self_harm: 'crisis_support_pause',
}

export function getCalmingPauseMessage({
  category,
  templateKey,
  language = 'english',
  useSimplified = false,
} = {}) {
  const mappedKey = templateKey || CATEGORY_TO_TEMPLATE[String(category || '')] || 'supporter_review_pause'
  const selected = CALMING_TEMPLATES[mappedKey] || CALMING_TEMPLATES.supporter_review_pause
  const lang = ['english', 'xhosa', 'zulu', 'afrikaans', 'sotho'].includes(language) ? language : 'english'
  const variant = useSimplified ? 'simplified' : 'standard'
  const lines = (selected[variant]?.[lang]) || selected.standard.english
  const title = selected.title[lang] || selected.title.english
  return {
    key: mappedKey,
    title,
    lines,
  }
}