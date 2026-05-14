import { Link } from 'react-router-dom'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { useExpenses } from '../../context/ExpensesContext'
import { useShopping } from '../../context/ShoppingContext'
import { isTaskIncomplete, useTasks } from '../../context/TasksContext'
import { useTickets } from '../../context/TicketsContext'
import { appRoutes } from '../../routes/paths'
import type { User } from '../../types/models'

function ExpensesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3v18M8 7.5h6.2a2.8 2.8 0 0 1 0 5.6H9.8a2.8 2.8 0 1 0 0 5.6H16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TasksIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 6h10M9 12h10M9 18h10M5.5 5.5l.8.8 1.7-1.9M5.5 11.5l.8.8 1.7-1.9M5.5 17.5l.8.8 1.7-1.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ShoppingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 5h2l2.1 9.2a1 1 0 0 0 1 .8h7.8a1 1 0 0 0 1-.8L20 8H7M10 19a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TicketsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 10h8M8 14h5m-5 6 3.5-3H18a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function formatActivityDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'numeric',
  }).format(date)
}

type ActivityTone = 'warning' | 'success' | 'neutral'

export function DashboardPage() {
  const { user } = useAuth()
  const { current } = useApartment()
  const { tasks } = useTasks()
  const { expenses, payments } = useExpenses()
  const { tickets } = useTickets()
  const { items: shoppingItems } = useShopping()

  const apartmentId = current?.apartment.id ?? 0
  const apartmentUsers = [
    current?.adminUser,
    ...(current?.roommates ?? []),
    current?.landlordUser,
  ].filter((member): member is User => Boolean(member))

  const userNameById = new Map(
    apartmentUsers.map((member) => [member.id, member.name]),
  )

  const getUserName = (userId: number | null | undefined) => {
    if (userId == null) return 'אחד הדיירים'
    return userNameById.get(userId) ?? 'אחד הדיירים'
  }

  const apartmentTasks = tasks.filter((task) => task.apartment_id === apartmentId)
  const myOpenTasks = apartmentTasks.filter(
    (task) => task.assignee_id === user?.id && isTaskIncomplete(task),
  )
  const apartmentExpenses = expenses.filter(
    (expense) => expense.apartment_id === apartmentId && expense.status === 'active',
  )
  const apartmentPayments = payments.filter(
    (payment) => payment.apartment_id === apartmentId && payment.status === 'recorded',
  )
  const apartmentTickets = tickets.filter((ticket) => ticket.apartment_id === apartmentId)
  const openTickets = apartmentTickets.filter(
    (ticket) => ticket.status !== 'closed' && ticket.status !== 'cancelled',
  )
  const apartmentShoppingItems = shoppingItems.filter(
    (item) => (item.apartment_id ?? apartmentId) === apartmentId,
  )
  const openShopping = apartmentShoppingItems.filter((item) => item.status === 'open')
  const thisMonth = new Date().toISOString().slice(0, 7)
  const expensesThisMonth = apartmentExpenses.filter((expense) => expense.date.startsWith(thisMonth))

  const modules = [
    {
      to: appRoutes.expenses,
      title: 'כספים',
      status:
        expensesThisMonth.length > 0
          ? `${expensesThisMonth.length} הוצאות החודש`
          : apartmentPayments.length > 0
            ? `${apartmentPayments.length} תשלומים נרשמו`
            : 'מאוזן כרגע',
      tone: 'blue',
      icon: <ExpensesIcon />,
    },
    {
      to: appRoutes.tasks,
      title: 'משימות',
      status:
        myOpenTasks.length > 0
          ? `יש לך ${myOpenTasks.length} פתוחות`
          : 'אין פתוחות',
      tone: 'green',
      icon: <TasksIcon />,
    },
    {
      to: appRoutes.shopping,
      title: 'קניות',
      status: openShopping.length > 0 ? `${openShopping.length} פריטים` : 'אין כרגע',
      tone: 'orange',
      icon: <ShoppingIcon />,
    },
    {
      to: appRoutes.tickets,
      title: 'פניות',
      status: openTickets.length > 0 ? `${openTickets.length} פתוחות` : 'שקט כרגע',
      tone: 'red',
      icon: <TicketsIcon />,
    },
  ]

  const recentActivity: Array<{
    id: string
    date: string
    tone: ActivityTone
    text: string
    meta: string
  }> = [
    ...apartmentPayments.map((payment) => ({
      id: `payment-${payment.id}`,
      date: payment.created_at,
      tone: 'warning' as const,
      text: `${getUserName(payment.payer_id)} רשם תשלום ל־${getUserName(payment.payee_id)}`,
      meta: formatActivityDate(payment.created_at),
    })),
    ...apartmentExpenses.map((expense) => ({
      id: `expense-${expense.id}`,
      date: expense.date,
      tone: 'success' as const,
      text: `${getUserName(expense.paid_by)} הוסיף הוצאה חדשה - ${expense.description}`,
      meta: formatActivityDate(expense.date),
    })),
    ...openTickets.map((ticket) => ({
      id: `ticket-${ticket.id}`,
      date: ticket.created_at,
      tone: 'neutral' as const,
      text: `נפתחה פנייה חדשה - ${ticket.title}`,
      meta: formatActivityDate(ticket.created_at),
    })),
    ...apartmentShoppingItems.map((item) => ({
      id: `shopping-${item.id}`,
      date: item.purchased_at ?? item.created_at,
      tone: item.status === 'purchased' ? ('success' as const) : ('neutral' as const),
      text:
        item.status === 'purchased'
          ? `${getUserName(item.purchased_by)} סימן כנקנה - ${item.item_name}`
          : `${getUserName(item.added_by)} הוסיף לקניות - ${item.item_name}`,
      meta: formatActivityDate(item.purchased_at ?? item.created_at),
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3)

  return (
    <div className="page dashboard-home dashboard-home--figma">
      <section className="dashboard-section">
        <h2 className="dashboard-section__title">ניהול הדירה</h2>
        <div className="dashboard-tiles">
          {modules.map((module) => (
            <Link
              key={module.to}
              to={module.to}
              className={`dashboard-tile dashboard-tile--${module.tone}`}
            >
              <span className="dashboard-tile__badge" aria-hidden="true">
                {module.icon}
              </span>
              <span className="dashboard-tile__content">
                <span className="dashboard-tile__title">{module.title}</span>
                <span className="dashboard-tile__status">{module.status}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="dashboard-section dashboard-section--updates">
        <h2 className="dashboard-section__title">פעילות אחרונה</h2>
        <div className="home-updates home-updates--figma">
          {recentActivity.length === 0 ? (
            <div className="home-updates__item home-updates__item--neutral">
              <div className="home-updates__content">
                <div className="home-updates__text">עדיין אין פעילות אחרונה להצגה.</div>
              </div>
              <span className="home-updates__pill" aria-hidden="true" />
            </div>
          ) : (
            recentActivity.map((item) => (
              <div
                key={item.id}
                className={`home-updates__item home-updates__item--${item.tone}`}
              >
                <div className="home-updates__content">
                  <div className="home-updates__text">{item.text}</div>
                  <div className="home-updates__meta">{item.meta}</div>
                </div>
                <span className="home-updates__pill" aria-hidden="true" />
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
