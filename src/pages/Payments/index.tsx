import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import { Card } from '../../components/Card'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useApartment } from '../../context/ApartmentContext'
import { useAuth } from '../../context/AuthContext'
import { useExpenses, type BalanceSettlement } from '../../context/ExpensesContext'
import type { Expense, Payment, User } from '../../types/models'

interface PaymentFormState {
  payerId: string
  payeeId: string
  amount: string
  paymentDate: string
  note: string
}

interface PaymentsPageProps {
  embedded?: boolean
  showHero?: boolean
  triggerClassName?: string
  triggerLabel?: string
}

export interface PaymentsPageHandle {
  openPaymentModal: () => void
}

function calculateApartmentBalances(expenses: Expense[], payments: Payment[]) {
  const netBalanceByUser: Record<number, number> = {}

  expenses
    .filter((expense) => expense.status === 'active')
    .forEach((expense) => {
      const amount = Number(expense.amount)
      const participants = expense.participant_ids
      if (!Number.isFinite(amount) || amount <= 0 || participants.length === 0) return

      netBalanceByUser[expense.paid_by] = (netBalanceByUser[expense.paid_by] ?? 0) + amount

      participants.forEach((participantId) => {
        netBalanceByUser[participantId] = (netBalanceByUser[participantId] ?? 0) - amount / participants.length
      })
    })

  payments
    .filter((payment) => payment.status === 'recorded')
    .forEach((payment) => {
      const amount = Number(payment.amount)
      if (!Number.isFinite(amount) || amount <= 0) return

      netBalanceByUser[payment.payer_id] = (netBalanceByUser[payment.payer_id] ?? 0) + amount
      netBalanceByUser[payment.payee_id] = (netBalanceByUser[payment.payee_id] ?? 0) - amount
    })

  const debtors = Object.entries(netBalanceByUser)
    .map(([userId, balance]) => ({ userId: Number(userId), amount: -balance }))
    .filter((entry) => entry.amount > 0.005)
    .sort((a, b) => b.amount - a.amount)

  const creditors = Object.entries(netBalanceByUser)
    .map(([userId, balance]) => ({ userId: Number(userId), amount: balance }))
    .filter((entry) => entry.amount > 0.005)
    .sort((a, b) => b.amount - a.amount)

  const settlements: BalanceSettlement[] = []
  let debtorIndex = 0
  let creditorIndex = 0

  while (debtors[debtorIndex] && creditors[creditorIndex]) {
    const debtor = debtors[debtorIndex]
    const creditor = creditors[creditorIndex]
    const amount = Math.min(debtor.amount, creditor.amount)

    if (amount > 0.005) {
      settlements.push({
        id: `balance-${debtor.userId}-${creditor.userId}-${settlements.length}`,
        payer_id: debtor.userId,
        payee_id: creditor.userId,
        amount: amount.toFixed(2),
      })
    }

    debtor.amount -= amount
    creditor.amount -= amount
    if (debtor.amount <= 0.005) debtorIndex += 1
    if (creditor.amount <= 0.005) creditorIndex += 1
  }

  return { netBalanceByUser, settlements }
}

function createInitialPaymentForm(roommates: User[], currentUserId?: number): PaymentFormState {
  const fallbackPayer = roommates.find((roommate) => roommate.id === currentUserId) ?? roommates[0] ?? null
  const fallbackPayee = roommates.find((roommate) => roommate.id !== fallbackPayer?.id) ?? roommates[0] ?? null

  return {
    payerId: fallbackPayer ? String(fallbackPayer.id) : '',
    payeeId: fallbackPayee ? String(fallbackPayee.id) : '',
    amount: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    note: '',
  }
}

function buildFormFromPayment(payment: Payment): PaymentFormState {
  return {
    payerId: String(payment.payer_id),
    payeeId: String(payment.payee_id),
    amount: String(Number(payment.amount)),
    paymentDate: payment.created_at.slice(0, 10),
    note: payment.note ?? '',
  }
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 2,
  }).format(Number(value))
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export const PaymentsPage = forwardRef<PaymentsPageHandle, PaymentsPageProps>(function PaymentsPage(
  {
    embedded = false,
    showHero = true,
    triggerClassName = 'btn btn--primary payments-hero__action',
    triggerLabel = 'רישום תשלום',
  },
  ref,
) {
  const { user } = useAuth()
  const { current } = useApartment()
  const { expenses, payments, addPayment, updatePayment, deletePayment } = useExpenses()
  const apartmentId = current?.apartment.id ?? 0
  const roommates = useMemo(
    () => (current?.roommates ?? []).filter((roommate) => roommate.status === 'active'),
    [current],
  )
  const userNameById = useMemo(
    () => new Map(roommates.map((roommate) => [roommate.id, roommate.name])),
    [roommates],
  )
  const getUserName = (userId: number) => userNameById.get(userId) ?? 'דייר לא ידוע'

  const apartmentExpenses = useMemo(
    () => expenses.filter((expense) => expense.apartment_id === apartmentId),
    [apartmentId, expenses],
  )
  const apartmentPayments = useMemo(
    () => payments.filter((payment) => payment.apartment_id === apartmentId),
    [apartmentId, payments],
  )
  const activePayments = apartmentPayments.filter((payment) => payment.status === 'recorded')
  const { settlements, netBalanceByUser } = useMemo(
    () => calculateApartmentBalances(apartmentExpenses, apartmentPayments),
    [apartmentExpenses, apartmentPayments],
  )

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null)
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null)
  const [activeTab, setActiveTab] = useState<'balances' | 'history'>('balances')
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(() =>
    createInitialPaymentForm(roommates, user?.id),
  )
  const [formError, setFormError] = useState('')

  const myId = user?.id
  const totalBalanceToSettle = settlements.reduce((sum, settlement) => sum + Number(settlement.amount), 0)
  const myNetBalance = myId ? netBalanceByUser[myId] ?? 0 : 0
  const debtsToMe = myId ? settlements.filter((settlement) => settlement.payee_id === myId) : []
  const debtsFromMe = myId ? settlements.filter((settlement) => settlement.payer_id === myId) : []
  const totalRecordedPayments = activePayments.reduce((sum, payment) => sum + Number(payment.amount), 0)

  function updatePaymentForm(field: keyof PaymentFormState, value: string) {
    setPaymentForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  function openAddPaymentModal() {
    setEditingPayment(null)
    setPaymentForm(createInitialPaymentForm(roommates, user?.id))
    setFormError('')
    setIsPaymentModalOpen(true)
  }

  useImperativeHandle(ref, () => ({
    openPaymentModal: openAddPaymentModal,
  }))

  function openEditPaymentModal(payment: Payment) {
    setSelectedPayment(null)
    setEditingPayment(payment)
    setPaymentForm(buildFormFromPayment(payment))
    setFormError('')
    setIsPaymentModalOpen(true)
  }

  function closePaymentModal() {
    setIsPaymentModalOpen(false)
    setEditingPayment(null)
    setFormError('')
    setPaymentForm(createInitialPaymentForm(roommates, user?.id))
  }

  async function handleAddPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')

    const amount = Number(paymentForm.amount)

    if (!paymentForm.payerId) {
      setFormError('צריך לבחור מי שילם.')
      return
    }

    if (!paymentForm.payeeId) {
      setFormError('צריך לבחור למי התשלום הועבר.')
      return
    }

    if (paymentForm.payerId === paymentForm.payeeId) {
      setFormError('המשלם והמקבל צריכים להיות דיירים שונים.')
      return
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('הסכום חייב להיות מספר חיובי.')
      return
    }

    if (!paymentForm.paymentDate) {
      setFormError('צריך לבחור תאריך תשלום.')
      return
    }

    try {
      if (editingPayment) {
        const updatedPayment = await updatePayment(editingPayment.id, {
          payer_id: Number(paymentForm.payerId),
          payee_id: Number(paymentForm.payeeId),
          amount: amount.toFixed(2),
          created_at: `${paymentForm.paymentDate}T12:00:00`,
          note: paymentForm.note.trim() || null,
        })

        if (updatedPayment) setSelectedPayment(updatedPayment)
      } else {
        await addPayment({
          apartment_id: apartmentId,
          payer_id: Number(paymentForm.payerId),
          payee_id: Number(paymentForm.payeeId),
          amount: amount.toFixed(2),
          created_at: `${paymentForm.paymentDate}T12:00:00`,
          note: paymentForm.note.trim() || null,
        })
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'לא הצלחנו לשמור את התשלום.')
      return
    }

    closePaymentModal()
  }

  async function confirmDeletePayment() {
    if (!paymentToDelete) return
    await deletePayment(paymentToDelete.id)
    if (selectedPayment?.id === paymentToDelete.id) setSelectedPayment(null)
    if (editingPayment?.id === paymentToDelete.id) closePaymentModal()
    setPaymentToDelete(null)
  }

  return (
    <section className={`payments-page${embedded ? ' payments-page--embedded' : ' page'}`}>
      {showHero ? (
        <div className={`${embedded ? 'payments-hero payments-hero--embedded' : 'page__head payments-hero'}`}>
          <div>
            <p className="payments-hero__eyebrow">יתרות וסגירת חובות</p>
            <h2 className="page__title">מי צריך להעביר למי?</h2>
            <p className="page__lead">
              חשבונות כמו חשמל, מים או קניות נרשמים כהוצאה שמתחלקת בין הדיירים. כאן רושמים רק העברת כסף בפועל לסגירת יתרה.
            </p>
          </div>
          <button type="button" className={triggerClassName} onClick={openAddPaymentModal}>
            {triggerLabel}
          </button>
        </div>
      ) : null}

      <section className="payments-summary" aria-label="סיכום תשלומים">
        <Card className="payments-summary__main">
          <p className="payments-summary__label">סה&quot;כ תשלומים שנרשמו</p>
          <p className="payments-summary__amount">{formatCurrency(totalRecordedPayments)}</p>
        </Card>

        <div className="payments-summary__grid">
          <Card>
            <p className="payments-mini-stat__label">יתרה לתיאום</p>
            <p className="payments-mini-stat__value">{formatCurrency(totalBalanceToSettle)}</p>
          </Card>

          <Card>
            <p className="payments-mini-stat__label">היתרה שלך</p>
            <p className={`payments-mini-stat__value${myNetBalance < -0.005 ? ' payments-mini-stat__value--danger' : ''}`}>
              {formatCurrency(Math.abs(myNetBalance))}
            </p>
            <p className="payments-mini-stat__hint">
              {myNetBalance > 0.005 ? 'חייבים לך' : myNetBalance < -0.005 ? 'אתה חייב' : 'מאוזן'}
            </p>
          </Card>
        </div>
      </section>

      <div className="shopping-filter-tabs payments-tabs" aria-label="מעבר בין אזורי תשלומים">
        <button
          type="button"
          className={`shopping-filter-tabs__button${activeTab === 'balances' ? ' shopping-filter-tabs__button--active' : ''}`}
          onClick={() => setActiveTab('balances')}
        >
          יתרות לתיאום
        </button>
        <button
          type="button"
          className={`shopping-filter-tabs__button${activeTab === 'history' ? ' shopping-filter-tabs__button--active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          תשלומים אחרונים
        </button>
      </div>

      {activeTab === 'balances' ? (
        <Card title="יתרות לתיאום">
          {myId ? (
            <div className="personal-balance-summary">
              <div className="personal-balance-summary__section">
                <h3>חייבים לי</h3>
                {debtsToMe.length === 0 ? (
                  <p>כרגע אף אחד לא חייב לך כסף.</p>
                ) : (
                  <ul>
                    {debtsToMe.map((settlement) => (
                      <li key={`to-me-${settlement.id}`}>
                        <span>{getUserName(settlement.payer_id)} חייב לך</span>
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
                      <li key={`from-me-${settlement.id}`}>
                        <span>אתה חייב ל{getUserName(settlement.payee_id)}</span>
                        <strong>{formatCurrency(settlement.amount)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          {settlements.length === 0 ? (
            <p className="muted">אין יתרות פתוחות לפי ההוצאות והתשלומים שנרשמו בדירה הזו.</p>
          ) : (
            <ul className="debt-list">
              {settlements.map((settlement) => {
                const isRelatedToMe = myId != null && (settlement.payer_id === myId || settlement.payee_id === myId)

                return (
                  <li key={settlement.id} className="debt-list__item">
                    <div className="debt-list__route">
                      <span className="debt-list__person">{getUserName(settlement.payer_id)}</span>
                      <span className="debt-list__arrow">←</span>
                      <span className="debt-list__person">{getUserName(settlement.payee_id)}</span>
                    </div>
                    <div className="debt-list__meta">
                      <span>מבוסס על הוצאות ותשלומים שנרשמו בדירה</span>
                      {isRelatedToMe ? <span className="debt-list__tag">שלך</span> : null}
                    </div>
                    <strong className="debt-list__amount">{formatCurrency(settlement.amount)}</strong>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      ) : (
        <Card title="תשלומים אחרונים">
          {activePayments.length === 0 ? (
            <p className="muted">עדיין לא נרשמו תשלומים בדירה הזו.</p>
          ) : (
            <ul className="payment-list payment-list--cards">
              {activePayments.map((payment) => (
                <li key={payment.id} className="payment-list__item payment-item-card">
                  <button type="button" className="expense-item-card__button" onClick={() => setSelectedPayment(payment)}>
                    <div className="payment-item-card__main">
                      <div className="payment-list__title">
                        {getUserName(payment.payer_id)} שילם ל{getUserName(payment.payee_id)}
                      </div>
                      <div className="payment-list__meta">{formatDateTime(payment.created_at)}</div>
                      {payment.note ? <div className="payment-list__note">{payment.note}</div> : null}
                    </div>
                    <div className="payment-list__right">
                      <div className="payment-list__amount">{formatCurrency(payment.amount)}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {isPaymentModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="payment-modal card" role="dialog" aria-modal="true" aria-labelledby="add-payment-title">
            <div className="payment-modal__head">
              <div>
                <p className="payments-hero__eyebrow">{editingPayment ? 'עריכת תשלום' : 'רישום תשלום'}</p>
                <h2 id="add-payment-title">{editingPayment ? 'עדכון תשלום' : 'תשלום חדש'}</h2>
              </div>
              <button type="button" className="btn-text" onClick={closePaymentModal}>
                סגירה
              </button>
            </div>

            <form className="payment-form" onSubmit={(event) => void handleAddPayment(event)} noValidate>
              <div className="payment-form__grid">
                <label className="field">
                  <span className="field__label">מי שילם?</span>
                  <select className="field__input" value={paymentForm.payerId} onChange={(event) => updatePaymentForm('payerId', event.target.value)}>
                    {roommates.map((roommate) => (
                      <option key={roommate.id} value={roommate.id}>
                        {roommate.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field__label">למי שילמו?</span>
                  <select className="field__input" value={paymentForm.payeeId} onChange={(event) => updatePaymentForm('payeeId', event.target.value)}>
                    {roommates.map((roommate) => (
                      <option key={roommate.id} value={roommate.id}>
                        {roommate.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="payment-form__grid">
                <label className="field">
                  <span className="field__label">סכום</span>
                  <input
                    className="field__input"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    dir="ltr"
                    value={paymentForm.amount}
                    onChange={(event) => updatePaymentForm('amount', event.target.value)}
                    placeholder="0.00"
                  />
                </label>

                <label className="field">
                  <span className="field__label">תאריך תשלום</span>
                  <input className="field__input" type="date" dir="ltr" value={paymentForm.paymentDate} onChange={(event) => updatePaymentForm('paymentDate', event.target.value)} />
                </label>
              </div>

              <label className="field">
                <span className="field__label">הערה (לא חובה)</span>
                <textarea
                  className="field__input payment-form__textarea"
                  value={paymentForm.note}
                  onChange={(event) => updatePaymentForm('note', event.target.value)}
                  placeholder="לדוגמה: הועבר בביט"
                />
              </label>

              {formError ? <p className="form-message form-message--error">{formError}</p> : null}

              <div className="payment-form__actions">
                <button type="button" className="btn btn--secondary" onClick={closePaymentModal}>
                  ביטול
                </button>
                <button type="submit" className="btn btn--primary">
                  {editingPayment ? 'שמירת שינויים' : 'שמירת תשלום'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {selectedPayment ? (
        <div className="modal-backdrop" role="presentation">
          <section className="payment-modal card" role="dialog" aria-modal="true" aria-labelledby="payment-details-title">
            <div className="payment-modal__head">
              <div>
                <p className="payments-hero__eyebrow">פרטי תשלום</p>
                <h2 id="payment-details-title">
                  {getUserName(selectedPayment.payer_id)} שילם ל{getUserName(selectedPayment.payee_id)}
                </h2>
                <p>{formatDateTime(selectedPayment.created_at)}</p>
              </div>
              <button type="button" className="btn-text" onClick={() => setSelectedPayment(null)}>
                סגירה
              </button>
            </div>

            <div className="expense-detail">
              <div className="expense-detail__amount">
                <span>סכום התשלום</span>
                <strong>{formatCurrency(selectedPayment.amount)}</strong>
              </div>

              <div className="expense-detail__facts">
                <div>
                  <span>משלם</span>
                  <strong>{getUserName(selectedPayment.payer_id)}</strong>
                </div>
                <div>
                  <span>מקבל</span>
                  <strong>{getUserName(selectedPayment.payee_id)}</strong>
                </div>
                <div>
                  <span>הערה</span>
                  <strong>{selectedPayment.note?.trim() || 'ללא הערה'}</strong>
                </div>
              </div>

              <div className="expense-form__actions">
                <button type="button" className="btn btn--secondary" onClick={() => openEditPaymentModal(selectedPayment)}>
                  עריכה
                </button>
                <button type="button" className="btn btn--danger" onClick={() => setPaymentToDelete(selectedPayment)}>
                  מחיקה
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {paymentToDelete ? (
        <ConfirmDialog
          title="למחוק את התשלום?"
          message="התשלום יוסר מההיסטוריה ולא ישפיע עוד על היתרות בין הדיירים."
          confirmLabel="מחיקה"
          cancelLabel="ביטול"
          onConfirm={() => void confirmDeletePayment()}
          onCancel={() => setPaymentToDelete(null)}
        />
      ) : null}
    </section>
  )
})
