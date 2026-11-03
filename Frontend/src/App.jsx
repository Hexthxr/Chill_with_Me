import { useEffect, useRef } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import { EmptyState } from './components/States'
import Account from './pages/Account'
import ForgotPassword from './pages/ForgotPassword'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import PlaceDetail from './pages/PlaceDetail'
import Planner from './pages/Planner'
import Recommend from './pages/Recommend'
import TripDetails from './pages/TripDetails'
import Trips from './pages/Trips'
import { useAuth } from './store/authStore'
import { useTrip } from './store/tripStore'

function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20">
      <EmptyState title="ไม่พบหน้านี้" action={<Link to="/" className="rounded-full bg-forest px-5 py-2.5 text-sm font-medium text-white">กลับหน้าแรก</Link>} />
    </div>
  )
}

/** The trip draft is stored in the browser - drop it when the user logs out or another account logs in. */
function useResetDraftOnUserChange() {
  const uid = useAuth((s) => s.user?.id ?? null)
  const prev = useRef(uid)
  useEffect(() => {
    if (prev.current !== uid && prev.current !== null) useTrip.getState().reset()
    prev.current = uid
  }, [uid])
}

const member = (el) => <RequireAuth>{el}</RequireAuth>

export default function App() {
  useResetDraftOnUserChange()
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="recommend" element={<Recommend />} />
        <Route path="place/:id" element={<PlaceDetail />} />
        <Route path="planner" element={member(<Planner />)} />
        <Route path="planner/:id" element={member(<Planner />)} />
        <Route path="trips" element={member(<Trips />)} />
        <Route path="trips/:id" element={member(<TripDetails />)} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="account" element={<Account />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
