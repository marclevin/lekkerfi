import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supporterUploadStatement } from '../api/client'

const LANGUAGES = [
  { value: 'english',   label: 'English' },
  { value: 'xhosa',     label: 'isiXhosa' },
  { value: 'zulu',      label: 'isiZulu' },
  { value: 'afrikaans', label: 'Afrikaans' },
  { value: 'sotho',     label: 'Sesotho' },
]

export default function SupporterBankingFlow() {
  const { userId } = useParams()
  const fileInputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [language, setLanguage] = useState('english')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

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
      await supporterUploadStatement(Number(userId), file, language)
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function handleReset() {
    setDone(false)
    setFile(null)
    setError('')
  }

  return (
    <div className="page supporter-dashboard-page">
      <div className="page-header supporter-header">
        <div>
          <Link to={`/supporter/users/${userId}`} className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }}>
            ← Back to user page
          </Link>
          <h1>Upload Statement</h1>
          <p>Upload and store a bank statement on behalf of this user.</p>
        </div>
      </div>

      <nav className="supporter-page-nav" aria-label="Supporter sections">
        <Link className="supporter-page-link" to="/supporter">Overview</Link>
        <Link className="supporter-page-link" to="/supporter/users">Manage users</Link>
        <Link className="supporter-page-link" to="/supporter/alerts">Alerts</Link>
      </nav>

      <div className="card flow-card">
        {done ? (
          <div className="step-content">
            <h2>Statement uploaded</h2>
            <div className="callout callout-success">
              <span className="callout-icon">✅</span>
              <div className="callout-body">
                The statement file is saved and linked to this user's account. Analysis was not started.
              </div>
            </div>
            <div className="insight-actions">
              <Link to={`/supporter/users/${userId}`} className="btn btn-primary">
                Back to user page
              </Link>
              <button className="btn btn-ghost" onClick={handleReset}>
                Upload another
              </button>
            </div>
          </div>
        ) : (
          <div className="step-content">
            <h2>Select Statement File</h2>

            <div className="callout callout-info">
              <span className="callout-icon">📎</span>
              <div className="callout-body">
                <strong>Accepted files:</strong> PDF, JPG, PNG, WebP.
                <p>This action stores the statement only. It does not generate an insight.</p>
              </div>
            </div>

            <button
              type="button"
              className={`upload-zone ${file ? 'has-file' : ''} ${dragging ? 'dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              aria-label="Upload file area. Click to browse or drag a file here"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
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

            <div className="form-group" style={{ maxWidth: 280, marginTop: 12 }}>
              <label htmlFor="banking-lang">Preferred analysis language (optional)</label>
              <select
                id="banking-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>

            {error && <div className="alert alert-error" role="alert">{error}</div>}

            <button
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={!file || uploading}
            >
              {uploading ? 'Uploading statement…' : 'Upload statement only'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
