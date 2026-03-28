import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createChatSession, getChatMessages, listChatSessions, listInsights, sendChatMessage } from '../api/client'

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
  const [sessionId, setSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [language, setLanguage] = useState('english')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasFinancialContext, setHasFinancialContext] = useState(true)

  // Insight selection
  const [insights, setInsights] = useState([])
  const [selectedInsightId, setSelectedInsightId] = useState(null)

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
          if (latest.insight_id) setSelectedInsightId(latest.insight_id)
          const { messages: msgs } = await getChatMessages(latest.id)
          setMessages(msgs)
        } else {
          const { session } = await createChatSession()
          setSessionId(session.id)
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

  async function handleNewChat(insightId) {
    setLoading(true)
    setError('')
    try {
      const body = insightId ? { insight_id: insightId } : {}
      const { session } = await createChatSession(body)
      setSessionId(session.id)
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
      const data = await sendChatMessage(sessionId, text, language)
      setHasFinancialContext(data.has_financial_context)
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        data.user_message,
        data.assistant_message,
      ])
    } catch (err) {
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
            <h1 className="chat-header-title">Chat with your finances</h1>
            {!loading && !hasFinancialContext && (
              <p className="chat-header-sub chat-header-sub-warn">No financial data — upload a statement first.</p>
            )}
            {!loading && hasFinancialContext && selectedInsight && (
              <p className="chat-header-sub">
                {selectedInsight.accounts?.join(', ')} · {formatDate(selectedInsight.created_at)}
              </p>
            )}
          </div>
        </div>

        <div className="chat-header-actions">
          {/* Insight picker */}
          {insights.length > 0 && (
            <select
              className="chat-lang-select"
              value={selectedInsightId ?? ''}
              onChange={(e) => handleInsightChange(e.target.value || null)}
              title="Choose snapshot to chat about"
              disabled={loading}
            >
              {insights.map((ins) => (
                <option key={ins.id} value={ins.id}>
                  {ins.accounts?.join(', ') || 'Unnamed'} · {formatDate(ins.created_at)}
                </option>
              ))}
            </select>
          )}

          {/* Language picker */}
          <select
            className="chat-lang-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            title="Reply language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>

          <button className="btn btn-ghost btn-sm" onClick={() => handleNewChat(selectedInsightId)} disabled={loading}>
            New chat
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="chat-messages">
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
          <div className="alert alert-error">{error}</div>
        </div>
      )}

      {/* ── Input ── */}
      <div className="chat-input-bar">
        <textarea
          ref={inputRef}
          className="chat-input"
          rows={1}
          placeholder="Ask about your spending, savings, or finances…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending || loading || !sessionId}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || sending || loading || !sessionId}
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
