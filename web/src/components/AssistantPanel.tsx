import { useState } from 'react'
import { useAssistant } from '../context/AssistantContext'
import { useApartment } from '../context/ApartmentContext'

export function AssistantPanel() {
  const { current } = useApartment()
  const {
    isOpen,
    isLoading,
    messages,
    suggestions,
    contextSnapshot,
    close,
    ask,
  } = useAssistant()
  const [draft, setDraft] = useState('')

  if (!isOpen || !current) return null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = draft.trim()
    if (!question || isLoading) return
    setDraft('')
    await ask(question)
  }

  return (
    <div className="assistant-panel" role="dialog" aria-modal="false" aria-label="סוכן הדירה">
      <div className="assistant-panel__head">
        <div>
          <h2>סוכן הדירה</h2>
          <p>{current.apartment.name}</p>
        </div>
        <button type="button" className="btn-text" onClick={close}>
          סגירה
        </button>
      </div>

      {contextSnapshot ? (
        <div className="assistant-panel__summary">
          <span>משימות פתוחות: {contextSnapshot.openTasksCount}</span>
          <span>קניות פתוחות: {contextSnapshot.openShoppingItemsCount}</span>
          <span>פניות פתוחות: {contextSnapshot.openTicketsCount}</span>
        </div>
      ) : null}

      <div className="assistant-panel__messages">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`assistant-panel__message assistant-panel__message--${message.role}`}
          >
            {message.text.split('\n').map((line, index) => (
              <span key={`${message.id}-${index}`}>
                {line}
                {index < message.text.split('\n').length - 1 ? <br /> : null}
              </span>
            ))}
          </div>
        ))}

        {isLoading ? (
          <div className="assistant-panel__message assistant-panel__message--assistant">
            טוען תשובה...
          </div>
        ) : null}
      </div>

      <div className="assistant-panel__suggestions">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="assistant-panel__chip"
            onClick={() => void ask(suggestion)}
            disabled={isLoading}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form className="assistant-panel__form" onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="field__input"
          placeholder="למשל: מה צריך לקנות עכשיו?"
        />
        <button type="submit" className="btn btn--primary" disabled={isLoading || !draft.trim()}>
          שלח
        </button>
      </form>
    </div>
  )
}
