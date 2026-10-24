import { Link, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
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

function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20">
      <EmptyState title="ไม่พบหน้านี้" action={<Link to="/" className="rounded-full bg-forest px-5 py-2.5 text-sm font-medium text-white">กลับหน้าแรก</Link>} />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="recommend" element={<Recommend />} />
        <Route path="place/:id" element={<PlaceDetail />} />
        <Route path="planner" element={<Planner />} />
        <Route path="planner/:id" element={<Planner />} />
        <Route path="trips" element={<Trips />} />
        <Route path="trips/:id" element={<TripDetails />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="account" element={<Account />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
