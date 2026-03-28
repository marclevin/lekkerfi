import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function NavBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const initials = user?.email?.[0]?.toUpperCase() ?? '?'

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">LekkerFi</Link>

      {user && (
        <div className="navbar-actions">
          <div className="user-avatar" title={user.email}>{initials}</div>
          <span className="nav-user">{user.email}</span>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Log out</button>
        </div>
      )}
    </nav>
  )
}
