import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../store/authStore'
import { EmptyState } from './States'

/** Admin-only pages. Guests go to login; signed-in non-admins see a 403 message.
 *  (The backend checks the role on every /api/admin call - this only hides the UI.) */
export default function RequireAdmin({ children }) {
  const token = useAuth((s) => s.token)
  const user = useAuth((s) => s.user)
  const loc = useLocation()
  if (!token) return <Navigate to={`/login?redirect=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (user?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20">
        <EmptyState
          title="หน้านี้สำหรับผู้ดูแลระบบเท่านั้น"
          action={<Link to="/" className="rounded-full bg-forest px-5 py-2.5 text-sm font-medium text-white">กลับหน้าแรก</Link>}
        >
          บัญชีของคุณยังไม่มีสิทธิ์ผู้ดูแลระบบ
        </EmptyState>
      </div>
    )
  }
  return children
}
