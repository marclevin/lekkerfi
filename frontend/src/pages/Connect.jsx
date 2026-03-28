import { useNavigate } from 'react-router-dom'

export default function Connect() {
  const navigate = useNavigate()

  return (
    <div className="page">
      <div className="page-header">
        <h1>Connect</h1>
        <p>Add your financial data — via direct bank connection or by uploading a statement.</p>
      </div>

      <div className="connect-cards">
        <button className="connect-card card" onClick={() => navigate('/flow')}>
          <div className="connect-card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          </div>
          <div className="connect-card-body">
            <h2>Connect ABSA</h2>
            <p>
              Securely link your ABSA account via SureCheck to pull live transaction data.
              No credentials stored.
            </p>
            <ul className="connect-card-features">
              <li>Live 90-day transaction history</li>
              <li>Works with any ABSA account type</li>
              <li>Secure consent-based access</li>
            </ul>
          </div>
          <span className="connect-card-arrow">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </span>
        </button>

        <button className="connect-card card" onClick={() => navigate('/upload')}>
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
              Upload a PDF or photo of any South African bank statement for AI-powered analysis.
            </p>
            <ul className="connect-card-features">
              <li>PDF, JPG, PNG, WebP supported</li>
              <li>Works with any SA bank</li>
              <li>Results in ~30–60 seconds</li>
            </ul>
          </div>
          <span className="connect-card-arrow">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </span>
        </button>
      </div>
    </div>
  )
}
