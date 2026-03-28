import { useEffect, useRef, useState } from 'react'
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
  const [calmMode, setCalmMode] = useState(() => {
    try {
      return localStorage.getItem('lekkerfi_calm_mode') === 'true'
    } catch {
      return false
    }
  })
  const [showAllOptions, setShowAllOptions] = useState(false)

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'lekkerfi_calm_mode') {
        setCalmMode(e.newValue === 'true')
      }
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (calmMode) setShowAllOptions(false)
  }, [calmMode])

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
        <h1 className="page-title-with-icon">
          <span className="page-title-icon" aria-hidden="true">📄</span>
          Upload bank statement
        </h1>
        <p>Upload one statement to get a clear money summary.</p>
      </div>

      <div className="card flow-card">
        {result ? (
          <InsightResult result={result} onReset={handleReset} />
        ) : (
          <div className="step-content">
            <h2>Select Statement</h2>

            {(!calmMode || showAllOptions) && (
              <div className="callout callout-info">
                <span className="callout-icon">📎</span>
                <div className="callout-body">
                  <strong>Accepted files:</strong> PDF, JPG, PNG, WebP.
                  <p>Processing usually takes <strong>30 to 60 seconds</strong>.</p>
                </div>
              </div>
            )}

            <button
              type="button"
              className={`upload-zone ${file ? 'has-file' : ''} ${dragging ? 'dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              aria-label="Upload file area. Click to browse or drag a file here"
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
            </button>

            {(!calmMode || showAllOptions) && (
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
            )}

            {error && <div className="alert alert-error" role="alert">{error}</div>}

            <button
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={!file || uploading}
              aria-label="Upload statement and generate summary"
            >
              {uploading ? 'Analysing statement… (this may take a moment)' : 'Upload & Analyse'}
            </button>

            {calmMode && !showAllOptions && (
              <button className="btn btn-secondary btn-full" type="button" onClick={() => setShowAllOptions(true)} aria-label="Show more upload options">
                Show more options
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
