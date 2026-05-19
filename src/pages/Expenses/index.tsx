import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { useExpenses } from '../../context/ExpensesContext'
import { PaymentsPage, type PaymentsPageHandle } from '../Payments'
import type { Expense, Payment, User } from '../../types/models'

const allCategories = 'כל הקטגוריות'

interface ExpenseFormState {
  description: string
  amount: string
  category: string
  date: string
  paidBy: string
  participantIds: number[]
}

function createInitialFormState(roommates: User[]): ExpenseFormState {
  const fallbackPayerId = roommates[0]?.id ?? 0

  return {
    description: '',
    amount: '',
    category: 'חשבונות',
    date: new Date().toISOString().slice(0, 10),
    paidBy: fallbackPayerId ? String(fallbackPayerId) : '',
    participantIds: roommates.map((user) => user.id),
  }
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 2,
  }).format(Number(value))
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(date))
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat('he-IL', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}-01T00:00:00`))
}

function getMonth(date: string) {
  return date.slice(0, 7)
}

function calculateShare(expense: Expense) {
  const participants = Math.max(expense.participant_ids.length, 1)
  return Number(expense.amount) / participants
}

function calculateNetBalanceForUser(expenses: Expense[], payments: Payment[], userId: number) {
  let balance = 0

  expenses
    .filter((expense) => expense.status === 'active')
    .forEach((expense) => {
      const amount = Number(expense.amount)
      const participants = expense.participant_ids
      if (!Number.isFinite(amount) || amount <= 0 || participants.length === 0) return

      if (expense.paid_by === userId) balance += amount
      if (participants.includes(userId)) balance -= amount / participants.length
    })

  payments
    .filter((payment) => payment.status === 'recorded')
    .forEach((payment) => {
      const amount = Number(payment.amount)
      if (!Number.isFinite(amount) || amount <= 0) return

      if (payment.payer_id === userId) balance += amount
      if (payment.payee_id === userId) balance -= amount
    })

  return balance
}

function calculatePersonalSettlements(expenses: Expense[], payments: Payment[], userIds: number[], userId: number) {
  const balances = new Map(userIds.map((id) => [id, 0]))

  expenses
    .filter((expense) => expense.status === 'active')
    .forEach((expense) => {
      const amount = Number(expense.amount)
      const participants = expense.participant_ids
      if (!Number.isFinite(amount) || amount <= 0 || participants.length === 0) return

      const share = amount / participants.length
      balances.set(expense.paid_by, (balances.get(expense.paid_by) ?? 0) + amount)
      participants.forEach((participantId) => {
        balances.set(participantId, (balances.get(participantId) ?? 0) - share)
      })
    })

  payments
    .filter((payment) => payment.status === 'recorded')
    .forEach((payment) => {
      const amount = Number(payment.amount)
      if (!Number.isFinite(amount) || amount <= 0) return

      balances.set(payment.payer_id, (balances.get(payment.payer_id) ?? 0) + amount)
      balances.set(payment.payee_id, (balances.get(payment.payee_id) ?? 0) - amount)
    })

  const debtors = [...balances.entries()]
    .filter(([, balance]) => balance < -0.005)
    .map(([id, balance]) => ({ id, amount: Math.abs(balance) }))
    .sort((first, second) => second.amount - first.amount)

  const creditors = [...balances.entries()]
    .filter(([, balance]) => balance > 0.005)
    .map(([id, balance]) => ({ id, amount: balance }))
    .sort((first, second) => second.amount - first.amount)

  const settlements: Array<{ payer_id: number; payee_id: number; amount: number }> = []

  debtors.forEach((debtor) => {
    let remaining = debtor.amount

    creditors.forEach((creditor) => {
      if (remaining <= 0.005 || creditor.amount <= 0.005) return
      const amount = Math.min(remaining, creditor.amount)
      settlements.push({
        payer_id: debtor.id,
        payee_id: creditor.id,
        amount,
      })
      remaining -= amount
      creditor.amount -= amount
    })
  })

  return {
    debtsToMe: settlements.filter((settlement) => settlement.payee_id === userId),
    debtsFromMe: settlements.filter((settlement) => settlement.payer_id === userId),
  }
}

function buildFormFromExpense(expense: Expense): ExpenseFormState {
  return {
    description: expense.description,
    amount: String(Number(expense.amount)),
    category: expense.category ?? '',
    date: expense.date,
    paidBy: String(expense.paid_by),
    participantIds: [...expense.participant_ids],
  }
}

export function ExpensesPage() {
  const { user } = useAuth()
  const { current } = useApartment()
  const apartmentId = current?.apartment.id ?? 0
  const roommates = useMemo(
    () => (current?.roommates ?? []).filter((roommate) => roommate.status === 'active'),
    [current],
  )
  const userNameById = useMemo(
    () => new Map(roommates.map((roommate) => [roommate.id, roommate.name])),
    [roommates],
  )
  const getUserName = (userId: number) => userNameById.get(userId)
  const { expenses, payments, addExpense, updateExpense, deleteExpense } = useExpenses()
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7))
  const [categoryFilter, setCategoryFilter] = useState(allCategories)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null)
  const [form, setForm] = useState<ExpenseFormState>(() => createInitialFormState(roommates))
  const [formError, setFormError] = useState('')
  const paymentsPageRef = useRef<PaymentsPageHandle>(null)

  const activeExpenses = expenses.filter(
    (expense) => expense.status === 'active' && expense.apartment_id === apartmentId,
  )
  const monthOptions = Array.from(new Set(activeExpenses.map((expense) => getMonth(expense.date)))).sort(
    (first, second) => second.localeCompare(first),
  )
  const categoryOptions = Array.from(
    new Set(
      activeExpenses
        .map((expense) => expense.category)
        .filter((category): category is string => Boolean(category)),
    ),
  ).sort((first, second) => first.localeCompare(second, 'he'))

  const filteredExpenses = activeExpenses.filter((expense) => {
    const matchesMonth = getMonth(expense.date) === monthFilter
    const matchesCategory = categoryFilter === allCategories || expense.category === categoryFilter
    return matchesMonth && matchesCategory
  })

  const monthlyExpenses = activeExpenses.filter((expense) => getMonth(expense.date) === monthFilter)
  const monthlyTotal = monthlyExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  const filteredTotal = filteredExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  const apartmentPayments = payments.filter((payment) => payment.apartment_id === apartmentId)
  const myNetBalance = user?.id ? calculateNetBalanceForUser(activeExpenses, apartmentPayments, user.id) : 0
  const amountOwedToMe = Math.max(myNetBalance, 0)
  const { debtsToMe, debtsFromMe } = user?.id
    ? calculatePersonalSettlements(
        activeExpenses,
        apartmentPayments,
        roommates.map((roommate) => roommate.id),
        user.id,
      )
    : { debtsToMe: [], debtsFromMe: [] }
  const totalsByUser = monthlyExpenses.reduce<Record<number, number>>(
    (totals, expense) => ({
      ...totals,
      [expense.paid_by]: (totals[expense.paid_by] ?? 0) + Number(expense.amount),
    }),
    {},
  )
  const [topPayerId, topPayerTotal] =
    Object.entries(totalsByUser).sort((a, b) => Number(b[1]) - Number(a[1]))[0] ?? []
  const topPayer = topPayerId ? { name: getUserName(Number(topPayerId)), total: Number(topPayerTotal) } : null

  function updateForm(field: keyof ExpenseFormState, value: string | number[]) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  function toggleParticipant(userId: number) {
    setForm((currentForm) => {
      const exists = currentForm.participantIds.includes(userId)
      const participantIds = exists
        ? currentForm.participantIds.filter((id) => id !== userId)
        : [...currentForm.participantIds, userId]

      return { ...currentForm, participantIds }
    })
  }

  function openAddModal() {
    setEditingExpense(null)
    setForm(createInitialFormState(roommates))
    setFormError('')
    setIsAddOpen(true)
  }

  function openEditModal(expense: Expense) {
    setSelectedExpense(null)
    setEditingExpense(expense)
    setForm(buildFormFromExpense(expense))
    setFormError('')
    setIsAddOpen(true)
  }

  function closeAddModal() {
    setIsAddOpen(false)
    setEditingExpense(null)
    setForm(createInitialFormState(roommates))
    setFormError('')
  }

  async function confirmDeleteExpense() {
    if (!expenseToDelete) return
    await deleteExpense(expenseToDelete.id)
    if (selectedExpense?.id === expenseToDelete.id) setSelectedExpense(null)
    if (editingExpense?.id === expenseToDelete.id) closeAddModal()
    setExpenseToDelete(null)
  }

  async function handleAddExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')

    const amount = Number(form.amount)
    if (!form.description.trim()) {
      setFormError('צריך להוסיף תיאור קצר להוצאה.')
      return
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('הסכום חייב להיות מספר חיובי.')
      return
    }

    if (!form.date) {
      setFormError('צריך לבחור תאריך להוצאה.')
      return
    }

    if (!form.paidBy) {
      setFormError('צריך לבחור מי שילם את ההוצאה.')
      return
    }

    if (form.participantIds.length === 0) {
      setFormError('צריך לבחור לפחות דייר אחד שמשתתף בהוצאה.')
      return
    }

    try {
      if (editingExpense) {
        const updatedExpense = await updateExpense(editingExpense.id, {
          paid_by: Number(form.paidBy),
          amount: amount.toFixed(2),
          description: form.description.trim(),
          category: form.category.trim() || null,
          date: form.date,
          participant_ids: form.participantIds,
        })

        if (updatedExpense) {
          setSelectedExpense(updatedExpense)
          setMonthFilter(getMonth(updatedExpense.date))
          if (updatedExpense.category) setCategoryFilter(updatedExpense.category)
        }
      } else {
        const nextExpense = await addExpense({
          apartment_id: apartmentId,
          paid_by: Number(form.paidBy),
          amount: amount.toFixed(2),
          description: form.description.trim(),
          category: form.category.trim() || null,
          date: form.date,
          participant_ids: form.participantIds,
        })
        if (nextExpense) {
          setMonthFilter(getMonth(nextExpense.date))
          if (nextExpense.category) setCategoryFilter(nextExpense.category)
        }
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'לא הצלחנו לשמור את ההוצאה.')
      return
    }

    closeAddModal()
  }

  return (
    <div className="page expenses-page">
      <div className="page__head expenses-hero">
        <div>
          <p className="expenses-hero__eyebrow">כספים בדירה</p>
          <h1 className="page__title">הוצאות, חשבונות ויתרות</h1>
          <p className="page__lead">
            כל חשבון או קנייה נרשמים כהוצאה: בוחרים מי שילם ובין מי הסכום מתחלק.
          </p>
        </div>
      </div>

      <div className="finance-primary-actions">
        <div className="finance-primary-actions__buttons">
          <button type="button" className="btn btn--primary finance-primary-actions__button" onClick={openAddModal}>
            + הוצאה חדשה
          </button>
          <button
            type="button"
            className="btn btn--secondary finance-primary-actions__button"
            onClick={() => paymentsPageRef.current?.openPaymentModal()}
          >
            סגירת חוב
          </button>
        </div>
        <p>חשבון ששולם לצד שלישי מוסיפים כהוצאה. סגירת חוב היא רק כשדייר מעביר כסף לדייר אחר.</p>
      </div>

      <section className="expenses-summary" aria-label="סיכום חודשי">
        <Card className="expenses-summary__main">
          <p className="expenses-summary__label">סה&quot;כ הוצאות ב{monthLabel(monthFilter)}</p>
          <p className="expenses-summary__amount">{formatCurrency(monthlyTotal)}</p>
          <p className="expenses-summary__hint">{monthlyExpenses.length} הוצאות פעילות בחודש הנבחר</p>
        </Card>

        <Card className="expenses-summary__owed">
          <p className="expenses-mini-stat__label">חייבים לי</p>
          <p className="expenses-mini-stat__value expenses-mini-stat__value--success">
            {formatCurrency(amountOwedToMe)}
          </p>
          <p className="expenses-mini-stat__hint">
            {amountOwedToMe > 0.005 ? 'יתרה פתוחה לקבלה' : 'אין יתרה שחייבים לך'}
          </p>
        </Card>

        <div className="expenses-summary__grid">
          <Card>
            <p className="expenses-mini-stat__label">שילם הכי הרבה</p>
            <p className="expenses-mini-stat__value">{topPayer?.name ?? 'אין נתונים'}</p>
            {topPayer ? <p className="expenses-mini-stat__hint">{formatCurrency(topPayer.total)}</p> : null}
          </Card>
        </div>
      </section>

      <Card className="personal-balance-card" title="פירוט יתרה אישי">
        <div className="personal-balance-summary personal-balance-summary--top">
          <div className="personal-balance-summary__section">
            <h3>חייבים לי</h3>
            {debtsToMe.length === 0 ? (
              <p>כרגע אף אחד לא חייב לך כסף.</p>
            ) : (
              <ul>
                {debtsToMe.map((settlement) => (
                  <li key={`expense-to-me-${settlement.payer_id}-${settlement.payee_id}`}>
                    <span>{getUserName(settlement.payer_id) ?? 'דייר'} חייב לך</span>
                    <strong>{formatCurrency(settlement.amount)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="personal-balance-summary__section personal-balance-summary__section--danger">
            <h3>אני חייב</h3>
            {debtsFromMe.length === 0 ? (
              <p>אין לך חובות פתוחים לדיירים אחרים.</p>
            ) : (
              <ul>
                {debtsFromMe.map((settlement) => (
                  <li key={`expense-from-me-${settlement.payer_id}-${settlement.payee_id}`}>
                    <span>אתה חייב ל{getUserName(settlement.payee_id) ?? 'דייר'}</span>
                    <strong>{formatCurrency(settlement.amount)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Card title="סינון הוצאות">
        <div className="expenses-filters">
          <label className="field">
            <span className="field__label">חודש</span>
            <select className="field__input" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">קטגוריה</span>
            <select className="field__input" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value={allCategories}>{allCategories}</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="expenses-filter-note">
          מוצגות {filteredExpenses.length} הוצאות בסכום כולל של <strong>{formatCurrency(filteredTotal)}</strong>.
        </p>
      </Card>

      <Card title="רשימת הוצאות">
        {filteredExpenses.length === 0 ? (
          <div className="expenses-empty">
            <p className="expenses-empty__title">אין הוצאות שמתאימות לסינון.</p>
            <p className="muted">אפשר לשנות חודש או קטגוריה, או להוסיף הוצאה חדשה.</p>
          </div>
        ) : (
          <ul className="expense-list expense-list--cards">
            {filteredExpenses.map((expense) => {
              const payerName = getUserName(expense.paid_by)

              return (
                <li key={expense.id} className="expense-list__item expense-item-card">
                  <button type="button" className="expense-item-card__button" onClick={() => setSelectedExpense(expense)}>
                    <span className="expense-item-card__main">
                      <span className="expense-list__title">{expense.description}</span>
                      <span className="expense-list__meta">
                        {formatDate(expense.date)}
                        {expense.category ? ` · ${expense.category}` : ''}
                        {payerName ? ` · שילם: ${payerName}` : ''}
                      </span>
                    </span>
                    <span className="expense-item-card__side">
                      <span className="expense-list__amount">{formatCurrency(expense.amount)}</span>
                      <span className="expense-item-card__share">חלק לדייר: {formatCurrency(calculateShare(expense))}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <PaymentsPage ref={paymentsPageRef} embedded showHero={false} />

      {isAddOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="expense-modal card" role="dialog" aria-modal="true" aria-labelledby="add-expense-title">
            <div className="expense-modal__head">
              <div>
                <p className="expenses-hero__eyebrow">{editingExpense ? 'עריכת הוצאה' : 'הוצאה חדשה'}</p>
                <h2 id="add-expense-title">{editingExpense ? 'עדכון פרטי הוצאה' : 'מה שולם בדירה?'}</h2>
              </div>
              <button type="button" className="btn-text" onClick={closeAddModal}>
                סגירה
              </button>
            </div>

            <form className="expense-form" onSubmit={(event) => void handleAddExpense(event)} noValidate>
              <label className="field">
                <span className="field__label">תיאור ההוצאה</span>
                <input className="field__input" value={form.description} onChange={(event) => updateForm('description', event.target.value)} />
              </label>

              <div className="expense-form__grid">
                <label className="field">
                  <span className="field__label">סכום</span>
                  <input className="field__input" type="number" min="0" step="0.01" dir="ltr" value={form.amount} onChange={(event) => updateForm('amount', event.target.value)} />
                </label>

                <label className="field">
                  <span className="field__label">תאריך</span>
                  <input className="field__input" type="date" dir="ltr" value={form.date} onChange={(event) => updateForm('date', event.target.value)} />
                </label>
              </div>

              <div className="expense-form__grid">
                <label className="field">
                  <span className="field__label">קטגוריה</span>
                  <select className="field__input" value={form.category} onChange={(event) => updateForm('category', event.target.value)}>
                    {['חשבונות', 'מזון', 'ניקיון', 'תחזוקה', 'אחר'].map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field__label">מי שילם?</span>
                  <select className="field__input" value={form.paidBy} onChange={(event) => updateForm('paidBy', event.target.value)}>
                    {roommates.map((roommate) => (
                      <option key={roommate.id} value={roommate.id}>
                        {roommate.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset className="expense-participants">
                <legend>מי משתתף בחלוקה?</legend>
                <div className="expense-participants__grid">
                  {roommates.map((roommate) => (
                    <label key={roommate.id} className="expense-participants__option">
                      <input type="checkbox" checked={form.participantIds.includes(roommate.id)} onChange={() => toggleParticipant(roommate.id)} />
                      <span>{roommate.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {formError ? <p className="form-message form-message--error">{formError}</p> : null}

              <div className="expense-form__actions">
                <button type="button" className="btn btn--secondary" onClick={closeAddModal}>
                  ביטול
                </button>
                <button type="submit" className="btn btn--primary">
                  {editingExpense ? 'שמירת שינויים' : 'שמירת הוצאה'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {selectedExpense ? (
        <div className="modal-backdrop" role="presentation">
          <section className="expense-modal expense-modal--details card" role="dialog" aria-modal="true" aria-labelledby="expense-details-title">
            <div className="expense-modal__head">
              <div>
                <p className="expenses-hero__eyebrow">פרטי הוצאה</p>
                <h2 id="expense-details-title">{selectedExpense.description}</h2>
                <p>{formatDate(selectedExpense.date)}</p>
              </div>
              <button type="button" className="btn-text" onClick={() => setSelectedExpense(null)}>
                סגירה
              </button>
            </div>

            <div className="expense-detail">
              <div className="expense-detail__amount">
                <span>סכום ההוצאה</span>
                <strong>{formatCurrency(selectedExpense.amount)}</strong>
              </div>

              <div className="expense-detail__facts">
                <div>
                  <span>קטגוריה</span>
                  <strong>{selectedExpense.category ?? 'ללא קטגוריה'}</strong>
                </div>
                <div>
                  <span>שולם על ידי</span>
                  <strong>{getUserName(selectedExpense.paid_by) ?? 'לא ידוע'}</strong>
                </div>
                <div>
                  <span>משתתפים</span>
                  <strong>{selectedExpense.participant_ids.length} דיירים</strong>
                </div>
                <div>
                  <span>חלק לכל משתתף</span>
                  <strong>{formatCurrency(calculateShare(selectedExpense))}</strong>
                </div>
              </div>

              <div>
                <h3>דיירים שמשתתפים בהוצאה</h3>
                <ul className="expense-detail__participants">
                  {selectedExpense.participant_ids.map((userId) => (
                    <li key={userId}>{getUserName(userId) ?? 'דייר לא ידוע'}</li>
                  ))}
                </ul>
              </div>

              <div className="expense-form__actions">
                <button type="button" className="btn btn--secondary" onClick={() => openEditModal(selectedExpense)}>
                  עריכה
                </button>
                <button type="button" className="btn btn--danger" onClick={() => setExpenseToDelete(selectedExpense)}>
                  מחיקה
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {expenseToDelete ? (
        <ConfirmDialog
          title="למחוק את ההוצאה?"
          message="ההוצאה תוסר מרשימת ההוצאות ולא תיכלל עוד בחישובי היתרות."
          confirmLabel="מחיקה"
          cancelLabel="ביטול"
          onConfirm={() => void confirmDeleteExpense()}
          onCancel={() => setExpenseToDelete(null)}
        />
      ) : null}
    </div>
  )
}
