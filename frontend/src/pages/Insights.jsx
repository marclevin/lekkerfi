import { useEffect, useState } from 'react'
import { getInsight, listInsights, translateInsight } from '../api/client'

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
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function InsightDetail({ id, onClose }) {
  const [insight, setInsight] = useState(null)
  const [activeTab, setActiveTab] = useState('simplified')
  const [newLang, setNewLang] = useState('zulu')
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getInsight(id).then(setInsight).catch((e) => setError(e.message))
  }, [id])

  async function handleTranslate() {
    setError('')
    setTranslating(true)
    try {
      const t = await translateInsight(id, newLang)
      setInsight((prev) => ({
        ...prev,
        translations: [...(prev.translations || []), t],
      }))
      setActiveTab(t.language)
    } catch (err) {
      setError(err.message)
    } finally {
      setTranslating(false)
    }
  }

  if (error && !insight) {
    return (
      <div className="insight-detail">
        <div className="alert alert-error">{error}</div>
        <button className="btn btn-ghost" onClick={onClose}>← Back</button>
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

  const currentTranslation = insight.translations?.find((t) => t.language === activeTab)

  return (
    <div className="insight-detail">
      <button className="btn btn-ghost back-btn" onClick={onClose}>
        ← Back to insights
      </button>

      <div className="insight-meta">
        <span>{formatDate(insight.created_at)}</span>
        <span>Accounts: {insight.accounts?.join(', ')}</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="tab-bar">
        <button
          className={`tab ${activeTab === 'simplified' ? 'active' : ''}`}
          onClick={() => setActiveTab('simplified')}
        >
          Summary (English)
        </button>
        {insight.translations?.map((t) => (
          <button
            key={t.language}
            className={`tab ${activeTab === t.language ? 'active' : ''}`}
            onClick={() => setActiveTab(t.language)}
          >
            {LANGUAGES.find((l) => l.value === t.language)?.label || t.language}
          </button>
        ))}
      </div>

      <div className="insight-bullets">
        {activeTab === 'simplified'
          ? insight.simplified?.split('\n').map((line, i) => <p key={i}>{line}</p>)
          : currentTranslation?.translated?.split('\n').map((line, i) => <p key={i}>{line}</p>)}
      </div>

      <div className="translate-section">
        <h4>Add translation</h4>
        <div className="translate-row">
          <select value={newLang} onChange={(e) => setNewLang(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-secondary"
            onClick={handleTranslate}
            disabled={translating}
          >
            {translating ? 'Translating…' : 'Translate'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Insights() {
  const [insights, setInsights] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listInsights()
      .then((data) => setInsights(data.insights || []))
      .catch((e) => setError(e.message))
  }, [])

  if (selectedId) {
    return (
      <div className="page">
        <div className="card">
          <InsightDetail id={selectedId} onClose={() => setSelectedId(null)} />
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Your Insights</h1>
        <p>Past financial analyses</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!insights && !error && (
        <div className="page-center">
          <span className="spinner" />
        </div>
      )}

      {insights?.length === 0 && (
        <div className="card empty-state">
          <p>No insights yet.</p>
          <p>Go to the <a href="/flow">Flow</a> page to generate your first analysis.</p>
        </div>
      )}

      <div className="insights-grid">
        {insights?.map((ins) => (
          <div key={ins.id} className="card insight-card" onClick={() => setSelectedId(ins.id)}>
            <div className="insight-card-header">
              <span className="insight-date">{formatDate(ins.created_at)}</span>
              <span className="insight-accounts">{ins.accounts?.join(' · ')}</span>
            </div>
            <div className="insight-preview">
              {ins.simplified?.split('\n').slice(0, 3).map((line, i) => (
                <p key={i} className="insight-preview-line">{line}</p>
              ))}
            </div>
            <div className="insight-card-footer">
              <span className="translation-count">
                {ins.translations?.length || 0} translation{ins.translations?.length !== 1 ? 's' : ''}
              </span>
              <span className="view-link">View →</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
