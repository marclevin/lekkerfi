import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { readStoredBoolean, subscribeCalmModeChanges, CALM_MODE_KEY } from '../utils/calmMode'

export default function Connect() {
  const navigate = useNavigate()
  const [calmMode, setCalmMode] = useState(() => readStoredBoolean(CALM_MODE_KEY, false))

  useEffect(() => {
    return subscribeCalmModeChanges((snapshot) => {
      const active = snapshot.override ? snapshot.manual : (snapshot.manual || snapshot.auto)
      setCalmMode(Boolean(active))
    })
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title-with-icon">
          <span className="page-title-icon" aria-hidden="true">🔗</span>
          Add money data
        </h1>
        <p>Choose one simple way to continue.</p>
      </div>

      <div className="connect-cards">
        <button className="connect-card card" onClick={() => navigate('/flow')} aria-label="Connect your ABSA bank account">
          <div className="connect-card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          </div>
          <div className="connect-card-body">
            <h2>Connect ABSA</h2>
            <p>
              Link your ABSA account securely.
            </p>
            <ul className="connect-card-features">
              <li>Fast and secure</li>
              <li>Uses ABSA approval</li>
              <li>No banking password stored</li>
            </ul>
          </div>
          <span className="connect-card-arrow">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </span>
        </button>

        {!calmMode && (
          <button className="connect-card card" onClick={() => navigate('/upload')} aria-label="Upload a bank statement file">
            <div className="connect-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <polyline points="9 15 12 12 15 15" />
              </svg>
            </div>
            <div className="connect-card-body">
              <h2>Upload Statement</h2>
              <p>
                Upload a bank statement file and get a simple summary.
              </p>
              <ul className="connect-card-features">
                <li>PDF or image files</li>
                <li>Works with South African banks</li>
                <li>Usually ready in under a minute</li>
              </ul>
            </div>
            <span className="connect-card-arrow">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </span>
          </button>
        )}
      </div>

      {calmMode && <p className="chat-calm-note">Calm mode keeps one next step here: connect ABSA.</p>}
    </div>
  )
}
