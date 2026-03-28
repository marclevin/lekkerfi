import { Navigate, Route, Routes } from 'react-router-dom'
import BottomNav from './components/BottomNav'
import NavBar from './components/NavBar'
import ProtectedRoute from './components/ProtectedRoute'
import { useAuth } from './context/AuthContext'
import Chat from './pages/Chat'
import Connect from './pages/Connect'
import Flow from './pages/Flow'
import History from './pages/History'
import Home from './pages/Home'
import Insights from './pages/Insights'
import Login from './pages/Login'
import Register from './pages/Register'
import Upload from './pages/Upload'

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return null
  return <Navigate to={user ? '/home' : '/login'} replace />
}

export default function App() {
  const { user } = useAuth()

  return (
    <>
      <NavBar />
      <main className={`main-content${user ? ' has-bottom-nav' : ''}`}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/home"    element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/flow"    element={<ProtectedRoute><Flow /></ProtectedRoute>} />
          <Route path="/upload"  element={<ProtectedRoute><Upload /></ProtectedRoute>} />
          <Route path="/insights" element={<ProtectedRoute><Insights /></ProtectedRoute>} />
          <Route path="/chat"    element={<ProtectedRoute><Chat /></ProtectedRoute>} />
          <Route path="/connect" element={<ProtectedRoute><Connect /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </>
  )
}
