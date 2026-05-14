import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useApartment } from './context/ApartmentContext'
import { useAuth } from './context/AuthContext'
import { AppLayout } from './layouts/AppLayout'
import { ApartmentInfoPage } from './pages/ApartmentInfo'
import { DashboardPage } from './pages/Dashboard'
import { ExpensesPage } from './pages/Expenses'
import { LoginPage } from './pages/Login'
import { RegisterPage } from './pages/Register'
import { ResetPasswordPage } from './pages/ResetPassword'
import { RoommatesPage } from './pages/Roommates'
import { ShoppingPage } from './pages/Shopping'
import { TasksPage } from './pages/Tasks'
import { CreateApartmentPage } from './pages/CreateApartment'
import { JoinApartmentPage } from './pages/JoinApartment'
import { TicketDetailPage } from './pages/Tickets/Detail'
import { TicketsPage } from './pages/Tickets'
import { appRoutes } from './routes/paths'

function AuthLoadingScreen() {
  return (
    <div className="page page--loading">
      <div className="card auth-loading-card">
        <p>טוען את הדירה...</p>
      </div>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, isAuthReady } = useAuth()
  const { current } = useApartment()
  if (!isAuthReady) return <AuthLoadingScreen />
  if (!user) return <Navigate to={appRoutes.login} replace />
  if (user.apartment_id > 0 && current?.apartment.id !== user.apartment_id) {
    return <AuthLoadingScreen />
  }
  return children
}

function RoleGate({
  children,
  allowLandlord = false,
}: {
  children: ReactElement
  allowLandlord?: boolean
}) {
  const { user, isAuthReady } = useAuth()
  if (!isAuthReady) return <AuthLoadingScreen />
  if (!user) return <Navigate to={appRoutes.login} replace />
  if (user.role === 'landlord' && !allowLandlord) {
    return <Navigate to={appRoutes.tickets} replace />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path={appRoutes.login} element={<LoginPage />} />
      <Route path={appRoutes.register} element={<RegisterPage />} />
      <Route path={appRoutes.resetPassword} element={<ResetPasswordPage />} />
      <Route path={appRoutes.createApartment} element={<CreateApartmentPage />} />
      <Route path={appRoutes.joinApartment} element={<JoinApartmentPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route
          path={appRoutes.dashboard}
          element={
            <RoleGate>
              <DashboardPage />
            </RoleGate>
          }
        />
        <Route
          path={appRoutes.expenses}
          element={
            <RoleGate>
              <ExpensesPage />
            </RoleGate>
          }
        />
        <Route
          path={appRoutes.payments}
          element={<Navigate to={appRoutes.expenses} replace />}
        />
        <Route
          path={appRoutes.tasks}
          element={
            <RoleGate>
              <TasksPage />
            </RoleGate>
          }
        />
        <Route
          path={appRoutes.shopping}
          element={
            <RoleGate>
              <ShoppingPage />
            </RoleGate>
          }
        />
        <Route
          path={appRoutes.tickets}
          element={
            <RoleGate allowLandlord>
              <TicketsPage />
            </RoleGate>
          }
        />
        <Route
          path="/tickets/:id"
          element={
            <RoleGate allowLandlord>
              <TicketDetailPage />
            </RoleGate>
          }
        />
        <Route
          path={appRoutes.roommates}
          element={
            <RoleGate allowLandlord>
              <RoommatesPage />
            </RoleGate>
          }
        />
        <Route
          path={appRoutes.apartmentInfo}
          element={
            <RoleGate allowLandlord>
              <ApartmentInfoPage />
            </RoleGate>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to={appRoutes.dashboard} replace />} />
    </Routes>
  )
}
