import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getAccessibleInsight,
  getInsight,
  listInsights,
} from '../api/client'
import { useAuth } from '../context/AuthContext'

const LANGUAGES = [
  { value: 'xhosa', label: 'isiXhosa' },
  { value: 'zulu', label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho', label: 'Sesotho' },
  { value: 'english', label: 'English' },
]

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function clampIndex(index, max) {
  if (max <= 0) return 0
  if (index < 0) return 0
  if (index > max - 1) return max - 1
  return index
}

function fmt(value) {
  if (value == null) return '—'
  return `R ${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function firstSentence(text) {
  if (!text) return ''
  const clean = String(text).replace(/\s+/g, ' ').trim()
  const idx = clean.search(/[.!?]/)
  return idx === -1 ? clean : clean.slice(0, idx + 1)
}

function getCardIcon(title = '') {
  const t = title.toLowerCase()
  if (t.includes('income') || t.includes('earning') || t.includes('salary')) return '💵'
  if (t.includes('expense') || t.includes('spending') || t.includes('spend')) return '🛒'
  if (t.includes('saving') || t.includes('save')) return '🏦'
  if (t.includes('balance')) return '💰'
  if (t.includes('food') || t.includes('grocer')) return '🍳'
  if (t.includes('transport') || t.includes('travel') || t.includes('fuel') || t.includes('petrol')) return '🚗'
  if (t.includes('housing') || t.includes('rent') || t.includes('home')) return '🏠'
  if (t.includes('entertain') || t.includes('leisure') || t.includes('fun')) return '🎬'
  if (t.includes('debt') || t.includes('loan') || t.includes('credit')) return '📋'
  if (t.includes('flow') || t.includes('net')) return '📊'
  if (t.includes('tip') || t.includes('advice') || t.includes('step')) return '💡'
  if (t.includes('health') || t.includes('medical')) return '❤️'
  if (t.includes('subscription') || t.includes('recurring')) return '🔄'
  return '📋'
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ amount, name, desc, type }) {
  return (
    <div className={`stat-card${type ? ` stat-card-${type}` : ''}`}>
      <span className="stat-card-amount">{amount}</span>
      <span className="stat-card-name">{name}</span>
      <span className="stat-card-desc">{desc}</span>
    </div>
  )
}

// ── Insight detail ─────────────────────────────────────────────────────────────

function InsightDetail({ id, preferredLanguage }) {
  const navigate = useNavigate()
  const [insight, setInsight] = useState(null)
  const [error, setError] = useState('')
  const [language, setLanguage] = useState(preferredLanguage || 'english')
  const [guided, setGuided] = useState(null)
  const [guidedLoading, setGuidedLoading] = useState(true)
  const [activeCard, setActiveCard] = useState(0)
  const [readingCard, setReadingCard] = useState(false)

  const summary = guided?.summary
  const cards = guided?.cards || []
  const card = cards[clampIndex(activeCard, cards.length)]

  useEffect(() => {
    setError('')
    getInsight(id).then(setInsight).catch((e) => setError(e.message))
  }, [id])

  useEffect(() => {
    setGuidedLoading(true)
    setError('')
    getAccessibleInsight(id, language)
      .then((data) => {
        setGuided(data)
        setActiveCard(0)
      })
      .catch((e) => setError(e.message))
      .finally(() => setGuidedLoading(false))
  }, [id, language])

  useEffect(() => {
    setLanguage(preferredLanguage || 'english')
  }, [preferredLanguage])

  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowRight') setActiveCard((prev) => clampIndex(prev + 1, cards.length))
      if (e.key === 'ArrowLeft') setActiveCard((prev) => clampIndex(prev - 1, cards.length))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [guided])

  useEffect(() => {
    if (!readingCard || !('speechSynthesis' in window) || !card) return
    window.speechSynthesis.cancel()
    const text = `${card.title}. ${card.headline}. ${card.explanation}. What to do: ${card.what_to_do_now}`
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.88
    utterance.pitch = 1
    utterance.onend = () => setReadingCard(false)
    utterance.onerror = () => setReadingCard(false)
    window.speechSynthesis.speak(utterance)
    return () => { window.speechSynthesis.cancel() }
  }, [readingCard, activeCard, guided])

  useEffect(() => {
    setActiveCard((prev) => clampIndex(prev, cards.length))
  }, [cards.length])

  function handleAskInChat(c) {
    const prompt = c?.chat_prompt
      || (c ? `Help me understand "${c.title}" in simple words. ${firstSentence(c.headline)}` : 'Please explain my money summary in simple steps.')
    navigate(`/chat?${new URLSearchParams({ insightId: String(id), prefill: prompt }).toString()}`)
  }

  if (error && !insight) {
    return (
      <div className="insight-detail">
        <div className="alert alert-error" role="alert">{error}</div>
      </div>
    )
  }

  if (!insight) {
    return (
      <div className="insight-detail page-center">
        <span className="spinner" />
      </div>
    )
  }

  return (
    <div className="insight-detail">
      {/* ── Header row ── */}
      <div className="insight-detail-header">
        <p className="insight-detail-date">📅 {formatDate(insight.created_at)}</p>
        <div className="insight-access-row">
          <label className="insight-lang">
            <span>Language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setReadingCard((prev) => !prev)}
            aria-pressed={readingCard}
            disabled={!card}
          >
            {readingCard ? '🔇 Stop' : '🔊 Read aloud'}
          </button>
        </div>
      </div>

      {/* ── Key stats ── */}
      {summary && (
        <div className="stat-cards-grid" style={{ marginBottom: '0.5rem' }}>
          <StatCard
            amount={fmt(summary.total_income)}
            name="Money in"
            desc="Came into your account"
            type="positive"
          />
          <StatCard
            amount={fmt(summary.total_expenses)}
            name="Money out"
            desc="What you spent"
            type="negative"
          />
          <StatCard
            amount={fmt(summary.net_flow)}
            name="Left over"
            desc={summary.net_flow >= 0 ? 'More in than out — well done' : 'More went out than came in'}
            type={summary.net_flow >= 0 ? 'positive' : 'negative'}
          />
          <StatCard
            amount={fmt(summary.account_balance)}
            name="Balance now"
            desc="Your account right now"
            type=""
          />
        </div>
      )}

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {/* ── Guided cards ── */}
      {guidedLoading && (
        <div className="page-center" style={{ minHeight: 80 }}>
          <div className="spinner" />
        </div>
      )}

      {!guidedLoading && !!card && (
        <>
          {/* Progress dots */}
          <div className="guided-progress" role="tablist" aria-label="Insight cards">
            {cards.map((_, idx) => (
              <button
                key={idx}
                type="button"
                role="tab"
                className={`guided-progress-dot${idx === activeCard ? ' active' : idx < activeCard ? ' done' : ''}`}
                onClick={() => setActiveCard(idx)}
                aria-selected={idx === activeCard}
                aria-label={`Card ${idx + 1}${idx < activeCard ? ' (done)' : ''}`}
              />
            ))}
          </div>

          {/* Card */}
          <article className="guided-card card" aria-label={`Insight card ${activeCard + 1} of ${cards.length}`}>
            <div className="guided-card-icon-row">
              <span className="guided-card-icon" aria-hidden="true">{getCardIcon(card.title)}</span>
              <div className="guided-card-meta">
                <p className="guided-card-step">{activeCard + 1} of {cards.length}</p>
                <h3 className="guided-card-title">{card.title}</h3>
              </div>
            </div>

            <p className="guided-headline">{firstSentence(card.headline)}</p>
            <p className="guided-explanation">{firstSentence(card.explanation)}</p>

            {card.what_to_do_now && (
              <div className="guided-next-step">
                <span className="guided-next-icon" aria-hidden="true">👉</span>
                <div>
                  <p className="guided-next-label">What to do</p>
                  <p className="guided-next-text">{card.what_to_do_now}</p>
                </div>
              </div>
            )}

            <div className="guided-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setActiveCard((prev) => clampIndex(prev - 1, cards.length))}
                disabled={activeCard === 0}
                aria-label="Previous card"
              >
                ← Back
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => handleAskInChat(card)}
                aria-label="Ask chat about this card"
              >
                💬 Ask chat
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setActiveCard((prev) => clampIndex(prev + 1, cards.length))}
                disabled={activeCard >= cards.length - 1}
                aria-label="Next card"
              >
                Next →
              </button>
            </div>
          </article>
        </>
      )}

      {cards.length === 0 && !guidedLoading && (
        <div className="card empty-state">
          <p>We could not build guided cards right now.</p>
          <button type="button" className="btn btn-secondary" onClick={() => handleAskInChat(null)}>
            💬 Ask in chat instead
          </button>
        </div>
      )}
    </div>
  )
}

// ── Insights page ──────────────────────────────────────────────────────────────

export default function Insights() {
  const { user } = useAuth()
  const [insights, setInsights] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listInsights()
      .then((data) => setInsights(data.insights || []))
      .catch((e) => setError(e.message))
  }, [])

  if (!insights && !error) {
    return (
      <div className="page">
        <div className="page-center" style={{ minHeight: 160 }}>
          <span className="spinner" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Your Insights</h1>
        </div>
        <div className="alert alert-error" role="alert">{error}</div>
      </div>
    )
  }

  if (insights.length === 0) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Your Insights</h1>
          <p>Connect your bank or upload a statement to get your first insight.</p>
        </div>
        <div className="card empty-state">
          <p style={{ fontSize: '2rem', marginBottom: '8px' }}>📊</p>
          <p>No insights yet.</p>
          <p>Go to <a href="/flow">Connect &amp; Flow</a> to generate your first analysis.</p>
        </div>
      </div>
    )
  }

  const latest = insights[0]

  return (
    <div className="page">
      <div className="page-header">
        <h1>Your Insights</h1>
        <p>One step at a time — your latest money summary below.</p>
      </div>
      <InsightDetail
        id={latest.id}
        preferredLanguage={user?.preferred_language || 'english'}
      />
    </div>
  )
}
