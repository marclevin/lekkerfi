import { useCallback, useEffect, useState } from 'react'
import { getInsight, listInsights, translateInsight, visualizeInsight } from '../api/client'

const LANGUAGES = [
  { value: 'xhosa', label: 'isiXhosa' },
  { value: 'zulu', label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho', label: 'Sesotho' },
  { value: 'english', label: 'English' },
]

const CHART_PRIORITY = ['spending_overview', 'balance_progression', 'daily_trend', 'category_breakdown']

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmt(value) {
  if (value == null) return '—'
  return `R ${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Chart zoom modal ───────────────────────────────────────────────────────────

function ChartModal({ viz, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="chart-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={viz.title}>
      <div className="chart-modal" onClick={(e) => e.stopPropagation()}>
        <div className="chart-modal-top">
          <div className="chart-modal-info">
            <h3>{viz.title}</h3>
            <p>{viz.description}</p>
          </div>
          <button className="chart-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="chart-modal-body">
          <img src={viz.url} alt={viz.title} className="chart-modal-img" />
        </div>
      </div>
    </div>
  )
}

// ── Insight detail ─────────────────────────────────────────────────────────────

function InsightDetail({ id, onClose }) {
  const [insight, setInsight] = useState(null)
  const [activeTab, setActiveTab] = useState('simplified')
  const [newLang, setNewLang] = useState('zulu')
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState('')

  const [viz, setViz] = useState(null)
  const [vizLoading, setVizLoading] = useState(true)
  const [colorblind, setColorblind] = useState(false)
  const [zoomedChart, setZoomedChart] = useState(null)

  const handleZoom = useCallback((c) => setZoomedChart(c), [])
  const handleCloseZoom = useCallback(() => setZoomedChart(null), [])

  useEffect(() => {
    getInsight(id).then(setInsight).catch((e) => setError(e.message))
  }, [id])

  useEffect(() => {
    setVizLoading(true)
    visualizeInsight(id)
      .then(setViz)
      .catch(() => {}) // charts are non-critical
      .finally(() => setVizLoading(false))
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
  const summary = viz?.summary
  const charts = viz?.visualizations
    ? [...viz.visualizations].sort((a, b) => CHART_PRIORITY.indexOf(a.type) - CHART_PRIORITY.indexOf(b.type))
    : []

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

      {/* ── Key stats ── */}
      {summary && (
        <div className="snap-stats-row" style={{ marginBottom: '1.25rem' }}>
          <div className="snap-stat">
            <span className="snap-stat-label">Income</span>
            <span className="snap-stat-value positive">↑ {fmt(summary.total_income)}</span>
          </div>
          <div className="snap-stat">
            <span className="snap-stat-label">Expenses</span>
            <span className="snap-stat-value negative">↓ {fmt(summary.total_expenses)}</span>
          </div>
          <div className="snap-stat">
            <span className="snap-stat-label">Net Flow</span>
            <span className={`snap-stat-value${summary.net_flow >= 0 ? ' positive' : ' negative'}`}>
              {fmt(summary.net_flow)}
            </span>
          </div>
          <div className="snap-stat">
            <span className="snap-stat-label">Balance</span>
            <span className="snap-stat-value">{fmt(summary.account_balance)}</span>
          </div>
        </div>
      )}

      {/* ── Charts ── */}
      {vizLoading && (
        <div className="page-center" style={{ minHeight: 80 }}>
          <div className="spinner" />
        </div>
      )}

      {!vizLoading && charts.length > 0 && (
        <>
          <div className="snapshot-charts-bar">
            <span className="snapshot-charts-label">Charts</span>
            <label className="cb-toggle-row" title="Grayscale for colour-blind viewing">
              <span className="cb-toggle-label">Grayscale</span>
              <span className="toggle-switch">
                <input type="checkbox" checked={colorblind} onChange={(e) => setColorblind(e.target.checked)} />
                <span className="toggle-slider" />
              </span>
            </label>
          </div>

          <div className="chart-grid">
            {charts.map((c) => (
              <div
                key={c.type}
                className="chart-card card"
                onClick={() => handleZoom(c)}
                role="button"
                tabIndex={0}
                aria-label={`Expand: ${c.title}`}
                onKeyDown={(e) => e.key === 'Enter' && handleZoom(c)}
              >
                <div className="chart-header">
                  <span className="chart-title">{c.title}</span>
                  <span className="chart-desc">{c.description}</span>
                </div>
                <img
                  src={c.url}
                  alt={c.title}
                  className={`chart-img${colorblind ? ' colorblind' : ''}`}
                  loading="lazy"
                />
                <p className="chart-zoom-hint">Tap to expand</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Text summary tabs ── */}
      <div className="tab-bar" style={{ marginTop: '1.5rem' }}>
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

      {/* ── Translate ── */}
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

      {zoomedChart && <ChartModal viz={zoomedChart} onClose={handleCloseZoom} />}
    </div>
  )
}

// ── Insights list ──────────────────────────────────────────────────────────────

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
              <span className="view-link">View charts & summary →</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
