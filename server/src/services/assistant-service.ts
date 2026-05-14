import type { AuthAccount } from '../types/auth.js'
import { getApartmentStateSnapshot } from './apartment-service.js'
import { listApartmentInfoItemsByApartmentId } from './apartment-info-service.js'
import { listExpensesByApartmentId, listPaymentsByApartmentId } from './finance-service.js'
import { listShoppingItemsByApartmentId } from './shopping-service.js'
import { listTasksByApartmentId } from './task-service.js'
import { listTicketsByApartmentId } from './ticket-service.js'

type ApartmentStateSnapshot = Awaited<ReturnType<typeof getApartmentStateSnapshot>>
type Expense = Awaited<ReturnType<typeof listExpensesByApartmentId>>[number]
type Payment = Awaited<ReturnType<typeof listPaymentsByApartmentId>>[number]
type Task = Awaited<ReturnType<typeof listTasksByApartmentId>>[number]
type ShoppingItem = Awaited<ReturnType<typeof listShoppingItemsByApartmentId>>[number]
type Ticket = Awaited<ReturnType<typeof listTicketsByApartmentId>>[number]
type ApartmentInfoItem = Awaited<ReturnType<typeof listApartmentInfoItemsByApartmentId>>[number]

export interface AssistantContextSnapshot {
  apartment: {
    id: number
    name: string
  }
  roommatesCount: number
  openTasksCount: number
  openShoppingItemsCount: number
  openTicketsCount: number
  recentExpensesCount: number
  recentPaymentsCount: number
  apartmentInfoCount: number
  shoppingItems: Array<{
    id: number
    itemName: string
    quantity: string | null
    status: string
  }>
  debts: Array<{
    fromName: string
    toName: string
    amount: number
  }>
}

interface AssistantData {
  apartmentState: ApartmentStateSnapshot
  tasks: Task[]
  shoppingItems: ShoppingItem[]
  tickets: Ticket[]
  expenses: Expense[]
  payments: Payment[]
  apartmentInfoItems: ApartmentInfoItem[]
}

interface DebtLine {
  toAccountId: number
  toName: string
  amount: number
}

interface ExpenseReason {
  expenseId: number
  paidByAccountId: number
  paidByName: string
  description: string
  category: string | null
  date: string
  totalAmount: number
  participantCount: number
  yourShare: number
}

function money(amount: number) {
  return `${amount.toFixed(2)} ש"ח`
}

function formatDate(date: string | null | undefined) {
  if (!date) return 'ללא תאריך'
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date))
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function userNameById(apartmentState: ApartmentStateSnapshot) {
  return new Map(apartmentState.users.map((user) => [user.id, user.name]))
}

function buildDebtSummary(
  apartmentState: ApartmentStateSnapshot,
  expenses: Expense[],
  payments: Payment[],
) {
  const userNames = userNameById(apartmentState)
  const balances = new Map<number, number>()

  for (const user of apartmentState.users) {
    balances.set(user.id, 0)
  }

  for (const expense of expenses.filter((item) => item.status === 'active')) {
    const amount = Number(expense.amount)
    const participants = expense.participantAccountIds.length
      ? expense.participantAccountIds
      : apartmentState.users.map((user) => user.id)

    if (!participants.length || !Number.isFinite(amount)) continue

    const share = amount / participants.length
    balances.set(expense.paidByAccountId, (balances.get(expense.paidByAccountId) ?? 0) + amount)

    for (const participantId of participants) {
      balances.set(participantId, (balances.get(participantId) ?? 0) - share)
    }
  }

  for (const payment of payments.filter((item) => item.status === 'recorded')) {
    const amount = Number(payment.amount)
    if (!Number.isFinite(amount)) continue

    balances.set(payment.payerAccountId, (balances.get(payment.payerAccountId) ?? 0) + amount)
    balances.set(payment.payeeAccountId, (balances.get(payment.payeeAccountId) ?? 0) - amount)
  }

  const debtors = [...balances.entries()]
    .filter(([, balance]) => balance < -0.01)
    .map(([accountId, balance]) => ({ accountId, amount: Math.abs(balance) }))
    .sort((left, right) => right.amount - left.amount)

  const creditors = [...balances.entries()]
    .filter(([, balance]) => balance > 0.01)
    .map(([accountId, balance]) => ({ accountId, amount: balance }))
    .sort((left, right) => right.amount - left.amount)

  const debts: AssistantContextSnapshot['debts'] = []

  for (const debtor of debtors) {
    let remaining = debtor.amount

    for (const creditor of creditors) {
      if (remaining <= 0.01 || creditor.amount <= 0.01) continue

      const transfer = Math.min(remaining, creditor.amount)
      debts.push({
        fromName: userNames.get(debtor.accountId) ?? `#${debtor.accountId}`,
        toName: userNames.get(creditor.accountId) ?? `#${creditor.accountId}`,
        amount: Number(transfer.toFixed(2)),
      })

      remaining -= transfer
      creditor.amount -= transfer
    }
  }

  return debts
}

function buildPersonalDebtLines(data: AssistantData, accountId: number) {
  const userNames = userNameById(data.apartmentState)
  const balances = new Map<number, number>()
  const reasons: ExpenseReason[] = []

  for (const user of data.apartmentState.users) {
    if (user.id !== accountId) balances.set(user.id, 0)
  }

  for (const expense of data.expenses.filter((item) => item.status === 'active')) {
    const amount = Number(expense.amount)
    const participants = expense.participantAccountIds.length
      ? expense.participantAccountIds
      : data.apartmentState.users.map((user) => user.id)

    if (!Number.isFinite(amount) || !participants.includes(accountId)) continue

    const share = amount / participants.length
    if (expense.paidByAccountId !== accountId) {
      balances.set(expense.paidByAccountId, (balances.get(expense.paidByAccountId) ?? 0) - share)
      reasons.push({
        expenseId: expense.id,
        paidByAccountId: expense.paidByAccountId,
        paidByName: userNames.get(expense.paidByAccountId) ?? `#${expense.paidByAccountId}`,
        description: expense.description,
        category: expense.category,
        date: expense.date,
        totalAmount: amount,
        participantCount: participants.length,
        yourShare: share,
      })
    } else {
      for (const participantId of participants.filter((id) => id !== accountId)) {
        balances.set(participantId, (balances.get(participantId) ?? 0) + share)
      }
    }
  }

  for (const payment of data.payments.filter((item) => item.status === 'recorded')) {
    const amount = Number(payment.amount)
    if (!Number.isFinite(amount)) continue

    if (payment.payerAccountId === accountId) {
      balances.set(payment.payeeAccountId, (balances.get(payment.payeeAccountId) ?? 0) + amount)
    }

    if (payment.payeeAccountId === accountId) {
      balances.set(payment.payerAccountId, (balances.get(payment.payerAccountId) ?? 0) - amount)
    }
  }

  const debts: DebtLine[] = [...balances.entries()]
    .filter(([, balance]) => balance < -0.01)
    .map(([toAccountId, balance]) => ({
      toAccountId,
      toName: userNames.get(toAccountId) ?? `#${toAccountId}`,
      amount: Number(Math.abs(balance).toFixed(2)),
    }))
    .sort((left, right) => right.amount - left.amount)

  const credits: DebtLine[] = [...balances.entries()]
    .filter(([, balance]) => balance > 0.01)
    .map(([toAccountId, balance]) => ({
      toAccountId,
      toName: userNames.get(toAccountId) ?? `#${toAccountId}`,
      amount: Number(balance.toFixed(2)),
    }))
    .sort((left, right) => right.amount - left.amount)

  return { debts, credits, reasons }
}

async function loadAssistantData(apartmentId: number): Promise<AssistantData> {
  const [
    apartmentState,
    tasks,
    shoppingItems,
    tickets,
    expenses,
    payments,
    apartmentInfoItems,
  ] = await Promise.all([
    getApartmentStateSnapshot(apartmentId),
    listTasksByApartmentId(apartmentId),
    listShoppingItemsByApartmentId(apartmentId),
    listTicketsByApartmentId(apartmentId),
    listExpensesByApartmentId(apartmentId),
    listPaymentsByApartmentId(apartmentId),
    listApartmentInfoItemsByApartmentId(apartmentId),
  ])

  return {
    apartmentState,
    tasks,
    shoppingItems,
    tickets,
    expenses,
    payments,
    apartmentInfoItems,
  }
}

function buildSnapshot(data: AssistantData): AssistantContextSnapshot {
  const debts = buildDebtSummary(data.apartmentState, data.expenses, data.payments)

  return {
    apartment: {
      id: data.apartmentState.apartment.id,
      name: data.apartmentState.apartment.name,
    },
    roommatesCount: data.apartmentState.users.length,
    openTasksCount: data.tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled').length,
    openShoppingItemsCount: data.shoppingItems.filter((item) => item.status === 'open').length,
    openTicketsCount: data.tickets.filter((ticket) => ticket.status !== 'closed' && ticket.status !== 'cancelled').length,
    recentExpensesCount: data.expenses.filter((expense) => expense.status === 'active').length,
    recentPaymentsCount: data.payments.filter((payment) => payment.status === 'recorded').length,
    apartmentInfoCount: data.apartmentInfoItems.length,
    shoppingItems: data.shoppingItems
      .filter((item) => item.status === 'open')
      .slice(0, 8)
      .map((item) => ({
        id: item.id,
        itemName: item.itemName,
        quantity: item.quantity,
        status: item.status,
      })),
    debts: debts.slice(0, 8),
  }
}

function answerMoneyQuestion(data: AssistantData, account: AuthAccount, question: string) {
  const { debts, credits, reasons } = buildPersonalDebtLines(data, account.id)
  const asksWhoOwesMe =
    question.includes('חייב לי') || question.includes('חייבים לי') || question.includes('מי חייב')
  const asksGeneral = question.includes('כולם') || question.includes('איזון') || question.includes('יתרות')

  if (asksGeneral) {
    const allDebts = buildDebtSummary(data.apartmentState, data.expenses, data.payments)
    if (!allDebts.length) return 'כרגע אין יתרות לתיאום בדירה. לפי ההוצאות והתשלומים שנשמרו, כולם מאוזנים.'

    return [
      'זה סיכום היתרות בדירה לפי כל ההוצאות והתשלומים הרשומים:',
      ...allDebts.map((debt) => `• ${debt.fromName} צריך להעביר ל-${debt.toName}: ${money(debt.amount)}`),
      '',
      'החישוב מבוסס על הוצאות פעילות בלבד ועל תשלומים שמסומנים כרשומים.',
    ].join('\n')
  }

  if (asksWhoOwesMe) {
    if (!credits.length) return 'כרגע לא נראה שמישהו חייב לך כסף לפי הנתונים בדירה.'

    return [
      `לפי הנתונים, חייבים לך בסך הכל ${money(credits.reduce((sum, item) => sum + item.amount, 0))}:`,
      ...credits.map((credit) => `• ${credit.toName}: ${money(credit.amount)}`),
      '',
      'זה אחרי קיזוז הוצאות ששילמת עבור אחרים ותשלומים שכבר נרשמו.',
    ].join('\n')
  }

  if (!debts.length) {
    return [
      'לפי הנתונים כרגע לא נראה שאתה חייב כסף למישהו בדירה.',
      credits.length
        ? `להפך, נראה שחייבים לך ${money(credits.reduce((sum, item) => sum + item.amount, 0))}.`
        : 'גם לא מופיעה יתרה שמישהו חייב לך, כלומר המצב מאוזן.',
    ].join('\n')
  }

  const relevantReasons = reasons
    .filter((reason) => debts.some((debt) => debt.toAccountId === reason.paidByAccountId))
    .slice(0, 10)

  return [
    `לפי הנתונים, אתה חייב כרגע ${money(debts.reduce((sum, item) => sum + item.amount, 0))}:`,
    ...debts.map((debt) => `• ל-${debt.toName}: ${money(debt.amount)}`),
    '',
    relevantReasons.length ? 'הפריטים המרכזיים שיצרו את החוב:' : 'לא מצאתי פירוט הוצאות שמסביר את החוב מעבר לקיזוז התשלומים.',
    ...relevantReasons.map((reason) => {
      const category = reason.category ? `, קטגוריה: ${reason.category}` : ''
      return `• ${reason.description} (${formatDate(reason.date)}${category}) - ${reason.paidByName} שילם ${money(reason.totalAmount)}, חולק בין ${reason.participantCount} משתתפים, החלק שלך ${money(reason.yourShare)}`
    }),
    '',
    'הסכום הסופי כולל גם קיזוז של תשלומים שכבר נרשמו במערכת.',
  ].join('\n')
}

function answerShoppingQuestion(data: AssistantData) {
  const openItems = data.shoppingItems.filter((item) => item.status === 'open')
  if (!openItems.length) return 'כרגע אין פריטי קניות פתוחים בדירה.'

  return [
    `יש כרגע ${openItems.length} פריטי קניות פתוחים:`,
    ...openItems
      .slice(0, 15)
      .map((item) => `• ${item.itemName}${item.quantity ? ` - כמות: ${item.quantity}` : ''}${item.category ? `, קטגוריה: ${item.category}` : ''}`),
    openItems.length > 15 ? `ועוד ${openItems.length - 15} פריטים נוספים.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function answerTaskQuestion(data: AssistantData, account: AuthAccount, question: string) {
  const userNames = userNameById(data.apartmentState)
  const openTasks = data.tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled')
  const onlyMine = question.includes('שלי') || question.includes('עליי') || question.includes('לי')
  const relevantTasks = onlyMine
    ? openTasks.filter((task) => task.assigneeAccountId === account.id)
    : openTasks

  if (!relevantTasks.length) {
    return onlyMine ? 'אין לך כרגע משימות פתוחות.' : 'אין כרגע משימות פתוחות בדירה.'
  }

  return [
    onlyMine
      ? `יש לך ${relevantTasks.length} משימות פתוחות:`
      : `יש בדירה ${relevantTasks.length} משימות פתוחות:`,
    ...relevantTasks.slice(0, 12).map((task) => {
      const assignee = task.assigneeAccountId ? (userNames.get(task.assigneeAccountId) ?? 'לא ידוע') : 'לא משויך'
      return `• ${task.title} - סטטוס: ${task.status}, אחראי: ${assignee}, תאריך יעד: ${formatDate(task.dueDate)}`
    }),
    relevantTasks.length > 12 ? `ועוד ${relevantTasks.length - 12} משימות נוספות.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function answerTicketQuestion(data: AssistantData) {
  const openTickets = data.tickets.filter((ticket) => ticket.status !== 'closed' && ticket.status !== 'cancelled')
  if (!openTickets.length) return 'כרגע אין פניות או תקלות פתוחות בדירה.'

  return [
    `יש כרגע ${openTickets.length} פניות פתוחות:`,
    ...openTickets.slice(0, 10).map((ticket) => {
      return `• ${ticket.title} - סטטוס: ${ticket.status}, קטגוריה: ${ticket.category}, נפתח ב-${formatDate(ticket.createdAt)}`
    }),
    openTickets.length > 10 ? `ועוד ${openTickets.length - 10} פניות נוספות.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function answerApartmentInfoQuestion(data: AssistantData, question: string) {
  const normalized = normalizeText(question)
  const terms = normalized
    .split(/\s+/)
    .filter((term) => term.length > 2 && !['מה', 'של', 'אני', 'יש', 'את', 'על'].includes(term))

  const matches = data.apartmentInfoItems.filter((item) => {
    const haystack = [
      item.title,
      item.categoryLabel,
      item.provider,
      item.meterNumber,
      item.accountNumber,
      item.phone,
      item.notes,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return terms.some((term) => haystack.includes(term))
  })

  const items = matches.length ? matches : data.apartmentInfoItems
  if (!items.length) return 'לא מצאתי מידע דירה שמור כרגע.'

  return [
    matches.length ? 'מצאתי את פריטי המידע הכי רלוונטיים:' : 'אלה פריטי המידע ששמורים בדירה:',
    ...items.slice(0, 8).map((item) => {
      const details = [
        item.provider ? `ספק: ${item.provider}` : '',
        item.accountNumber ? `מספר חשבון: ${item.accountNumber}` : '',
        item.meterNumber ? `מספר מונה: ${item.meterNumber}` : '',
        item.phone ? `טלפון: ${item.phone}` : '',
      ].filter(Boolean)

      return `• ${item.title}${details.length ? ` - ${details.join(', ')}` : ''}${item.notes ? `. הערות: ${item.notes}` : ''}`
    }),
  ].join('\n')
}

function answerOverview(data: AssistantData, account: AuthAccount) {
  const { debts, credits } = buildPersonalDebtLines(data, account.id)
  const openTasks = data.tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled')
  const openShopping = data.shoppingItems.filter((item) => item.status === 'open')
  const openTickets = data.tickets.filter((ticket) => ticket.status !== 'closed' && ticket.status !== 'cancelled')

  return [
    `הנה תמונת מצב קצרה לדירה "${data.apartmentState.apartment.name}":`,
    `• משימות פתוחות: ${openTasks.length}`,
    `• קניות פתוחות: ${openShopping.length}`,
    `• פניות פתוחות: ${openTickets.length}`,
    `• הוצאות פעילות: ${data.expenses.filter((expense) => expense.status === 'active').length}`,
    debts.length
      ? `• אתה חייב כרגע ${money(debts.reduce((sum, item) => sum + item.amount, 0))}`
      : credits.length
        ? `• חייבים לך כרגע ${money(credits.reduce((sum, item) => sum + item.amount, 0))}`
        : '• אין יתרה כספית פתוחה עבורך כרגע',
    '',
    'אפשר לשאול אותי למשל: "למי אני חייב כסף?", "איזה משימות שלי פתוחות?", "מה צריך לקנות?", או "מה מספר החשבון של החשמל?".',
  ].join('\n')
}

type AssistantIntent = 'money' | 'shopping' | 'tasks' | 'tickets' | 'apartmentInfo'

const intentKeywords: Record<AssistantIntent, string[]> = {
  money: ['כסף', 'חייב', 'חוב', 'יתרה', 'יתרות', 'תשלום', 'תשלומים', 'הוצאה', 'הוצאות', 'שילם', 'שילמתי'],
  shopping: ['קניות', 'קניה', 'לקנות', 'מכולת', 'סופר', 'מוצר', 'מוצרים', 'רשימה', 'חסר'],
  tasks: ['משימה', 'משימות', 'מטלה', 'מטלות', 'לעשות', 'דחוף', 'פתוח', 'באחריות', 'שלי'],
  tickets: ['פניה', 'פניות', 'תקלה', 'תקלות', 'תיקון', 'תחזוקה', 'בעל דירה', 'בעיה'],
  apartmentInfo: ['חשמל', 'מים', 'אינטרנט', 'מונה', 'חשבון', 'טלפון', 'ספק', 'חוזה', 'פרטים', 'מידע'],
}

const genericQuestionWords = new Set([
  'אני',
  'אתה',
  'את',
  'של',
  'שלי',
  'שלנו',
  'מה',
  'מי',
  'למה',
  'כמה',
  'יש',
  'אין',
  'עם',
  'על',
  'אל',
  'לי',
  'לך',
  'זה',
  'הזה',
  'כרגע',
  'עכשיו',
  'בדירה',
])

function countKeywordMatches(question: string, keywords: string[]) {
  return keywords.reduce((score, keyword) => (question.includes(keyword) ? score + 1 : score), 0)
}

function rankIntents(question: string) {
  return (Object.keys(intentKeywords) as AssistantIntent[])
    .map((intent) => ({
      intent,
      score: countKeywordMatches(question, intentKeywords[intent]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
}

function termsFromQuestion(question: string) {
  return question
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}"'-]/gu, '').trim())
    .filter((term) => term.length > 2 && !genericQuestionWords.has(term))
}

function hasTerm(haystack: string, terms: string[]) {
  const normalizedHaystack = haystack.toLowerCase()
  return terms.some((term) => normalizedHaystack.includes(term))
}

function answerFreeSearchQuestion(data: AssistantData, question: string) {
  const terms = termsFromQuestion(question)
  if (!terms.length) return null

  const userNames = userNameById(data.apartmentState)
  const matches: string[] = []

  for (const expense of data.expenses.filter((item) => item.status === 'active')) {
    const haystack = [expense.description, expense.category, expense.date].filter(Boolean).join(' ')
    if (!hasTerm(haystack, terms)) continue

    matches.push(
      `• הוצאה: ${expense.description} - ${money(Number(expense.amount))}, שילם ${userNames.get(expense.paidByAccountId) ?? 'לא ידוע'}, תאריך ${formatDate(expense.date)}`,
    )
  }

  for (const task of data.tasks.filter((item) => item.status !== 'done' && item.status !== 'cancelled')) {
    const haystack = [task.title, task.description, task.status, task.dueDate].filter(Boolean).join(' ')
    if (!hasTerm(haystack, terms)) continue

    const assignee = task.assigneeAccountId ? (userNames.get(task.assigneeAccountId) ?? 'לא ידוע') : 'לא משויך'
    matches.push(`• משימה: ${task.title} - אחראי: ${assignee}, סטטוס: ${task.status}, יעד: ${formatDate(task.dueDate)}`)
  }

  for (const item of data.shoppingItems.filter((entry) => entry.status === 'open')) {
    const haystack = [item.itemName, item.quantity, item.category, item.status].filter(Boolean).join(' ')
    if (!hasTerm(haystack, terms)) continue

    matches.push(`• קניות: ${item.itemName}${item.quantity ? ` - כמות: ${item.quantity}` : ''}${item.category ? `, קטגוריה: ${item.category}` : ''}`)
  }

  for (const ticket of data.tickets.filter((item) => item.status !== 'closed' && item.status !== 'cancelled')) {
    const haystack = [ticket.title, ticket.description, ticket.category, ticket.status].filter(Boolean).join(' ')
    if (!hasTerm(haystack, terms)) continue

    matches.push(`• פניה: ${ticket.title} - סטטוס: ${ticket.status}, קטגוריה: ${ticket.category}`)
  }

  for (const item of data.apartmentInfoItems) {
    const haystack = [
      item.title,
      item.categoryLabel,
      item.provider,
      item.meterNumber,
      item.accountNumber,
      item.phone,
      item.notes,
    ]
      .filter(Boolean)
      .join(' ')
    if (!hasTerm(haystack, terms)) continue

    matches.push(`• מידע דירה: ${item.title}${item.provider ? ` - ספק: ${item.provider}` : ''}${item.accountNumber ? `, חשבון: ${item.accountNumber}` : ''}${item.phone ? `, טלפון: ${item.phone}` : ''}`)
  }

  if (!matches.length) return null

  return [
    'בדקתי את הנתונים של הדירה ומצאתי כמה דברים שיכולים להיות רלוונטיים לשאלה שלך:',
    ...matches.slice(0, 12),
    matches.length > 12 ? `ועוד ${matches.length - 12} תוצאות נוספות.` : '',
    '',
    'אם תרצה תשובה יותר ממוקדת, אפשר לשאול לפי אדם, סכום, מוצר, משימה או ספק מסוים.',
  ]
    .filter(Boolean)
    .join('\n')
}

function answerIntent(data: AssistantData, account: AuthAccount, intent: AssistantIntent, question: string) {
  if (intent === 'money') return answerMoneyQuestion(data, account, question)
  if (intent === 'shopping') return answerShoppingQuestion(data)
  if (intent === 'tasks') return answerTaskQuestion(data, account, question)
  if (intent === 'tickets') return answerTicketQuestion(data)
  return answerApartmentInfoQuestion(data, question)
}

function intentTitle(intent: AssistantIntent) {
  if (intent === 'money') return 'כסף ויתרות'
  if (intent === 'shopping') return 'קניות'
  if (intent === 'tasks') return 'משימות'
  if (intent === 'tickets') return 'פניות ותקלות'
  return 'מידע דירה'
}

function answerSmartLocalQuestion(data: AssistantData, account: AuthAccount, question: string) {
  const rankedIntents = rankIntents(question)

  if (rankedIntents.length === 0) {
    return answerFreeSearchQuestion(data, question) ?? answerOverview(data, account)
  }

  const selectedIntents = rankedIntents.slice(0, 3)
  if (selectedIntents.length === 1) {
    return answerIntent(data, account, selectedIntents[0].intent, question)
  }

  return [
    'השאלה שלך נוגעת לכמה דברים בדירה, אז חילקתי את זה לפי נושאים:',
    '',
    ...selectedIntents.flatMap(({ intent }) => [
      `### ${intentTitle(intent)}`,
      answerIntent(data, account, intent, question),
      '',
    ]),
  ].join('\n').trim()
}

function buildSuggestions(question: string) {
  const normalized = normalizeText(question)
  if (normalized.includes('כסף') || normalized.includes('חייב')) {
    return ['מי חייב לי כסף?', 'תן לי סיכום יתרות בדירה', 'איזה הוצאות יצרו את החוב שלי?']
  }

  if (normalized.includes('משימ') || normalized.includes('מטל')) {
    return ['איזה משימות שלי פתוחות?', 'מה המשימות הדחופות?', 'מה מצב הדירה?']
  }

  return ['למי אני חייב כסף?', 'מה צריך לקנות?', 'איזה משימות פתוחות?']
}

export async function getAssistantContextSnapshot(apartmentId: number): Promise<AssistantContextSnapshot> {
  return buildSnapshot(await loadAssistantData(apartmentId))
}

export async function answerAssistantQuestion(
  apartmentId: number,
  question: string,
  account: AuthAccount,
) {
  const data = await loadAssistantData(apartmentId)
  const snapshot = buildSnapshot(data)
  const normalizedQuestion = normalizeText(question)

  if (!normalizedQuestion) {
    return {
      answer: 'תכתוב שאלה, ואני אענה לפי הנתונים של הדירה שלך.',
      context: snapshot,
      suggestions: ['למי אני חייב כסף?', 'מה צריך לקנות?', 'איזה משימות פתוחות?'],
    }
  }

  const answer = answerSmartLocalQuestion(data, account, normalizedQuestion)

  return {
    answer,
    context: snapshot,
    suggestions: buildSuggestions(normalizedQuestion),
  }
}
