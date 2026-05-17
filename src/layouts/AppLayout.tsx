import { NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import { AIAgentChat } from '../components/AIAgentChat'
import { BottomNav } from '../components/BottomNav'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useAuth } from '../context/AuthContext'
import { appRoutes } from '../routes/paths'
import { useApartment } from '../context/ApartmentContext'
import { resetDemoStorage } from '../utils/storage'
import logoUrl from '../assets/logo.png'

export function AppLayout() {
  const { user, logout } = useAuth()
  const { current } = useApartment()
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)
  const apartmentName = current?.apartment.name ?? 'הדירה המשותפת'

  function confirmResetDemoData() {
    resetDemoStorage()
    window.location.reload()
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar__brand">
          <img className="top-bar__logo" src={logoUrl} alt="ERT" />
          <div className="top-bar__titles">
            <span className="top-bar__apt">{apartmentName}</span>
            {user && <span className="top-bar__user">שלום, {user.name}</span>}
          </div>
        </div>
        <div className="top-bar__actions">
          {user ? (
            <>
              <NavLink
                to={appRoutes.roommates}
                end
                className={({ isActive }) =>
                  `link-quiet${isActive ? ' link-quiet--active' : ''}`
                }
              >
                דיירים
              </NavLink>
              <NavLink
                to={appRoutes.apartmentInfo}
                className={({ isActive }) =>
                  `link-quiet${isActive ? ' link-quiet--active' : ''}`
                }
              >
                מידע כללי
              </NavLink>
            </>
          ) : null}
          <button
            type="button"
            className="btn-text"
            onClick={() => setIsResetConfirmOpen(true)}
          >
            איפוס דמו
          </button>
          <button type="button" className="btn-text" onClick={logout}>
            יציאה
          </button>
        </div>
      </header>

      <main className="main-scroll">
        <div className="page-shell">
          <Outlet />
        </div>
      </main>

      <BottomNav />
      <AIAgentChat />

      {isResetConfirmOpen ? (
        <ConfirmDialog
          title="לאפס את נתוני הדמו?"
          message="כל הנתונים שנשמרו בדפדפן יימחקו והמערכת תחזור לנקודת התחלה נקייה."
          confirmLabel="כן, לאפס"
          cancelLabel="ביטול"
          onCancel={() => setIsResetConfirmOpen(false)}
          onConfirm={confirmResetDemoData}
        />
      ) : null}
    </div>
  )
}
