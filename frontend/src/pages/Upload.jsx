import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStatementStatus, uploadStatement } from '../api/client'
import { readStoredBoolean, subscribeCalmModeChanges, CALM_MODE_KEY } from '../utils/calmMode'

const LANGUAGES = [
  { value: 'xhosa',     label: 'isiXhosa' },
  { value: 'zulu',      label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho',     label: 'Sesotho' },
  { value: 'english',   label: 'English' },
]

const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.webp'
const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 80  // ~4 minutes

function InsightReady({ onReset }) {
  const navigate = useNavigate()
  return (
    <div className="step-content">
      <h2>Your statement is ready!</h2>
      <div className="callout callout-success">
        <span className="callout-icon">✅</span>
        <div className="callout-body">
          Analysis complete. Head to Insights to see your full money summary and charts.
        </div>
      </div>
      <div className="insight-actions">
        <button className="btn btn-primary" onClick={() => navigate('/insights')}>
          View insights
        </button>
        <button className="btn btn-ghost" onClick={onReset}>
          Upload another
        </button>
      </div>
    </div>
  )
}

function Processing({ filename, onCancel }) {
  return (
    <div className="step-content">
      <h2>Analysing your statement…</h2>
      <div className="callout callout-info">
        <span className="callout-icon">⏳</span>
        <div className="callout-body">
          <strong>{filename}</strong> is being processed in the background.
          <p>This usually takes 30–60 seconds. You can leave this page — we'll keep working.</p>
        </div>
      </div>
      <div className="upload-processing-spinner">
        <span className="spinner" />
        <span className="upload-processing-label">Analysing…</span>
      </div>
      <button className="btn btn-ghost" onClick={onCancel} style={{ marginTop: 12 }}>
        Cancel and upload a different file
      </button>
    </div>
  )
}

export default function Upload() {
  const fileInputRef = useRef(null)
  const pollRef = useRef(null)
  const pollCountRef = useRef(0)

  const [file, setFile] = useState(null)
  const [language, setLanguage] = useState('xhosa')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState('idle')  // idle | processing | done | error
  const [statementId, setStatementId] = useState(null)
  const [filename, setFilename] = useState('')
  const [calmMode, setCalmMode] = useState(() => readStoredBoolean(CALM_MODE_KEY, false))

  useEffect(() => {
    return subscribeCalmModeChanges((snapshot) => {
      const active = snapshot.override ? snapshot.manual : (snapshot.manual || snapshot.auto)
      setCalmMode(Boolean(active))
    })
  }, [])

  // Polling loop
  useEffect(() => {
    if (phase !== 'processing' || !statementId) return

    pollCountRef.current = 0
    pollRef.current = setInterval(async () => {
      pollCountRef.current += 1
      if (pollCountRef.current > MAX_POLLS) {
        clearInterval(pollRef.current)
        setPhase('error')
        setError('Processing timed out. Please try again.')
        return
      }
      try {
        const data = await getStatementStatus(statementId)
        if (data.status === 'done') {
          clearInterval(pollRef.current)
          setPhase('done')
        } else if (data.status === 'error') {
          clearInterval(pollRef.current)
          setPhase('error')
          setError(data.error_message || 'Processing failed. Please try again.')
        }
      } catch {
        // network blip — keep polling
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(pollRef.current)
  }, [phase, statementId])

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
      setStatementId(data.statement_id)
      setFilename(file.name)
      setPhase('processing')
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function handleReset() {
    clearInterval(pollRef.current)
    setPhase('idle')
    setFile(null)
    setError('')
    setStatementId(null)
    setFilename('')
  }

  if (phase === 'done') return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title-with-icon">
          <span className="page-title-icon" aria-hidden="true">📄</span>
          Upload bank statement
        </h1>
      </div>
      <div className="card flow-card">
        <InsightReady onReset={handleReset} />
      </div>
    </div>
  )

  if (phase === 'processing') return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title-with-icon">
          <span className="page-title-icon" aria-hidden="true">📄</span>
          Upload bank statement
        </h1>
      </div>
      <div className="card flow-card">
        <Processing filename={filename} onCancel={handleReset} />
      </div>
    </div>
  )

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
        <div className="step-content">
          <h2>Select Statement</h2>

          {!calmMode && (
            <div className="callout callout-info">
              <span className="callout-icon">📎</span>
              <div className="callout-body">
                <strong>Accepted files:</strong> PDF, JPG, PNG, WebP.
                <p>Processing usually takes <strong>30 to 60 seconds</strong> in the background.</p>
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

          {!calmMode && (
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
            {uploading ? 'Uploading…' : 'Upload & Analyse'}
          </button>

          {calmMode && <p className="chat-calm-note">Calm mode keeps one step here: choose a file, then upload.</p>}
        </div>
      </div>
    </div>
  )
}
