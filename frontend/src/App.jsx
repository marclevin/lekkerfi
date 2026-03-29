import { useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import BottomNav from './components/BottomNav'
import NavBar from './components/NavBar'
import ProtectedRoute from './components/ProtectedRoute'
import { useAuth } from './context/AuthContext'
import Chat from './pages/Chat'
import Connect from './pages/Connect'
import Flow from './pages/Flow'
import History from './pages/History'
import Home from './pages/Home'
import Insights from './pages/Insights'
import Login from './pages/Login'
import Profile from './pages/Profile'
import Register from './pages/Register'
import SpendingLimits from './pages/SpendingLimits'
import SupporterAlerts from './pages/SupporterAlerts'
import SupporterBankingFlow from './pages/SupporterBankingFlow'
import SupporterHome from './pages/SupporterHome'
import SupporterUserPage from './pages/SupporterUserPage'
import SupporterUsers from './pages/SupporterUsers'
import Upload from './pages/Upload'
import { logCalmAutoActivation } from './api/client'
import {
  readStoredBoolean,
  subscribeCalmModeChanges,
  writeCalmManualMode,
  writeCalmManualOverride,
  CALM_AUTO_MODE_KEY,
  CALM_MODE_KEY,
  CALM_OVERRIDE_KEY,
  CALM_REASON_KEY,
  CALM_SOURCE_KEY,
} from './utils/calmMode'

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={user.role === 'supporter' ? '/supporter' : '/home'} replace />
}

function getRouteCue(pathname) {
  if (pathname === '/login') {
    return {
      icon: '🔐',
      title: 'Login page',
      hint: 'Enter your email and password, then tap Log in.',
      speech: 'You are on the login page. Step 1: enter your email. Step 2: enter your password. Step 3: tap the green Log in button.'
    }
  }
  if (pathname === '/register') {
    return {
      icon: '📝',
      title: 'Sign up page',
      hint: 'Create your account with a few simple details.',
      speech: 'You are on the sign up page. Fill in your details, then tap create account.'
    }
  }
  if (pathname === '/home') {
    return {
      icon: '🏠',
      title: 'Home',
      hint: 'Follow the Start here steps to continue.',
      speech: 'You are on Home. Start with the Start here box. If you do not have money data yet, choose Add money data first. Then open your summary.'
    }
  }
  if (pathname === '/connect') {
    return {
      icon: '🔗',
      title: 'Add money data',
      hint: 'Choose ABSA connect or statement upload.',
      speech: 'You are on Add money data. Choose one option. Connect ABSA for live account consent, or upload a statement file.'
    }
  }
  if (pathname === '/upload') {
    return {
      icon: '📄',
      title: 'Upload statement',
      hint: 'Upload one bank statement file to continue.',
      speech: 'You are on Upload statement. Pick one file, choose language, then tap Upload and Analyse.'
    }
  }
  if (pathname === '/flow') {
    return {
      icon: '🏦',
      title: 'ABSA connect',
      hint: 'Complete each step in order to connect securely.',
      speech: 'You are on ABSA connect. Complete one step at a time and keep going until the summary page.'
    }
  }
  if (pathname === '/insights') {
    return {
      icon: '📊',
      title: 'Summary and insights',
      hint: 'Read your latest money summary here.',
      speech: 'You are on insights. Open the latest summary card to read your money trends.'
    }
  }
  if (pathname === '/chat') {
    return {
      icon: '💬',
      title: 'Money chat',
      hint: 'Ask one short question about your money.',
      speech: 'You are on money chat. Type one short question and send it.'
    }
  }
  if (pathname === '/limits') {
    return {
      icon: '🛡️',
      title: 'Spending limits',
      hint: 'See the limits your supporter has set for you.',
      speech: 'You are on spending limits. This page shows the daily, weekly, and monthly limits set by your trusted supporter.'
    }
  }
  if (pathname === '/history') {
    return {
      icon: '🕒',
      title: 'History',
      hint: 'View previous uploads and connections.',
      speech: 'You are on history. Review your previous uploads and connection records.'
    }
  }
  if (pathname === '/profile') {
    return {
      icon: '👤',
      title: 'Profile',
      hint: 'Update your details and preferences.',
      speech: 'You are on profile. Update your personal details and preferences here.'
    }
  }
  if (pathname === '/supporter') {
    return {
      icon: '🤝',
      title: 'Supporter dashboard',
      hint: 'See your support overview and choose a focused workspace.',
      speech: 'You are on supporter dashboard overview. Choose Manage users for user care tasks, or Alerts for triage.'
    }
  }
  if (pathname === '/supporter/users') {
    return {
      icon: '👥',
      title: 'Manage users',
      hint: 'Select one person and use focused care tools.',
      speech: 'You are on Manage users. Pick one person from the list, then review care actions for that person.'
    }
  }
  if (pathname === '/supporter/alerts') {
    return {
      icon: '🚨',
      title: 'Supporter alerts',
      hint: 'Triage chat and financial alerts here.',
      speech: 'You are on supporter alerts. Filter alerts by type, then open the user if action is needed.'
    }
  }
  return {
    icon: '📍',
    title: 'Current page',
    hint: 'Use the bottom tabs to move between pages.',
    speech: 'You are on this page. Use the bottom tabs to move between pages.'
  }
}

export default function App() {
  const { user } = useAuth()
  const location = useLocation()
  const cue = getRouteCue(location.pathname)
  const [calmMode, setCalmMode] = useState(() => readStoredBoolean(CALM_MODE_KEY, false))
  const [calmAutoMode, setCalmAutoMode] = useState(() => readStoredBoolean(CALM_AUTO_MODE_KEY, false))
  const [calmManualOverride, setCalmManualOverride] = useState(() => {
    try { return sessionStorage.getItem(CALM_OVERRIDE_KEY) === 'true' } catch { return false }
  })
  const [calmReason, setCalmReason] = useState(() => {
    try { return localStorage.getItem(CALM_REASON_KEY) || '' } catch { return '' }
  })
  const [calmSource, setCalmSource] = useState(() => {
    try { return localStorage.getItem(CALM_SOURCE_KEY) || '' } catch { return '' }
  })
  const [speakingHelp, setSpeakingHelp] = useState(false)
  const [pillDismissed, setPillDismissed] = useState(() => {
    try { return localStorage.getItem('lekkerfi_pill_dismissed') === 'true' } catch { return false }
  })
  const prevAutoModeRef = useRef(calmAutoMode)

  useEffect(() => {
    document.body.classList.toggle('calm-mode', calmMode)
  }, [calmMode])

  useEffect(() => {
    return subscribeCalmModeChanges((snapshot) => {
      setCalmAutoMode(Boolean(snapshot.auto))
      setCalmManualOverride(Boolean(snapshot.override))
      setCalmReason(String(snapshot.reason || ''))
      setCalmSource(String(snapshot.source || ''))
      if (snapshot.override) {
        setCalmMode(Boolean(snapshot.manual))
      }
    })
  }, [])

  useEffect(() => {
    const isUser = user?.role === 'user'
    const wasAuto = prevAutoModeRef.current
    const isAuto = Boolean(calmAutoMode)
    if (isUser && !wasAuto && isAuto) {
      logCalmAutoActivation({
        source: calmSource || 'chat_signal',
        reason: calmReason || 'high_risk_signal',
        route: location.pathname,
      }).catch(() => {})
    }
    prevAutoModeRef.current = isAuto
  }, [user?.role, calmAutoMode, calmSource, calmReason, location.pathname])

  useEffect(() => {
    const isUser = user?.role === 'user'
    if (!isUser || calmManualOverride) return
    setCalmMode(Boolean(calmAutoMode))
    writeCalmManualMode(Boolean(calmAutoMode))
  }, [user?.role, calmAutoMode, calmManualOverride])

  function toggleCalmMode() {
    const next = !calmMode
    setCalmManualOverride(true)
    setCalmMode(next)
    writeCalmManualOverride(true)
    writeCalmManualMode(next)
  }

  function dismissPill() {
    window.speechSynthesis?.cancel()
    setSpeakingHelp(false)
    setPillDismissed(true)
    try { localStorage.setItem('lekkerfi_pill_dismissed', 'true') } catch {}
  }

  function reopenPill() {
    setPillDismissed(false)
    try { localStorage.setItem('lekkerfi_pill_dismissed', 'false') } catch {}
  }

  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    setSpeakingHelp(false)
    // Do NOT reset pillDismissed here — it persists across navigation
  }, [location.pathname])

  function readPageHelp() {
    if (!('speechSynthesis' in window)) return
    if (speakingHelp) {
      window.speechSynthesis.cancel()
      setSpeakingHelp(false)
      return
    }

    const speechText = `${cue.speech} ${calmMode ? 'Calm mode is on, so the app shows one main action first.' : 'You can turn on Calm mode from the page guide if you want fewer options at once.'}`
    const utterance = new SpeechSynthesisUtterance(speechText)
    utterance.rate = 0.9
    utterance.pitch = 1
    utterance.onend = () => setSpeakingHelp(false)
    utterance.onerror = () => setSpeakingHelp(false)

    setSpeakingHelp(true)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }

  function calmBannerText(reason) {
    const key = String(reason || '').toLowerCase()
    if (key.includes('supporter')) return 'We simplified your screen because your supporter asked for a calmer flow.'
    if (key.includes('cadence')) return 'We simplified your screen to slow things down and keep your next steps clear.'
    if (key.includes('spending')) return 'We simplified your screen because your recent spending pattern looked high-risk.'
    return 'We simplified your screen to help you focus on safer money steps.'
  }

  const showCalmAutoBanner = Boolean(user?.role === 'user' && calmMode && calmAutoMode && !calmManualOverride)

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div id="app-status" className="sr-only" aria-live="polite" aria-atomic="true" />
      <NavBar
        showReadAloudIcon={Boolean(user && pillDismissed)}
        onOpenReadAloud={reopenPill}
      />
      <main
        id="main-content"
        className={`main-content${user ? ' has-bottom-nav has-help-tab-space' : ''}${location.pathname === '/chat' ? ' chat-route' : ''}`}
        data-calm-mode={calmMode ? 'true' : 'false'}
        data-user-role={user?.role || 'guest'}
      >
        <div className="route-cue" role="navigation" aria-label="Page guide">
          <span className="route-cue-icon" aria-hidden="true">{cue.icon}</span>
          <span className="route-cue-body">
            <strong className="route-cue-title">{cue.title}</strong>
            <span className="route-cue-hint"> — {cue.hint}</span>
          </span>
          <button
            id="global-calm-mode"
            type="button"
            className={`route-cue-calm-btn${calmMode ? ' active' : ''}`}
            onClick={toggleCalmMode}
            aria-pressed={calmMode}
            aria-label={calmMode ? 'Calm mode on. Tap to turn off.' : 'Calm mode off. Tap to turn on.'}
          >
            <span aria-hidden="true">🌿</span>
            {calmMode ? 'Calm on' : 'Calm'}
          </button>
        </div>
        {showCalmAutoBanner && (
          <div className="calm-auto-banner" role="status" aria-live="polite">
            <span className="calm-auto-banner-icon" aria-hidden="true">🌿</span>
            <span className="calm-auto-banner-text">{calmBannerText(calmReason)}</span>
          </div>
        )}
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/home"    element={<ProtectedRoute allowedRoles={['user']}><Home /></ProtectedRoute>} />
          <Route path="/flow"    element={<ProtectedRoute allowedRoles={['user']}><Flow /></ProtectedRoute>} />
          <Route path="/upload"  element={<ProtectedRoute allowedRoles={['user']}><Upload /></ProtectedRoute>} />
          <Route path="/insights" element={<ProtectedRoute allowedRoles={['user']}><Insights /></ProtectedRoute>} />
          <Route path="/chat"    element={<ProtectedRoute allowedRoles={['user']}><Chat /></ProtectedRoute>} />
          <Route path="/connect" element={<ProtectedRoute allowedRoles={['user']}><Connect /></ProtectedRoute>} />
          <Route path="/limits"  element={<ProtectedRoute allowedRoles={['user']}><SpendingLimits /></ProtectedRoute>} />
          <Route path="/supporter" element={<ProtectedRoute allowedRoles={['supporter']}><SupporterHome /></ProtectedRoute>} />
          <Route path="/supporter/users" element={<ProtectedRoute allowedRoles={['supporter']}><SupporterUsers /></ProtectedRoute>} />
          <Route path="/supporter/users/:userId" element={<ProtectedRoute allowedRoles={['supporter']}><SupporterUserPage /></ProtectedRoute>} />
          <Route path="/supporter/alerts" element={<ProtectedRoute allowedRoles={['supporter']}><SupporterAlerts /></ProtectedRoute>} />
          <Route path="/supporter/users/:userId/banking" element={<ProtectedRoute allowedRoles={['supporter']}><SupporterBankingFlow /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {user && pillDismissed && (
        <button
          type="button"
          className="help-now-tab"
          onClick={reopenPill}
          aria-label="Open read aloud"
          title="Read aloud"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
            <path d="M9 1a1 1 0 00-1.6-.8L4.3 3.5H2a1 1 0 00-1 1v7a1 1 0 001 1h2.3l3.1 2.3A1 1 0 009 14V1zM11.5 4.5a.5.5 0 01.5.5v6a.5.5 0 01-1 0V5a.5.5 0 01.5-.5zM13.5 2.5a.5.5 0 01.5.5v10a.5.5 0 01-1 0V3a.5.5 0 01.5-.5z"/>
          </svg>
        </button>
      )}
      {user && !pillDismissed && (
        <div
          className={`help-now-wrap${speakingHelp ? ' speaking' : ''}`}
        >
          <button
            type="button"
            className="help-now-btn"
            onClick={readPageHelp}
            aria-label={speakingHelp ? 'Stop reading aloud' : 'Read this page aloud'}
          >
            <span className="help-now-dot" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                <path d="M9 1a1 1 0 00-1.6-.8L4.3 3.5H2a1 1 0 00-1 1v7a1 1 0 001 1h2.3l3.1 2.3A1 1 0 009 14V1zM11.5 4.5a.5.5 0 01.5.5v6a.5.5 0 01-1 0V5a.5.5 0 01.5-.5zM13.5 2.5a.5.5 0 01.5.5v10a.5.5 0 01-1 0V3a.5.5 0 01.5-.5z"/>
              </svg>
            </span>
            {speakingHelp ? 'Stop' : 'Read aloud'}
          </button>
          <button
            type="button"
            className="help-now-dismiss"
            onClick={dismissPill}
            aria-label="Hide read aloud button"
          >
            ×
          </button>
        </div>
      )}
      <BottomNav />
    </>
  )
}
