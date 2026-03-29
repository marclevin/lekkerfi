import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useLocation, useNavigate } from 'react-router-dom'
import { createChatSession, getChatMessages, listChatSessions, sendChatMessage } from '../api/client'
import { useAuth } from '../context/AuthContext'
import {
  activateCalmAutoMode,
  readStoredBoolean,
  subscribeCalmModeChanges,
  writeCalmAutoMode,
  CALM_MODE_KEY,
  getCalmingPauseMessage,
} from '../utils/calmMode'

const LANGUAGES = [
  { value: 'xhosa',     label: 'isiXhosa' },
  { value: 'zulu',      label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho',     label: 'Sesotho' },
  { value: 'english',   label: 'English' },
]

function normalizeLanguage(value) {
  const candidate = String(value || '').toLowerCase()
  return LANGUAGES.some((item) => item.value === candidate) ? candidate : 'english'
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

const HIGH_RISK_TRIGGER = /\b(buy now|buy it now|spend now|urgent|manic|panic|overwhelmed|cannot think|can't think|cant stop|can't stop|i need it now|all in|max out|yolo|big spend|huge spend|go crazy|unstoppable|i feel invincible)\b/i

function detectAutoCalmTrigger(text, payload, manicCadenceDetected) {
  const sourceText = String(text || '')
  const coach = payload?.coach_signals || {}
  const riskScore = Number(coach.risk_score || 0)
  const urgency = String(coach.urgency_level || '').toLowerCase()

  if (manicCadenceDetected) return { triggered: true, reason: 'manic_cadence_4_in_60s', source: 'message_cadence' }
  if (HIGH_RISK_TRIGGER.test(sourceText)) return { triggered: true, reason: 'high_risk_keyword', source: 'user_keywords' }
  if (payload?.chat_paused === true || Boolean(payload?.pause_reason)) {
    return { triggered: true, reason: 'chat_pause_signal', source: 'coach_signals' }
  }
  if (Boolean(coach.supporter_flag_required)) {
    return { triggered: true, reason: 'supporter_flag_required', source: 'supporter_flag' }
  }
  if (Boolean(coach.pause_required) || Boolean(coach.pause_prompt)) {
    return { triggered: true, reason: 'pause_prompt_signal', source: 'coach_signals' }
  }
  if (Boolean(coach.emotional_distress) || Boolean(coach.repeated_intent)) {
    return { triggered: true, reason: 'emotional_distress_signal', source: 'coach_signals' }
  }
  if (Boolean(coach.safety_detected)) {
    return { triggered: true, reason: 'dangerous_intent_signal', source: 'coach_signals' }
  }
  if (urgency === 'high' || riskScore >= 3) {
    return { triggered: true, reason: 'elevated_risk_score', source: 'coach_signals' }
  }
  return { triggered: false, reason: '', source: '' }
}

function parseSafetyPayload(payload) {
  const safety = payload?.safety || null
  const coach = payload?.coach_signals || {}
  if (safety && typeof safety === 'object') {
    return {
      detected: Boolean(safety.detected),
      category: safety.category || null,
      confidence: safety.confidence || 'none',
      templateKey: safety.calming_template_key || null,
      languageVariant: safety.language_variant || 'standard',
      evidence: Array.isArray(safety.evidence) ? safety.evidence : [],
    }
  }

  return {
    detected: Boolean(coach.safety_detected),
    category: coach.safety_category || null,
    confidence: coach.safety_confidence || 'none',
    templateKey: coach.safety_calming_template_key || null,
    languageVariant: coach.safety_language_variant || 'standard',
    evidence: Array.isArray(coach.safety_evidence) ? coach.safety_evidence : [],
  }
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  const isSupporter = msg.role === 'supporter'
  return (
    <div className={`chat-message ${isUser ? 'chat-message-user' : isSupporter ? 'chat-message-supporter' : 'chat-message-assistant'}`}>
      {isSupporter && <span className="chat-supporter-label">Message from your supporter</span>}
      <div className="chat-bubble">
        {isUser ? (
          <p>{msg.text}</p>
        ) : (
          <div className="chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
          </div>
        )}
      </div>
      <span className="chat-message-time">{formatTime(msg.created_at)}</span>
    </div>
  )
}

// ── Thinking indicator ─────────────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div className="chat-message chat-message-assistant">
      <div className="chat-bubble chat-bubble-thinking">
        <span className="chat-dot" />
        <span className="chat-dot" />
        <span className="chat-dot" />
      </div>
    </div>
  )
}

// ── Main Chat page ─────────────────────────────────────────────────────────────

export default function Chat() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [sessionId, setSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [language, setLanguage] = useState(() => {
    try {
      const saved = localStorage.getItem('lekkerfi_chat_lang')
      if (saved) return normalizeLanguage(saved)
    } catch {}
    return 'english'
  })

  // Default chat language to the user's profile language whenever profile data is available.
  useEffect(() => {
    if (!user?.preferred_language) return
    setLanguage(normalizeLanguage(user.preferred_language))
  }, [user?.preferred_language])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasFinancialContext, setHasFinancialContext] = useState(true)
  const [chatPaused, setChatPaused] = useState(false)
  const [pauseReason, setPauseReason] = useState('')
  const [safetyPause, setSafetyPause] = useState({
    detected: false,
    category: null,
    confidence: 'none',
    templateKey: null,
    languageVariant: 'standard',
    evidence: [],
  })
  const [pendingLaunch, setPendingLaunch] = useState(null)
  const [launchNeedsUrlCleanup, setLaunchNeedsUrlCleanup] = useState(false)
  const [isCalmMode, setIsCalmMode] = useState(() => {
    const fromBody = document.body.classList.contains('calm-mode')
    const fromStorage = readStoredBoolean(CALM_MODE_KEY, false)
    return fromBody || fromStorage
  })

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const processedLaunchKeyRef = useRef(null)
  const userSendTimestampsRef = useRef([])
  const lastSupporterMessageIdRef = useRef(null)

  useEffect(() => {
    return subscribeCalmModeChanges((snapshot) => {
      const active = snapshot.override ? snapshot.manual : (snapshot.manual || snapshot.auto)
      setIsCalmMode(Boolean(active))
    })
  }, [])

  // Parse deep-link requests from Insights page (prefill only)
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const prefill = (params.get('prefill') || '').trim()
    const autoSend = params.get('autosend') === '1'
    if (!prefill) return

    const launchKey = `${prefill}|${autoSend ? '1' : '0'}`
    if (processedLaunchKeyRef.current === launchKey) return

    setPendingLaunch({ launchKey, prefill, autoSend })
    setLaunchNeedsUrlCleanup(true)
  }, [location.search])

  // On mount: load or create a session (using the latest insight)
  useEffect(() => {
    async function init() {
      setLoading(true)
      setError('')
      try {
        const { sessions } = await listChatSessions()
        if (sessions.length > 0) {
          const latest = sessions[0]
          setSessionId(latest.id)
          setChatPaused(Boolean(latest.is_paused))
          setPauseReason(latest.paused_reason || '')
          setSafetyPause({
            detected: String(latest.paused_reason || '').startsWith('safety_'),
            category: null,
            confidence: 'none',
            templateKey: null,
            languageVariant: 'standard',
            evidence: [],
          })
          if (Boolean(latest.is_paused) && String(latest.paused_reason || '').startsWith('safety_')) {
            activateCalmAutoMode({ reason: 'chat_pause_signal', source: 'coach_signals' })
          } else if (!Boolean(latest.is_paused)) {
            // If supporter has unpaused the chat, release any stale auto calm lock.
            writeCalmAutoMode(false)
          }
          const { messages: msgs } = await getChatMessages(latest.id)
          setMessages(msgs)
        } else {
          const { session } = await createChatSession()
          setSessionId(session.id)
          setChatPaused(Boolean(session.is_paused))
          setPauseReason(session.paused_reason || '')
          setSafetyPause({
            detected: String(session.paused_reason || '').startsWith('safety_'),
            category: null,
            confidence: 'none',
            templateKey: null,
            languageVariant: 'standard',
            evidence: [],
          })
          setMessages([])
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    if (!Array.isArray(messages) || messages.length === 0) return
    const latest = messages[messages.length - 1]
    if (!latest || latest.role !== 'supporter') return
    if (lastSupporterMessageIdRef.current === latest.id) return
    lastSupporterMessageIdRef.current = latest.id
    activateCalmAutoMode({
      reason: 'supporter_trigger_instant',
      source: 'supporter_flag',
    })
  }, [messages])

  // Apply deep-link once session is available
  useEffect(() => {
    if (!pendingLaunch || loading) return

    let cancelled = false

    async function applyLaunch() {
      if (processedLaunchKeyRef.current === pendingLaunch.launchKey) return

      if (pendingLaunch.prefill) {
        setInput(pendingLaunch.prefill)
        if (pendingLaunch.autoSend && !chatPaused) {
          await sendPreparedText(pendingLaunch.prefill)
          if (cancelled) return
        }
      }

      processedLaunchKeyRef.current = pendingLaunch.launchKey
      setPendingLaunch(null)
      inputRef.current?.focus()
    }

    applyLaunch()
    return () => {
      cancelled = true
    }
  }, [pendingLaunch, loading, chatPaused])

  async function handleNewChat() {
    setLoading(true)
    setError('')
    try {
      const { session } = await createChatSession()
      setSessionId(session.id)
      setChatPaused(Boolean(session.is_paused))
      setPauseReason(session.paused_reason || '')
      setSafetyPause({
        detected: String(session.paused_reason || '').startsWith('safety_'),
        category: null,
        confidence: 'none',
        templateKey: null,
        languageVariant: 'standard',
        evidence: [],
      })
      setMessages([])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  async function sendPreparedText(rawText) {
    const text = String(rawText || '').trim()
    if (!text || !sessionId || sending) return

    setInput('')
    setSending(true)
    setError('')

    const optimistic = {
      id: `opt-${Date.now()}`,
      role: 'user',
      text,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const supporterName = user?.trusted_supporter_name || null
      const data = await sendChatMessage(sessionId, text, language, supporterName)
      setHasFinancialContext(data.has_financial_context)
      setChatPaused(Boolean(data.chat_paused))
      setPauseReason(data.pause_reason || '')
      setSafetyPause(parseSafetyPayload(data))
      const now = Date.now()
      userSendTimestampsRef.current = [...userSendTimestampsRef.current, now].filter((ts) => now - ts <= 60000)
      const manicCadenceDetected = userSendTimestampsRef.current.length >= 4
      const trigger = detectAutoCalmTrigger(text, data, manicCadenceDetected)
      if (trigger.triggered) {
        activateCalmAutoMode({ reason: trigger.reason, source: trigger.source })
      } else if (!Boolean(data.chat_paused)) {
        // No active pause/risk signal in this turn; keep calm mode user-controlled.
        writeCalmAutoMode(false)
      }
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        data.user_message,
        data.assistant_message,
      ])

      if (launchNeedsUrlCleanup && location.search) {
        navigate('/chat', { replace: true })
        setLaunchNeedsUrlCleanup(false)
      }
    } catch (err) {
      if (err?.status === 423) {
        setChatPaused(true)
        setPauseReason(err?.data?.pause_reason || '')
        setSafetyPause(parseSafetyPayload(err?.data || {}))
        activateCalmAutoMode({ reason: 'chat_pause_signal', source: 'coach_signals' })
      }
      setError(err.message)
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  async function handleSend() {
    await sendPreparedText(input)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const starterSuggestions = isCalmMode
    ? ['Help me focus only on essentials and give one safe step now.']
    : [
      'How much did I spend last month?',
      'What is my biggest expense category?',
      'Am I saving enough?',
    ]
  const calming = getCalmingPauseMessage({
    category: safetyPause.category,
    templateKey: safetyPause.templateKey,
    languageVariant: safetyPause.languageVariant,
    useSimplified: isCalmMode,
  })

  return (
    <div className="chat-page">
      {/* ── Header ── */}
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="chat-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="chat-header-text">
            <h1 className="chat-header-title">Ask about your money</h1>
            {!loading && !hasFinancialContext && (
              <p className="chat-header-sub chat-header-sub-warn">No money data yet. Upload a statement first.</p>
            )}
            {!loading && hasFinancialContext && (
              <p className="chat-header-sub">Connected finance data is ready for chat.</p>
            )}
            {isCalmMode && (
              <p className="chat-calm-note">Calm mode is on. We focus on essentials and one step at a time.</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="chat-messages" role="log" aria-live="polite" aria-relevant="additions text">
        {loading && (
          <div className="page-center" style={{ minHeight: 120 }}>
            <div className="spinner" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="chat-empty-title">Ask anything about your money</p>
            <p className="chat-empty-sub">Replies will come in your chosen language.</p>
            <div className="chat-suggestions">
              {starterSuggestions.map((s) => (
                <button
                  key={s}
                  className="chat-suggestion"
                  onClick={() => { setInput(s); inputRef.current?.focus() }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {sending && <ThinkingIndicator />}

        <div ref={bottomRef} />
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="chat-error">
          <div className="alert alert-error" role="alert">{error}</div>
        </div>
      )}

      {chatPaused && (
        <div className="chat-error">
          <div className="alert alert-error" role="alert" aria-atomic="true">
            {safetyPause.detected
              ? 'Chat is paused for safety review by your Trusted Supporter.'
              : 'Chat is paused while your Trusted Supporter reviews this spending request.'}
            {pauseReason ? ` (${pauseReason.replace(/_/g, ' ')})` : ''}
          </div>
        </div>
      )}

      {chatPaused && safetyPause.detected && (
        <div className="chat-error">
          <section className="chat-safety-panel" aria-labelledby="chat-safety-title" role="region">
            <h2 id="chat-safety-title" className="chat-safety-title">{calming.title}</h2>
            <div className="chat-safety-lines" aria-live="polite" aria-atomic="true">
              {calming.lines.map((line) => <p key={line}>{line}</p>)}
            </div>
          </section>
        </div>
      )}

      {/* ── Controls bar ── */}
      {!isCalmMode && (
      <div className="chat-controls-bar" role="group" aria-label="Chat controls">
        <div className="chat-ctrl-field">
          <label className="chat-ctrl-label" htmlFor="chat-language-select">Language</label>
          <select
            id="chat-language-select"
            className="chat-ctrl-select"
            value={language}
            onChange={(e) => {
              const next = normalizeLanguage(e.target.value)
              setLanguage(next)
              try { localStorage.setItem('lekkerfi_chat_lang', next) } catch {}
            }}
            aria-label="Choose chat language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <button
          className="btn btn-ghost btn-sm chat-ctrl-new"
          onClick={() => handleNewChat()}
          disabled={loading}
          aria-label="Start a new chat"
        >
          + New
        </button>
      </div>
      )}

      {/* ── Input ── */}
      <div className={`chat-input-bar${isCalmMode ? ' calm-priority' : ''}`}>
        <textarea
          ref={inputRef}
          className="chat-input"
          rows={1}
          placeholder="Type your question here"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending || loading || !sessionId || chatPaused}
          aria-label="Type your chat message"
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || sending || loading || !sessionId || chatPaused}
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
