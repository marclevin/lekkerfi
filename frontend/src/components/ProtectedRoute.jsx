import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, allowedRoles = null }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="page-center">
        <span className="spinner" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (Array.isArray(allowedRoles) && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === 'supporter' ? '/supporter' : '/home'} replace />
  }

  return children
}
