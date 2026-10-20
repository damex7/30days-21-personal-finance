// CLIENT COMPONENT: the delete button, the Undo bar and its countdown.
'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { deleteTransactionAction, undoDeleteAction } from '@/app/(app)/transactions/actions'
import { button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'

/** How long the Undo button stays (the server allows a restore for 10 minutes; this is just the bar). */
const UNDO_SECONDS = 8

type Pending = { ids: string[]; message: string }
const UndoContext = createContext<{ remove: (id: string) => void; busy: boolean } | null>(null)

/**
 * DELETE WITH UNDO.
 *
 * Deleting is a SOFT delete on the server (deleted_at), so it can be taken
 * back. The Undo bar lives here, ABOVE the list: when the deleted row
 * disappears from the re-rendered list, the bar (and its focus) survive.
 * The message goes into an aria-live region, so "Transaction deleted. Undo
 * available for 8 seconds" is announced without moving focus; pressing
 * Undo announces "Restored". The countdown pauses while the pointer or
 * focus is on the bar, so nobody is rushed (WCAG 2.2.1, timing adjustable).
 */
export function UndoProvider({ children, initial }: { children: ReactNode; initial?: string[] }) {
  const announceFor = (message: string) => `${message} Undo is available for ${UNDO_SECONDS} seconds.`
  const [pending, setPending] = useState<Pending | null>(initial?.length ? { ids: initial, message: 'Transaction deleted.' } : null)
  const [announce, setAnnounce] = useState(initial?.length ? announceFor('Transaction deleted.') : '')
  const [left, setLeft] = useState(UNDO_SECONDS)
  const [paused, setPaused] = useState(false)
  const [busy, startTransition] = useTransition()
  // The seconds left, kept in a ref so the interval can count down without
  // re-subscribing; the state copy is what the bar shows.
  const leftRef = useRef(UNDO_SECONDS)

  // THE COUNTDOWN subscribes to a timer (an external system), and only
  // changes state from the timer's callback, never in the effect body.
  useEffect(() => {
    if (!pending || paused) return
    const timer = setInterval(() => {
      leftRef.current -= 1
      if (leftRef.current <= 0) {
        setPending(null)
        setAnnounce('')
      } else {
        setLeft(leftRef.current)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [pending, paused])

  const remove = useCallback((id: string) => {
    startTransition(async () => {
      const result = await deleteTransactionAction(id)
      if (result.ok) {
        leftRef.current = UNDO_SECONDS
        setLeft(UNDO_SECONDS)
        setPending({ ids: result.ids, message: result.message })
        setAnnounce(announceFor(result.message))
      } else {
        setAnnounce(result.message)
      }
    })
  }, [])

  const undo = () => {
    if (!pending) return
    const ids = pending.ids
    startTransition(async () => {
      const result = await undoDeleteAction(ids)
      setPending(null)
      setAnnounce(result.message)
    })
  }

  return (
    <UndoContext.Provider value={{ remove, busy }}>
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>
      {pending ? (
        <div
          className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-card border-2 border-ink bg-card p-3 shadow-pop lg:bottom-6"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <Icon name="trash" className="text-ink" />
          <p className="flex-1 text-sm font-semibold">
            {pending.message} <span className="figures font-normal text-muted">({left}s)</span>
          </p>
          <button type="button" className={button.primary} onClick={undo} disabled={busy}>
            <Icon name="restore" />
            Undo
          </button>
        </div>
      ) : null}
      {children}
    </UndoContext.Provider>
  )
}

/** A delete button for one row. The accessible name says WHICH row ("Delete Shoprite, −₦18,400.00"). */
export function DeleteButton({ id, label }: { id: string; label: string }) {
  const context = useContext(UndoContext)
  if (!context) throw new Error('DeleteButton needs an UndoProvider around it')
  return (
    <button type="button" className={button.icon} onClick={() => context.remove(id)} disabled={context.busy} aria-label={`Delete ${label}`} title="Delete">
      <Icon name="trash" />
    </button>
  )
}
