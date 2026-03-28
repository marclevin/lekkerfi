import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useLocation, useNavigate } from 'react-router-dom'
import { createChatSession, getChatMessages, listChatSessions, listInsights, sendChatMessage } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { friendlyAccountList, readAccountTags } from '../utils/accountTags'

const LANGUAGES = [
  { value: 'xhosa',     label: 'isiXhosa' },
  { value: 'zulu',      label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho',     label: 'Sesotho' },
  { value: 'english',   label: 'English' },
]

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`chat-message ${isUser ? 'chat-message-user' : 'chat-message-assistant'}`}>
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
  const accountTags = readAccountTags()
  const { user } = useAuth()
  const [sessionId, setSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [language, setLanguage] = useState(() => {
    try {
      const saved = localStorage.getItem('lekkerfi_chat_lang')
      if (saved) return saved
    } catch {}
    return 'english'
  })

  // Apply profile preferred_language once user loads, if no explicit chat choice is saved
  useEffect(() => {
    if (!user?.preferred_language) return
    try {
      if (!localStorage.getItem('lekkerfi_chat_lang')) setLanguage(user.preferred_language)
    } catch {}
  }, [user?.preferred_language])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasFinancialContext, setHasFinancialContext] = useState(true)
  const [chatPaused, setChatPaused] = useState(false)
  const [pauseReason, setPauseReason] = useState('')
  // Insight selection
  const [insights, setInsights] = useState([])
  const [selectedInsightId, setSelectedInsightId] = useState(null)
  const [pendingLaunch, setPendingLaunch] = useState(null)

  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Load insights list once
  useEffect(() => {
    listInsights()
      .then((d) => {
        const list = d.insights || []
        setInsights(list)
        if (list.length > 0) setSelectedInsightId(list[0].id)
      })
      .catch(() => {})
  }, [])

  // Parse deep-link requests from Insights page (insightId + prefill)
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const prefill = (params.get('prefill') || '').trim()
    const rawInsightId = params.get('insightId')
    const insightId = rawInsightId ? Number(rawInsightId) : null
    if (!prefill && !insightId) return
    setPendingLaunch({ prefill, insightId })
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
          if (latest.insight_id) setSelectedInsightId(latest.insight_id)
          const { messages: msgs } = await getChatMessages(latest.id)
          setMessages(msgs)
        } else {
          const { session } = await createChatSession()
          setSessionId(session.id)
          setChatPaused(Boolean(session.is_paused))
          setPauseReason(session.paused_reason || '')
          if (session.insight_id) setSelectedInsightId(session.insight_id)
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

  // Apply deep-link once session and insights are available
  useEffect(() => {
    if (!pendingLaunch || loading || insights.length === 0) return

    let cancelled = false

    async function applyLaunch() {
      const targetInsight = pendingLaunch.insightId && insights.some((i) => i.id === pendingLaunch.insightId)
        ? pendingLaunch.insightId
        : selectedInsightId || insights[0]?.id || null

      if (targetInsight && targetInsight !== selectedInsightId) {
        await handleNewChat(targetInsight)
        if (cancelled) return
        setSelectedInsightId(targetInsight)
      }

      if (pendingLaunch.prefill) {
        setInput(pendingLaunch.prefill)
      }

      setPendingLaunch(null)
      navigate('/chat', { replace: true })
      inputRef.current?.focus()
    }

    applyLaunch()
    return () => {
      cancelled = true
    }
  }, [pendingLaunch, loading, insights, selectedInsightId])

  async function handleNewChat(insightId) {
    setLoading(true)
    setError('')
    try {
      const body = insightId ? { insight_id: insightId } : {}
      const { session } = await createChatSession(body)
      setSessionId(session.id)
      setChatPaused(Boolean(session.is_paused))
      setPauseReason(session.paused_reason || '')
      if (session.insight_id) setSelectedInsightId(session.insight_id)
      setMessages([])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  async function handleInsightChange(newId) {
    const id = newId ? Number(newId) : null
    setSelectedInsightId(id)
    await handleNewChat(id)
  }

  async function handleSend() {
    const text = input.trim()
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
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        data.user_message,
        data.assistant_message,
      ])
    } catch (err) {
      if (err?.status === 423) {
        setChatPaused(true)
        setPauseReason(err?.data?.pause_reason || '')
      }
      setError(err.message)
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const selectedInsight = insights.find((i) => i.id === selectedInsightId)

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
            {!loading && hasFinancialContext && selectedInsight && (
              <p className="chat-header-sub">
                {friendlyAccountList(selectedInsight.accounts, accountTags, ', ')} · {formatDate(selectedInsight.created_at)}
              </p>
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
              {[
                'How much did I spend last month?',
                'What is my biggest expense category?',
                'Am I saving enough?',
              ].map((s) => (
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
          <div className="alert alert-error" role="alert">
            Chat is paused while your Trusted Supporter reviews this spending request.
            {pauseReason ? ` (${pauseReason.replace(/_/g, ' ')})` : ''}
          </div>
        </div>
      )}

      {/* ── Controls bar ── */}
      <div className="chat-controls-bar" role="group" aria-label="Chat controls">
        {insights.length > 0 && (
          <div className="chat-ctrl-field">
            <label className="chat-ctrl-label" htmlFor="chat-insight-select">Summary</label>
            <select
              id="chat-insight-select"
              className="chat-ctrl-select"
              value={selectedInsightId ?? ''}
              onChange={(e) => handleInsightChange(e.target.value || null)}
              aria-label="Choose which summary to chat about"
              disabled={loading}
            >
              {insights.map((ins) => (
                <option key={ins.id} value={ins.id}>
                  {friendlyAccountList(ins.accounts, accountTags, ', ') || 'Unnamed'} · {formatDate(ins.created_at)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="chat-ctrl-field">
          <label className="chat-ctrl-label" htmlFor="chat-language-select">Language</label>
          <select
            id="chat-language-select"
            className="chat-ctrl-select"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value)
              try { localStorage.setItem('lekkerfi_chat_lang', e.target.value) } catch {}
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
          onClick={() => handleNewChat(selectedInsightId)}
          disabled={loading}
          aria-label="Start a new chat"
        >
          + New
        </button>
      </div>

      {/* ── Input ── */}
      <div className="chat-input-bar">
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
