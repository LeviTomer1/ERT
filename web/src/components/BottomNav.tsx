import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { appRoutes } from '../routes/paths'

const links: { to: string; label: string; end?: boolean }[] = [
  { to: appRoutes.dashboard, label: 'בית', end: true },
  { to: appRoutes.expenses, label: 'כספים' },
  { to: appRoutes.tasks, label: 'מטלות' },
  { to: appRoutes.shopping, label: 'קניות' },
  { to: appRoutes.tickets, label: 'פניות' },
]

export function BottomNav() {
  const { user } = useAuth()
  const visibleLinks =
    user?.role === 'landlord' ? links.filter((link) => link.to === appRoutes.tickets) : links

  return (
    <nav className="bottom-nav" aria-label="ניווט ראשי">
      {visibleLinks.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end === true}
          className={({ isActive }) =>
            `bottom-nav__link${isActive ? ' bottom-nav__link--active' : ''}`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
