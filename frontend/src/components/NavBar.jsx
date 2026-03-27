import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function NavBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">
        LekkerFi
      </Link>
      {user && (
        <div className="navbar-right">
          <Link to="/flow" className="nav-link">
            Flow
          </Link>
          <Link to="/insights" className="nav-link">
            Insights
          </Link>
          <span className="nav-user">{user.email}</span>
          <button className="btn btn-ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      )}
    </nav>
  )
}
