import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function NavBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

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
          {!isSupporter && (
            <>
              <Link to="/profile" className="user-avatar" title={`${user.email} — Edit profile`} aria-label="Open profile settings">
                {initials}
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
