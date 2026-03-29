import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchProfilePictureUrl } from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function NavBar({ showReadAloudIcon = false, onOpenReadAloud }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [profilePictureUrl, setProfilePictureUrl] = useState(null)

  useEffect(() => {
    if (!user?.id) return

    const loadPicture = async () => {
      const url = await fetchProfilePictureUrl()
      setProfilePictureUrl(url)
    }

    loadPicture()

    return () => {
      if (profilePictureUrl) {
        URL.revokeObjectURL(profilePictureUrl)
      }
    }
  }, [user?.id])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const displayName = user?.full_name || user?.email || ''
  const initials = displayName[0]?.toUpperCase() ?? '?'
  const isSupporter = user?.role === 'supporter'

  return (
    <nav className="navbar" aria-label="Top navigation">
      <Link to="/" className="navbar-brand" aria-label="Go to home">LekkerFi</Link>

      {user && (
        <div className="navbar-actions">
          {showReadAloudIcon && (
            <button
              type="button"
              className="navbar-help-icon"
              onClick={onOpenReadAloud}
              aria-label="Open read aloud"
              title="Read aloud"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" aria-hidden="true">
                <path d="M9 1a1 1 0 00-1.6-.8L4.3 3.5H2a1 1 0 00-1 1v7a1 1 0 001 1h2.3l3.1 2.3A1 1 0 009 14V1zM11.5 4.5a.5.5 0 01.5.5v6a.5.5 0 01-1 0V5a.5.5 0 01.5-.5zM13.5 2.5a.5.5 0 01.5.5v10a.5.5 0 01-1 0V3a.5.5 0 01.5-.5z"/>
              </svg>
            </button>
          )}
          {!isSupporter && (
            <>
              <Link to="/profile" className="user-avatar" title={`${user.email} — Edit profile`} aria-label="Open profile settings">
                {profilePictureUrl ? (
                  <img src={profilePictureUrl} alt="Profile" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  initials
                )}
              </Link>
              <div className="nav-user-info">
                <span className="nav-user">{user.full_name || user.email?.split('@')[0]}</span>
              </div>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleLogout} aria-label="Log out of your account">Log out</button>
        </div>
      )}
    </nav>
  )
}
