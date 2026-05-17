import { useMemo, useState, type FormEvent } from 'react'
import { useApartment } from '../context/ApartmentContext'
import { useAuth } from '../context/AuthContext'
import { useExpenses } from '../context/ExpensesContext'
import { useTasks } from '../context/TasksContext'
import { useTickets } from '../context/TicketsContext'
import { useShoppingItemsStore } from '../data/repositories/shoppingRepository'
import type { TaskStatus, TaskType, TicketCategory } from '../types/models'

interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

type AgentActionType =
  | 'create_task'
  | 'update_task_due_date'
  | 'update_task_status'
  | 'create_expense'
  | 'create_shopping_item'
  | 'create_ticket'

interface AgentAction {
  type: AgentActionType
  payload: Record<string, unknown>
}

function compactText(value: string | null | undefined, fallback: string | null = '') {
  return value?.trim() || fallback || ''
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function normalizeDate(value: unknown) {
  const text = asString(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 10)
}

const agentActionTypes: AgentActionType[] = [
  'create_task',
  'update_task_due_date',
  'update_task_status',
  'create_expense',
  'create_shopping_item',
  'create_ticket',
]

function normalizeAgentAction(value: unknown): AgentAction | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { type?: unknown; payload?: unknown }
  if (
    typeof candidate.type === 'string' &&
    agentActionTypes.includes(candidate.type as AgentActionType) &&
    candidate.payload &&
    typeof candidate.payload === 'object'
  ) {
    return {
      type: candidate.type as AgentActionType,
      payload: candidate.payload as Record<string, unknown>,
    }
  }

  const entries = Object.entries(value as Record<string, unknown>)
  const actionEntry = entries.find(([key]) => agentActionTypes.includes(key as AgentActionType))
  if (actionEntry && actionEntry[1] && typeof actionEntry[1] === 'object') {
    return {
      type: actionEntry[0] as AgentActionType,
      payload: actionEntry[1] as Record<string, unknown>,
    }
  }

  return null
}

function ticketCategoryFromAction(value: unknown): TicketCategory {
  const category = asString(value)
  if (category === 'request') return 'בקשה' as TicketCategory
  if (category === 'finance') return 'כספים' as TicketCategory
  if (category === 'other') return 'אחר' as TicketCategory
  return 'תקלה' as TicketCategory
}

function taskTypeFromAction(value: unknown): TaskType {
  const type = asString(value)
  if (['cleaning', 'maintenance', 'shopping', 'inspection', 'other'].includes(type)) {
    return type as TaskType
  }
  return 'other'
}

function taskStatusFromAction(value: unknown): TaskStatus {
  const status = asString(value)
  if (['open', 'in_progress', 'done', 'cancelled'].includes(status)) {
    return status as TaskStatus
  }
  return 'open'
}

export function AIAgentChat() {
  const { user } = useAuth()
  const { current } = useApartment()
  const { tasks, addTask, updateTask } = useTasks()
  const { expenses, payments, addExpense } = useExpenses()
  const { tickets, addTicket } = useTickets()
  const [shoppingItems, setShoppingItems] = useShoppingItemsStore()
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      role: 'assistant',
      content:
        'היי, אני עוזר הדירה. אפשר לבקש ממני מידע, וגם לבקש שאכין פעולה כמו יצירת מטלה או הוצאה. אני אבקש אישור לפני ביצוע.',
    },
  ])
  const [pendingAction, setPendingAction] = useState<AgentAction | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')

  const apartmentId = current?.apartment.id ?? 0
  const activeRoommates = useMemo(
    () => (current?.roommates ?? []).filter((roommate) => roommate.status === 'active'),
    [current],
  )
  const defaultActorId = user?.id ?? activeRoommates[0]?.id ?? 0

  const agentContext = useMemo(() => {
    const scopedTasks = tasks
      .filter((task) => task.apartment_id === apartmentId)
      .slice(0, 30)
      .map((task) => ({
        id: task.id,
        title: task.title,
        type: task.task_type,
        item: task.target_item_name,
        description: task.description,
        dueDate: task.due_date,
        status: task.status,
      }))
    const scopedExpenses = expenses
      .filter((expense) => expense.apartment_id === apartmentId && expense.status === 'active')
      .slice(0, 20)
      .map((expense) => ({
        id: expense.id,
        description: expense.description,
        amount: expense.amount,
        category: expense.category,
        date: expense.date,
      }))
    const scopedPayments = payments
      .filter((payment) => payment.apartment_id === apartmentId && payment.status === 'recorded')
      .slice(0, 20)
      .map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        note: payment.note,
        date: payment.created_at,
      }))
    const scopedTickets = tickets
      .filter((ticket) => ticket.apartment_id === apartmentId)
      .slice(0, 20)
      .map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        category: ticket.category,
        status: ticket.status,
        createdAt: ticket.created_at,
      }))
    const scopedShoppingItems = shoppingItems
      .filter((item) => (item.apartment_id ?? apartmentId) === apartmentId)
      .slice(0, 25)
      .map((item) => ({
        id: item.id,
        name: item.item_name,
        quantity: item.quantity,
        category: item.category,
        status: item.status,
        createdAt: item.created_at,
        purchasedAt: item.purchased_at,
      }))

    return {
      today: new Date().toISOString().slice(0, 10),
      user: user ? { id: user.id, name: user.name, role: user.role } : null,
      apartment: current?.apartment.name,
      roommates: activeRoommates.map((roommate) => ({
        id: roommate.id,
        name: roommate.name,
        role: roommate.role,
        status: roommate.status,
      })),
      tasks: scopedTasks,
      expenses: scopedExpenses,
      payments: scopedPayments,
      tickets: scopedTickets,
      shoppingItems: scopedShoppingItems,
    }
  }, [
    activeRoommates,
    apartmentId,
    current,
    expenses,
    payments,
    shoppingItems,
    tasks,
    tickets,
    user,
  ])

  function findRoommateId(name: unknown) {
    const requestedName = asString(name)
    if (!requestedName) return defaultActorId
    return (
      activeRoommates.find((roommate) => roommate.name.includes(requestedName))?.id ??
      defaultActorId
    )
  }

  function findTask(action: AgentAction) {
    const taskId = asNumber(action.payload.taskId)
    const taskTitle = asString(action.payload.taskTitle)
    return tasks.find((task) => task.apartment_id === apartmentId && task.id === taskId) ??
      tasks.find(
        (task) =>
          task.apartment_id === apartmentId &&
          taskTitle &&
          task.title.includes(taskTitle),
      )
  }

  function describeAction(action: AgentAction) {
    const payload = action.payload
    if (action.type === 'create_task') {
      return `יצירת מטלה: ${asString(payload.title) || asString(payload.targetItemName)}`
    }
    if (action.type === 'update_task_due_date') {
      return `דחיית/עדכון תאריך למטלה: ${asString(payload.taskTitle) || `#${asString(payload.taskId)}`}`
    }
    if (action.type === 'update_task_status') {
      return `עדכון סטטוס למטלה: ${asString(payload.taskTitle) || `#${asString(payload.taskId)}`}`
    }
    if (action.type === 'create_expense') {
      return `יצירת הוצאה: ${asString(payload.description)} בסך ${asString(payload.amount)}`
    }
    if (action.type === 'create_shopping_item') {
      return `הוספת פריט קניות: ${asString(payload.itemName)}`
    }
    if (action.type === 'create_ticket') {
      return `פתיחת פנייה: ${asString(payload.title)}`
    }
    return 'פעולה באתר'
  }

  function executePendingAction() {
    if (!pendingAction || !current) return
    const payload = pendingAction.payload
    let resultMessage = ''

    if (pendingAction.type === 'create_task') {
      const taskType = taskTypeFromAction(payload.taskType)
      const targetItemName = compactText(asString(payload.targetItemName), 'אחר')
      const title =
        compactText(asString(payload.title)) ||
        `${taskType === 'maintenance' ? 'תחזוקה' : 'מטלה'} - ${targetItemName}`

      addTask({
        apartment_id: apartmentId,
        title,
        description: compactText(asString(payload.description), null) || null,
        task_type: taskType,
        target_item_id: null,
        target_item_name: targetItemName,
        assignee_id: findRoommateId(payload.assigneeName),
        due_date: normalizeDate(payload.dueDate),
        status: 'open',
        created_by: defaultActorId,
      })
      resultMessage = `בוצע: נוצרה מטלה חדשה בשם "${title}".`
    }

    if (pendingAction.type === 'update_task_due_date') {
      const task = findTask(pendingAction)
      if (!task) {
        resultMessage = 'לא מצאתי את המטלה לעדכון.'
      } else {
        updateTask(task.id, {
          title: task.title,
          description: task.description,
          task_type: task.task_type,
          target_item_id: task.target_item_id,
          target_item_name: task.target_item_name,
          assignee_id: task.assignee_id ?? defaultActorId,
          due_date: normalizeDate(payload.dueDate),
          status: task.status,
        })
        resultMessage = `בוצע: תאריך היעד של "${task.title}" עודכן.`
      }
    }

    if (pendingAction.type === 'update_task_status') {
      const task = findTask(pendingAction)
      if (!task) {
        resultMessage = 'לא מצאתי את המטלה לעדכון.'
      } else {
        updateTask(task.id, {
          title: task.title,
          description: task.description,
          task_type: task.task_type,
          target_item_id: task.target_item_id,
          target_item_name: task.target_item_name,
          assignee_id: task.assignee_id ?? defaultActorId,
          due_date: task.due_date ?? new Date().toISOString().slice(0, 10),
          status: taskStatusFromAction(payload.status),
        })
        resultMessage = `בוצע: הסטטוס של "${task.title}" עודכן.`
      }
    }

    if (pendingAction.type === 'create_expense') {
      const amount = asNumber(payload.amount)
      if (amount <= 0) {
        resultMessage = 'לא ניתן ליצור הוצאה בלי סכום תקין.'
      } else {
        const paidBy = findRoommateId(payload.paidByName)
        addExpense({
          apartment_id: apartmentId,
          paid_by: paidBy,
          amount: amount.toFixed(2),
          description: compactText(asString(payload.description), 'הוצאה חדשה'),
          category: compactText(asString(payload.category), null) || null,
          date: normalizeDate(payload.date),
          participant_ids: activeRoommates.length > 0 ? activeRoommates.map((roommate) => roommate.id) : [paidBy],
        })
        resultMessage = 'בוצע: ההוצאה נוספה לרשימת ההוצאות.'
      }
    }

    if (pendingAction.type === 'create_shopping_item') {
      const itemName = asString(payload.itemName)
      if (!itemName) {
        resultMessage = 'לא ניתן להוסיף פריט בלי שם.'
      } else {
        setShoppingItems((currentItems) => [
          {
            id: Math.max(...currentItems.map((item) => item.id), 0) + 1,
            apartment_id: apartmentId,
            shopping_list_id: apartmentId || 1,
            item_name: itemName,
            quantity: compactText(asString(payload.quantity), null) || null,
            category: compactText(asString(payload.category), null) || null,
            status: 'open',
            added_by: defaultActorId,
            purchased_by: null,
            created_at: new Date().toISOString().slice(0, 10),
            purchased_at: null,
          },
          ...currentItems,
        ])
        resultMessage = `בוצע: "${itemName}" נוסף לרשימת הקניות.`
      }
    }

    if (pendingAction.type === 'create_ticket') {
      const title = asString(payload.title)
      const description = asString(payload.description)
      if (!title || !description) {
        resultMessage = 'לא ניתן לפתוח פנייה בלי כותרת ותיאור.'
      } else {
        addTicket({
          title,
          description,
          category: ticketCategoryFromAction(payload.category),
          createdBy: defaultActorId,
          apartmentId,
          attachments: [],
        })
        resultMessage = `בוצע: נפתחה פנייה בשם "${title}".`
      }
    }

    setPendingAction(null)
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: 'assistant', content: resultMessage || 'הפעולה הסתיימה.' },
    ])
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = input.trim()
    if (!message || isSending) return

    setMessages((currentMessages) => [...currentMessages, { role: 'user', content: message }])
    setInput('')
    setError('')
    setPendingAction(null)
    setIsSending(true)

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: messages.slice(-8),
          context: agentContext,
        }),
      })
      const data = (await response.json()) as {
        reply?: string
        action?: unknown
        error?: string
      }

      if (!response.ok || data.error) {
        throw new Error(data.error || 'הסוכן לא הצליח לענות כרגע.')
      }

      const normalizedAction = normalizeAgentAction(data.action)
      if (normalizedAction) setPendingAction(normalizedAction)

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: 'assistant',
          content: compactText(data.reply, 'לא התקבלה תשובה מהסוכן.'),
        },
      ])
    } catch (requestError) {
      const messageText =
        requestError instanceof Error ? requestError.message : 'הסוכן לא הצליח לענות כרגע.'
      setError(messageText)
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: 'assistant',
          content: 'לא הצלחתי להתחבר ל-AI כרגע. בדוק שהשרת רץ ושהמפתח מוגדר ב-.env.',
        },
      ])
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className={`ai-agent${isOpen ? ' ai-agent--open' : ''}`}>
      {isOpen ? (
        <section className="ai-agent__panel" aria-label="סוכן AI">
          <header className="ai-agent__head">
            <div>
              <p>סוכן AI</p>
              <strong>עוזר הדירה</strong>
            </div>
            <button type="button" className="btn-text" onClick={() => setIsOpen(false)}>
              סגירה
            </button>
          </header>

          <div className="ai-agent__messages" role="log" aria-live="polite">
            {messages.map((messageItem, index) => (
              <div
                key={`${messageItem.role}-${index}`}
                className={`ai-agent__message ai-agent__message--${messageItem.role}`}
              >
                {messageItem.content}
              </div>
            ))}
            {isSending ? (
              <div className="ai-agent__message ai-agent__message--assistant">
                חושב על תשובה...
              </div>
            ) : null}
          </div>

          {pendingAction ? (
            <div className="ai-agent__pending">
              <span>פעולה מוצעת</span>
              <strong>{describeAction(pendingAction)}</strong>
              <div className="ai-agent__pending-actions">
                <button type="button" className="btn btn--secondary btn--small" onClick={() => setPendingAction(null)}>
                  ביטול
                </button>
                <button type="button" className="btn btn--primary btn--small" onClick={executePendingAction}>
                  בצע
                </button>
              </div>
            </div>
          ) : null}

          {error ? <p className="ai-agent__error">{error}</p> : null}

          <form className="ai-agent__form" onSubmit={submitMessage}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="כתוב לסוכן..."
              disabled={isSending}
            />
            <button type="submit" className="btn btn--primary btn--small" disabled={isSending || !input.trim()}>
              שלח
            </button>
          </form>
        </section>
      ) : null}

      <button type="button" className="ai-agent__toggle" onClick={() => setIsOpen((current) => !current)}>
        AI
      </button>
    </div>
  )
}
