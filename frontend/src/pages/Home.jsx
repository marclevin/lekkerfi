import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listInsights, visualizeInsight } from '../api/client'
import { useAuth } from '../context/AuthContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(value) {
  if (value == null) return '—'
  return `R ${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function todayLabel() {
  return new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })
}

// ── Nav cards ─────────────────────────────────────────────────────────────────

function NavCard({ icon, title, desc, to, locked, badge, onClick }) {
  return (
    <button
      className={`nav-card${locked ? ' nav-card-locked' : ''}`}
      onClick={locked ? undefined : onClick}
      disabled={locked}
      aria-label={title}
    >
      <div className="nav-card-icon">{icon}</div>
      <div className="nav-card-body">
        <div className="nav-card-title">{title}</div>
        <div className="nav-card-desc">{desc}</div>
      </div>
      {badge && <span className="nav-card-badge">{badge}</span>}
      {!locked && (
        <span className="nav-card-arrow">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </span>
      )}
    </button>
  )
}

// ── Snapshot stat ─────────────────────────────────────────────────────────────

function SnapStat({ label, value, positive }) {
  return (
    <div className="snap-stat">
      <span className="snap-stat-label">{label}</span>
      <span className={`snap-stat-value${positive === true ? ' positive' : positive === false ? ' negative' : ''}`}>
        {positive === true && <span aria-hidden="true">↑ </span>}
        {positive === false && <span aria-hidden="true">↓ </span>}
        {value}
      </span>
    </div>
  )
}

// ── Chart modal ───────────────────────────────────────────────────────────────

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

// ── Snapshot section ──────────────────────────────────────────────────────────

function FinancialSnapshot({ latestInsight, viz, vizLoading, vizError, colorblind, onZoom, onToggleColorblind }) {
  const navigate = useNavigate()
  const summary = viz?.summary

  const PRIORITY = ['spending_overview', 'balance_progression', 'daily_trend', 'category_breakdown']
  const charts = viz?.visualizations
    ? [...viz.visualizations]
        .sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type))
        .slice(0, 2)
    : []

  return (
    <section className="snapshot-section">
      {/* Header */}
      <div className="snapshot-header">
        <div>
          <h2 className="snapshot-title">Latest Snapshot</h2>
          {latestInsight && (
            <p className="snapshot-sub">
              {latestInsight.accounts?.join(', ')} · {fmtDate(latestInsight.created_at)}
            </p>
          )}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/insights')}>
          View all →
        </button>
      </div>

      {vizLoading && (
        <div className="page-center" style={{ minHeight: 100 }}>
          <div className="spinner" />
        </div>
      )}

      {vizError && <div className="alert alert-error">{vizError}</div>}

      {/* Key stats */}
      {summary && !vizLoading && (
        <div className="snap-stats-row">
          <SnapStat label="Income"    value={fmt(summary.total_income)}    positive={true} />
          <SnapStat label="Expenses"  value={fmt(summary.total_expenses)}  positive={false} />
          <SnapStat label="Net Flow"  value={fmt(summary.net_flow)}        positive={summary.net_flow >= 0} />
          <SnapStat label="Balance"   value={fmt(summary.account_balance)} />
        </div>
      )}

      {/* Charts */}
      {charts.length > 0 && !vizLoading && (
        <>
          <div className="snapshot-charts-bar">
            <span className="snapshot-charts-label">Charts</span>
            <label className="cb-toggle-row" title="Grayscale for colour-blind viewing">
              <span className="cb-toggle-label">Grayscale</span>
              <span className="toggle-switch">
                <input type="checkbox" checked={colorblind} onChange={(e) => onToggleColorblind(e.target.checked)} />
                <span className="toggle-slider" />
              </span>
            </label>
          </div>

          <div className="chart-grid">
            {charts.map((c) => (
              <div
                key={c.type}
                className="chart-card card"
                onClick={() => onZoom(c)}
                role="button"
                tabIndex={0}
                aria-label={`Expand: ${c.title}`}
                onKeyDown={(e) => e.key === 'Enter' && onZoom(c)}
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

      {/* AI summary bullets */}
      {latestInsight?.simplified && !vizLoading && (
        <div className="snapshot-ai-summary">
          <p className="snapshot-ai-label">AI Summary</p>
          {latestInsight.simplified.split('\n').filter(Boolean).slice(0, 4).map((line, i) => (
            <p key={i} className="snapshot-ai-line">{line}</p>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [insights, setInsights] = useState(null)
  const [viz, setViz] = useState(null)
  const [vizLoading, setVizLoading] = useState(false)
  const [vizError, setVizError] = useState('')
  const [zoomedChart, setZoomedChart] = useState(null)
  const [colorblind, setColorblind] = useState(false)

  const handleZoom = useCallback((v) => setZoomedChart(v), [])
  const handleCloseZoom = useCallback(() => setZoomedChart(null), [])

  useEffect(() => {
    listInsights()
      .then((d) => setInsights(d.insights))
      .catch(() => setInsights([]))
  }, [])

  const latestInsight = insights?.[0] ?? null

  useEffect(() => {
    if (!latestInsight) return
    setViz(null)
    setVizError('')
    setVizLoading(true)
    visualizeInsight(latestInsight.id)
      .then(setViz)
      .catch((err) => setVizError(err.message))
      .finally(() => setVizLoading(false))
  }, [latestInsight?.id])

  const firstName = user?.email?.split('@')[0] ?? ''
  const hasInsights = !!latestInsight
  const insightCount = insights?.length ?? 0

  return (
    <div className="page dashboard-page">

      {/* ── Greeting ── */}
      <header className="home-greeting">
        <p className="home-greeting-time">{greeting()}</p>
        <h1 className="home-greeting-name">{firstName || 'there'}</h1>
        <p className="home-greeting-date">{todayLabel()}</p>
      </header>

      {/* ── Navigation cards ── */}
      <div className="nav-cards-grid">
        <NavCard
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          }
          title="Insights"
          desc={insightCount > 0 ? `${insightCount} report${insightCount !== 1 ? 's' : ''} available` : 'No reports yet'}
          onClick={() => navigate('/insights')}
        />
        <NavCard
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          }
          title="Chat"
          desc="Ask questions about your money"
          onClick={() => navigate('/chat')}
        />
        <NavCard
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
            </svg>
          }
          title="Connect"
          desc="Upload a statement or link ABSA"
          onClick={() => navigate('/connect')}
        />
        <NavCard
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 .49-4.95" />
            </svg>
          }
          title="History"
          desc="Past uploads and connections"
          onClick={() => navigate('/history')}
        />
      </div>

      {/* ── Loading ── */}
      {insights === null && (
        <div className="page-center" style={{ minHeight: 80 }}>
          <div className="spinner" />
        </div>
      )}

      {/* ── No insights yet ── */}
      {insights?.length === 0 && (
        <div className="home-onboarding">
          <p className="section-label">Get started</p>
          <div className="hiw-grid">
            <div className="hiw-step">
              <div className="hiw-number">1</div>
              <h3>Connect or Upload</h3>
              <p>Link your ABSA account via SureCheck, or upload a bank statement PDF or photo.</p>
            </div>
            <div className="hiw-step">
              <div className="hiw-number">2</div>
              <h3>AI Analysis</h3>
              <p>Our AI reads your transactions and identifies spending patterns and trends.</p>
            </div>
            <div className="hiw-step">
              <div className="hiw-number">3</div>
              <h3>Get Insights</h3>
              <p>View charts and plain-language summaries in your preferred South African language.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Financial snapshot ── */}
      {hasInsights && (
        <FinancialSnapshot
          latestInsight={latestInsight}
          viz={viz}
          vizLoading={vizLoading}
          vizError={vizError}
          colorblind={colorblind}
          onZoom={handleZoom}
          onToggleColorblind={setColorblind}
        />
      )}

      {/* ── Chart zoom modal ── */}
      {zoomedChart && <ChartModal viz={zoomedChart} onClose={handleCloseZoom} />}
    </div>
  )
}
