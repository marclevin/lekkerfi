import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadStatement } from '../api/client'

const LANGUAGES = [
  { value: 'xhosa',     label: 'isiXhosa' },
  { value: 'zulu',      label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho',     label: 'Sesotho' },
  { value: 'english',   label: 'English' },
]

const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.webp'

function InsightResult({ result, onReset }) {
  const navigate = useNavigate()
  const langLabel = LANGUAGES.find((l) => l.value === result.language)?.label || result.language

  return (
    <div className="step-content">
      <h2>Your Financial Insights</h2>
      <p className="step-desc">
        Extracted from <strong>{result.accounts?.[0]}</strong>.
      </p>

      <div className="callout callout-success">
        <span className="callout-icon">✅</span>
        <div className="callout-body">
          Statement analysed! Head to your <strong>Home</strong> dashboard to see charts and visualisations.
        </div>
      </div>

      <div className="insight-section">
        <h3>Summary</h3>
        <div className="insight-bullets">
          {result.simplified?.split('\n').filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
        </div>
      </div>

      <div className="insight-section">
        <h3>
          Translated <span className="lang-badge">{langLabel}</span>
        </h3>
        <div className="insight-bullets translated">
          {result.translated?.split('\n').filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
        </div>
      </div>

      <div className="insight-actions">
        <button className="btn btn-primary" onClick={() => navigate('/home')}>
          View Dashboard
        </button>
        <button className="btn btn-secondary" onClick={() => navigate('/insights')}>
          View all insights
        </button>
        <button className="btn btn-ghost" onClick={onReset}>
          Upload another
        </button>
      </div>
    </div>
  )
}

export default function Upload() {
  const fileInputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [language, setLanguage] = useState('xhosa')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  function handleFileChange(e) {
    const picked = e.target.files?.[0]
    if (picked) setFile(picked)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) setFile(dropped)
  }

  async function handleUpload() {
    if (!file) return
    setError('')
    setUploading(true)
    try {
      const data = await uploadStatement(file, language)
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function handleReset() {
    setResult(null)
    setFile(null)
    setError('')
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Upload Bank Statement</h1>
        <p>Upload a PDF or photo of your bank statement to get AI-powered financial insights.</p>
      </div>

      <div className="card flow-card">
        {result ? (
          <InsightResult result={result} onReset={handleReset} />
        ) : (
          <div className="step-content">
            <h2>Select Statement</h2>

            <div className="callout callout-info">
              <span className="callout-icon">📎</span>
              <div className="callout-body">
                <strong>Supported formats:</strong> PDF, JPG, PNG, WebP.
                <p>Processing uses AI vision and typically takes <strong>30–60 seconds</strong>. Works with statements from any South African bank.</p>
              </div>
            </div>

            <div
              className={`upload-zone ${file ? 'has-file' : ''} ${dragging ? 'dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              aria-label="Upload file area — click to browse or drag a file here"
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED}
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              {file ? (
                <>
                  <span className="upload-zone-icon">📄</span>
                  <span className="upload-zone-filename">{file.name}</span>
                  <span className="upload-zone-hint">Click to change file</span>
                </>
              ) : (
                <>
                  <span className="upload-zone-icon">⬆️</span>
                  <span className="upload-zone-hint">Click to browse or drag a file here</span>
                </>
              )}
            </div>

            <div className="form-group" style={{ maxWidth: 280 }}>
              <label htmlFor="upload-lang">Insight language</label>
              <select
                id="upload-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={!file || uploading}
            >
              {uploading ? 'Analysing statement… (this may take a moment)' : 'Upload & Analyse'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
