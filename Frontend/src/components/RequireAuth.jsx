import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../store/authStore'

/** Pages for members only (trip planner, saved trips). Guests are sent to login and come back afterwards. */
export default function RequireAuth({ children }) {
  const token = useAuth((s) => s.token)
  const loc = useLocation()
  if (!token) return <Navigate to={`/login?redirect=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return children
}
